import {
	init,
	command,
	setProperty,
	getProperty,
	observeProperties,
	listenEvents,
	destroy,
	type MpvObservableProperty,
	type MpvConfig
} from 'tauri-plugin-libmpv-api';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
	isPaused,
	currentTime,
	duration,
	filename,
	videoWidth,
	videoHeight,
	volume,
	speed,
	brightness,
	contrast,
	saturation,
	gamma,
	hue,
	audioTracks,
	subtitleTracks,
	currentAid,
	currentSid,
	isMuted,
	mediaTitle,
	isBuffering,
	coreIdle,
	isSeeking,
	eofReached,
	demuxerCacheTime,
	demuxerCacheDuration,
	bufferedSeconds
} from '$lib/stores/player';
import { get } from 'svelte/store';
import {
	playerActive,
	currentVideoUrl,
	currentVideoTitle,
	playlist,
	playlistIndex,
	playerFullscreen,
	playbackError,
	mpvSurfaceReady
} from '$lib/stores/player-ui';
import { notify } from '$lib/stores/notifications';
import { t } from '$lib/i18n';
import type {
	VideoAdjustments,
	ShaderMode,
	ShaderVariant,
	MediaTrack,
	PlaylistItem
} from '$lib/types/player';
import {
	markWatched,
	toDbKey,
	savePlaybackPosition,
	getPlaybackPosition,
	clearPlaybackPosition
} from '$lib/services/db-service';
import { resolvePlayableUrl, prefetchAround, invalidate } from '$lib/services/prefetch-service';
import {
	shouldStorePosition,
	isEffectivelyWatched,
	resumePositionFor
} from '$lib/utils/resume';
import { isRemoteUrl, streamProfileFor } from '$lib/utils/stream-profile';
// The track-list / aid / sid parsers live in utils/track-list.ts so they can be
// unit tested: THIS module imports the libmpv plugin at the top level and cannot
// load under Node, which is why ~90 lines of defensive parsing had no coverage.
import { parseTrackList, parseTrackId, asFlag } from '$lib/utils/track-list';
import { shouldPreopenNext, PREOPEN_LEAD_SECONDS } from '$lib/utils/preopen';
import {
	defaultShaderMode,
	defaultShaderVariant,
	preferredAudioLang,
	preferredSubtitleLang
} from '$lib/stores/settings';
import { activeShaderMode, shaderVariant as activeShaderVariant } from '$lib/stores/player';
import { resolveResource, appLogDir } from '@tauri-apps/api/path';
import { log } from '$lib/log';

// Observable properties for mpv
const OBSERVED_PROPERTIES = [
	['pause', 'flag'],
	['time-pos', 'double', 'none'],
	['duration', 'double', 'none'],
	['filename', 'string', 'none'],
	['width', 'int64', 'none'],
	['height', 'int64', 'none'],
	['volume', 'double', 'none'],
	['speed', 'double', 'none'],
	['eof-reached', 'flag', 'none'],
	// Track selection. `track-list` is an mpv node (array of maps), so it needs
	// the 'node' format — the plugin converts MPV_FORMAT_NODE (incl. node arrays
	// and node maps) into plain JSON, so `data` arrives as a JS array of objects.
	['track-list', 'node', 'none'],
	// `aid`/`sid` MUST be observed as 'string', not 'int64': when the stream is
	// disabled mpv reports the literal string "no" (and "auto" before selection),
	// which would come back as garbage/null under a numeric format.
	['aid', 'string', 'none'],
	['sid', 'string', 'none'],
	// Buffering / stall state. Every one of these is a SCALAR format on purpose:
	// 'node' is only safe on the observed path, and none of these needs it. They
	// are what lets the UI tell "the user paused" apart from "the WebDAV stream
	// stalled" — see stores/player.ts and utils/buffering.ts.
	['paused-for-cache', 'flag', 'none'],
	['core-idle', 'flag', 'none'],
	['seeking', 'flag', 'none'],
	['demuxer-cache-time', 'double', 'none'],
	['demuxer-cache-duration', 'double', 'none'],
	// Mute was never observed, so mpv's own mute state (OSD keybind, another
	// controller) and the UI could disagree.
	['mute', 'flag'],
	['media-title', 'string', 'none'],
] as const satisfies MpvObservableProperty[];

const isMacOS = navigator.platform?.toLowerCase().includes('mac') ?? false;
const isWindows = navigator.platform?.toLowerCase().includes('win') ?? false;

/**
 * Render profile — options that shape image quality and output timing.
 *
 * These are init-time options: the VO cannot be swapped on a live instance, and
 * the rest have no reason to change per file.
 *
 * Measured against the mpv this app links (v0.41.0 / libmpv 2.5.0, Homebrew),
 * whose `--list-options` defaults are quoted below. Anything already at the
 * value we want is NOT repeated here (e.g. `dither-depth` already defaults to
 * `auto`); a config line that changes nothing is a line that misleads the next
 * reader.
 *
 * - `vo=gpu-next` (default: unset -> `gpu`). libplacebo-based renderer. It is
 *   mpv's recommended output, has the better scaler/deband/tone-map paths, and
 *   on this build the available VOs are exactly gpu-next/gpu/libmpv with `macvk`
 *   (Vulkan-on-Metal) as the only context — so both `gpu` and `gpu-next` go
 *   through Vulkan anyway and there is nothing to lose. It keeps creating its
 *   own NSWindow, which is what the macOS child-window embedding needs.
 * - `scale=spline36` / `cscale=spline36` (defaults: `lanczos` / follows scale).
 *   Sharper than lanczos without its ringing on line art. This runs AFTER the
 *   Anime4K chain: Anime4K does the 2x CNN upscale, mpv only resamples the
 *   result to the window size, so the two do not fight.
 * - `deband=yes` (default: `no`). Flat gradients (skies, fades) are where anime
 *   sources band, and a CNN upscaler amplifies it into visible contours. Cheap
 *   next to the Anime4K passes.
 * - `video-sync=display-resample` (default: `audio`). Removes the periodic
 *   judder of 23.976 fps content on a 60 Hz panel by resampling audio to the
 *   real display clock instead of dropping/duplicating frames.
 *
 *   KEPT after a power investigation (2026-10-07) that first concluded it should
 *   go, then found its own evidence invalid. Recorded so nobody repeats either
 *   half. A user reported playback battery life falling from ~4h to ~1h30 after
 *   the 1.5.0 player rework. Standalone `mpv` runs with our option set made this
 *   look like the single cause (33.6% CPU without it, 48.2% with, 51.5% for the
 *   full set). It does not hold: measured inside the app itself, at the same
 *   window and with the same file, CPU was 20.4% without it and 20.7% with — and
 *   Anime4K UL on or off was 20.4% vs 21.3%, i.e. also nothing. Every option in
 *   this profile is within noise of every other at the app level.
 *
 *   So a standalone mpv process is NOT a model of this app: it lacks the real
 *   window, the transparent-webview compositing over mpv's surface and the rest
 *   of the process. Measure the app, not mpv. The regression is real but it is
 *   not in these options, and finding it needs GPU/package power figures
 *   (`powermetrics`, which needs root, or Activity Monitor's Energy tab) rather
 *   than process CPU.
 *
 * - `volume-max=150` (default: `130`). The volume slider in the UI goes to 150,
 *   so today its top 13% silently does nothing. This makes the slider honest.
 *   mpv accepts 100..1000; 150 matches the UI exactly rather than inventing
 *   headroom the user cannot reach.
 *
 * NOT set, deliberately: `gpu-context` (only `macvk` exists on this build, mpv
 * picks it), `gpu-api`, `target-colorspace-hint` (HDR passthrough is its own
 * project), `dither-depth` (already `auto`).
 */
const RENDER_OPTIONS = {
	'vo': 'gpu-next',
	'scale': 'spline36',
	'cscale': 'spline36',
	'deband': 'yes',
	'video-sync': 'display-resample',
	'volume-max': 150,
} as const;

/**
 * Build the mpv init config. This is a function (not a const) so the persisted
 * language preferences are read at init time rather than at module load time.
 * `mpvLogFile` is a dev-only diagnostic.
 */
function buildMpvConfig(mpvLogFile: string | null): MpvConfig {
	const alang = get(preferredAudioLang);
	const slang = get(preferredSubtitleLang);
	return {
		initialOptions: {
			...RENDER_OPTIONS,
			'hwdec': 'auto-safe',
			// `always`, not `yes`. Measured on mpv 0.41.0: with `yes` and a next
			// playlist entry present, mpv advances BY ITSELF at EOF and
			// `eof-reached` goes to null — never true — so the eof-reached observer
			// below (our only auto-advance trigger) would stop firing the moment the
			// queue pre-open put a second entry in mpv's playlist. `always` parks at
			// EOF regardless of what follows, which keeps that trigger intact and
			// leaves US in charge of when to move on. With a single-entry playlist
			// (the pre-open's fallback) `always` and `yes` behave identically.
			'keep-open': 'always',
			// Open the NEXT playlist entry's demuxer while the current file plays.
			// This is the whole point of the queue pre-open: opening a Matroska
			// stream over WebDAV costs three sequential HTTP round trips, which
			// measured 6.07 s of frozen picture between episodes without this and
			// 0.11 s with it. See utils/preopen.ts for the full measurement.
			'prefetch-playlist': 'yes',
			'osc': 'no',
			'input-default-bindings': 'no',
			'input-vo-keyboard': 'no',
			// Auto-load sibling subtitle files ("<video>.es.srt", "Subs/<video>.ass", …)
			// for local playback. Harmless for Mega WebDAV streams: mpv can't list a
			// remote directory over HTTP, so it simply finds nothing.
			'sub-auto': 'fuzzy',
			// Preferred track languages. 'auto' => don't pass the option and let mpv
			// use its own defaults (usually the file's `default` flag order).
			...(alang !== 'auto' ? { 'alang': alang } : {}),
			...(slang !== 'auto' ? { 'slang': slang } : {}),
			// macOS/Windows: mpv creates its own window, which attach_mpv_to_window
			// then hooks to the Tauri window natively (child NSWindow ordered below
			// on macOS, Win32 child window on Windows). 'force-window' makes mpv
			// create it right away. On macOS `wid` is irrelevant: mpv 0.40+ ignores
			// it (its Swift backend always creates its own window — verified, see
			// commands/player.rs), so the plugin's automatic injection is harmless.
			...((isMacOS || isWindows) ? { 'force-window': 'yes' } : {}),
			// Windows: wid=0 overrides the plugin's automatic HWND injection, which
			// would embed mpv behind the webview instead of in a window we can own.
			...(isWindows ? { 'wid': 0 } : {}),
			// Dev-only: mpv's own log next to ours, to see what the VO does at startup.
			...(mpvLogFile ? { 'log-file': mpvLogFile, 'msg-level': 'all=v' } : {}),
		},
		observedProperties: OBSERVED_PROPERTIES,
	};
}

/**
 * Write the demuxer/network profile matching `url` (see utils/stream-profile.ts
 * for the values and the reasoning). Per-option failures are logged, not fatal:
 * a cache option mpv doesn't recognise must not stop the file from playing.
 */
async function applyStreamProfile(url: string): Promise<void> {
	const remote = isRemoteUrl(url);
	for (const [name, value] of Object.entries(streamProfileFor(url))) {
		try {
			await setProperty(name, value);
		} catch (e) {
			log.warn(`[player] Could not set ${name}=${value}:`, e);
		}
	}
	log.debug(`[player] Applied the ${remote ? 'remote stream' : 'local file'} profile`);
}

/** Dev-only path for mpv's `log-file` (inside the app log dir). */
async function devMpvLogFile(): Promise<string | null> {
	if (!import.meta.env.DEV) return null;
	try {
		const dir = await appLogDir();
		return `${dir.replace(/[\\/]+$/, '')}/mpv.log`;
	} catch {
		return null;
	}
}

let unlistenProperties: (() => void) | null = null;
let unlistenEvents: (() => void) | null = null;
let unsubscribeLangPrefs: (() => void)[] = [];
let initialized = false;
// True once mpv's window has been hooked to the Tauri window (macOS/Windows)
// and may be positioned. Cleared while the surface is hidden.
let mpvWindowAttached = false;
/** Rising-edge timestamp of the current `paused-for-cache` stall, if any. */
let cacheStallStartedAt: number | null = null;

// In-flight init, shared by concurrent callers. Without this, two overlapping
// loadVideo() calls both see `initialized === false` and run init() twice, and
// the second observeProperties/listenEvents pair overwrites the first handles,
// which then can never be unregistered (double-processed events + a leak).
let initPromise: Promise<void> | null = null;

// Bumped on every loadVideo(). Async track reads compare against it so a reply
// for the previous file can't overwrite the current file's tracks.
let loadGeneration = 0;
// Watchdog timer id, so it can be cancelled on teardown or on the next file.

// --- Resume position ---------------------------------------------------------
//
// mpv is the only place the live position exists, and SQLite is the only place
// it survives; this section is the bridge. Everything about *which* positions
// are worth keeping lives in utils/resume.ts, which is pure and unit tested.
//
// Sampling policy: every 60 s while a file is loaded, plus on every pause, on
// stop/unload, on EOF, and before loading the next file. The periodic tick is
// what covers the case the other hooks cannot — the app being killed, losing
// power, or crashing — so at worst a minute of progress is lost.
//
// Resume is SILENT (no "continue watching?" prompt), like Nuvio. A prompt would
// have to be answered before every single episode of a queue, it cannot be
// rendered over the video on Windows yet (CLAUDE.md #2), and the 1s/90% window
// already excludes the two cases where a silent jump would surprise anyone
// ("I barely started" and "I finished it"). The seek is also visible and
// undoable: the position is on the timeline and a single seek-to-0 undoes it.

// 15s, not 60s. The position is also written on pause/stop/EOF, so this timer
// only covers the case where the app dies without any of those — and it does:
// libmpv 0.41.0 crashes in its CoreAudio hotplug callback when the output device
// changes (see CLAUDE.md #4), which a user hit mid-episode by moving from
// Bluetooth to the built-in speakers. We cannot stop that crash from here, but a
// SQLite upsert every 15s is free and turns "lost the last minute" into "lost the
// last few seconds".
const POSITION_SAVE_INTERVAL_MS = 15_000;

/** DB row key + display name of the item currently loaded, or null. */
let currentResumeTarget: { key: string; name: string } | null = null;
let positionTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribePause: (() => void) | null = null;

/**
 * The playlist entry the player is currently on, as a DB row key.
 *
 * INVARIANT: every caller of loadVideo() sets `playlist` + `playlistIndex`
 * before calling it (FileBrowser, LocalFileBrowser, queue, history, playNext/
 * playPrev, devSmokePlay). That is what lets this be derived here instead of
 * threading a key through every call site — loadVideo() only ever receives a
 * playable URL, which for Mega is an opaque WebDAV token and cannot be turned
 * back into a row key.
 *
 * Returns null if the playlist is empty, and resume is then simply skipped.
 */
function currentResumeKey(): { key: string; name: string } | null {
	const items = get(playlist);
	const item = items[get(playlistIndex)];
	if (!item) return null;
	// toDbKey is mandatory: a bare local path would be read back as a Mega path.
	return { key: toDbKey(item.source, item.path), name: item.name };
}

/**
 * Write the current position for the loaded item, or clear it if the file is
 * effectively finished.
 *
 * Note the third case: a position outside the window that is NOT "finished"
 * (i.e. under 1 s, or an unknown duration) leaves whatever is stored alone. That
 * is deliberate — opening a file and immediately closing it must not wipe a
 * resume point the user still wants.
 */
async function persistPlaybackPosition(): Promise<void> {
	const target = currentResumeTarget;
	if (!target) return;
	const position = get(currentTime);
	const dur = get(duration);
	try {
		if (shouldStorePosition(position, dur)) {
			await savePlaybackPosition(target.key, target.name, position as number, dur);
		} else if (isEffectivelyWatched(position, dur)) {
			await clearPlaybackPosition(target.key);
		}
	} catch (e) {
		log.warn('[player] Failed to persist the playback position:', e);
	}
}

/**
 * Stored position for `key`, already validated, or null for "start from the
 * beginning". Never throws: a database problem must not stop playback.
 */
async function readResumePosition(key: string | undefined): Promise<number | null> {
	if (!key) return null;
	try {
		const stored = await getPlaybackPosition(key);
		if (!stored) return null;
		const resumeAt = resumePositionFor(stored.positionSeconds, stored.durationSeconds);
		if (resumeAt != null) log.info(`[player] Resuming at ${Math.round(resumeAt)}s`);
		return resumeAt;
	} catch (e) {
		log.warn('[player] Failed to read the resume position:', e);
		return null;
	}
}

/** (Re)start the periodic save tick. Idempotent. */
function startPositionTimer(): void {
	if (positionTimer !== null) return;
	positionTimer = setInterval(() => {
		void persistPlaybackPosition();
	}, POSITION_SAVE_INTERVAL_MS);
}

function stopPositionTimer(): void {
	if (positionTimer !== null) {
		clearInterval(positionTimer);
		positionTimer = null;
	}
}

/**
 * Save on every pause. Covers the two ways a session normally ends without a
 * stop: the user pausing, and hideMpvOverlay() pausing on navigation away.
 * The store's immediate first emission is skipped, as in the language watchers.
 */
function attachPauseWatcher(): void {
	if (unsubscribePause) return;
	let first = true;
	unsubscribePause = isPaused.subscribe((paused) => {
		if (first) {
			first = false;
			return;
		}
		if (paused) void persistPlaybackPosition();
	});
}

/**
 * Initialize mpv player and start observing properties.
 * Concurrent calls share a single initialization.
 */
export async function initPlayer(): Promise<void> {
	if (initialized) return;
	if (initPromise) return initPromise;
	initPromise = doInitPlayer().finally(() => {
		initPromise = null;
	});
	return initPromise;
}

async function doInitPlayer(): Promise<void> {
	const mpvConfig = buildMpvConfig(await devMpvLogFile());
	log.info('[player] Initializing mpv with config:', JSON.stringify(mpvConfig.initialOptions));
	try {
		await init(mpvConfig);
	} catch (e) {
		log.error('[player] init() FAILED:', e);
		throw e;
	}
	log.info('[player] mpv initialized successfully');
	initialized = true;

	unlistenProperties = await observeProperties(
		OBSERVED_PROPERTIES,
		({ name, data }) => {
			switch (name) {
				case 'pause':
					isPaused.set(data === true || String(data) === 'yes');
					break;
				case 'time-pos':
					currentTime.set(typeof data === 'number' ? data : null);
					// Driven from mpv's own clock rather than from a component, so the
					// pre-open still happens if the overlay is not mounted.
					maybePreopenNext(typeof data === 'number' ? data : null);
					break;
				case 'duration':
					duration.set(typeof data === 'number' ? data : null);
					break;
				case 'filename':
					filename.set(typeof data === 'string' ? data : null);
					break;
				case 'width':
					videoWidth.set(typeof data === 'number' ? data : null);
					break;
				case 'height':
					videoHeight.set(typeof data === 'number' ? data : null);
					break;
				case 'volume':
					if (typeof data === 'number') volume.set(data);
					break;
				case 'speed':
					if (typeof data === 'number') speed.set(data);
					break;
				case 'track-list':
					// Ignored when the fallback strategy is active — see
					// The ONLY safe source for the track list: observed, never pulled.
					// See the getProperty(..., 'node') warning further down.
					applyTrackList(data);
					break;
				case 'aid':
					currentAid.set(parseTrackId(data));
					break;
				case 'sid':
					currentSid.set(parseTrackId(data));
					break;
				case 'paused-for-cache': {
					// Log both edges with the duration between them. Whether the
					// buffering badge is tuned right depends entirely on how long
					// real stalls last on this transport, and that is not something
					// to guess at from a screenshot: this turns it into a number in
					// the log file the user can send.
					const stalled = asFlag(data);
					if (stalled && cacheStallStartedAt === null) {
						cacheStallStartedAt = Date.now();
						// How much was buffered when it ran dry. This is the number
						// that says whether a stall is a supply problem (cushion never
						// built: always ~0) or a hiccup the cushion should have
						// absorbed, and it is what any further tuning has to be based
						// on rather than on guesses about buffer sizes.
						log.info(
							`[player] cache stall started with ${get(bufferedSeconds).toFixed(1)}s buffered ahead`,
						);
						// BOTH edges. Logging only the falling one was a mistake: with a
						// stuck badge the log could not tell "the cache never stalled"
						// apart from "it stalled and never recovered", which is exactly
						// the question that mattered.
					} else if (!stalled && cacheStallStartedAt !== null) {
						log.info(`[player] cache stall lasted ${Date.now() - cacheStallStartedAt}ms`);
						cacheStallStartedAt = null;
					}
					isBuffering.set(stalled);
					break;
				}
				case 'core-idle':
					coreIdle.set(asFlag(data));
					break;
				case 'seeking':
					isSeeking.set(asFlag(data));
					break;
				case 'demuxer-cache-time':
					demuxerCacheTime.set(typeof data === 'number' ? data : null);
					break;
				case 'demuxer-cache-duration':
					demuxerCacheDuration.set(typeof data === 'number' ? data : null);
					break;
				case 'mute':
					isMuted.set(asFlag(data));
					break;
				case 'media-title':
					mediaTitle.set(typeof data === 'string' ? data : null);
					break;
				case 'eof-reached':
					// Reliable end-of-file signal (keep-open pauses at EOF). Advance
					// to the next item, or — if this was the last one — leave
					// fullscreen so the sidebar/UI is usable again.
					eofReached.set(asFlag(data));
					if (data === true || String(data) === 'yes') {
						// Finished: drop any stored resume point so the next play
						// starts over instead of jumping to the last minute.
						void persistPlaybackPosition();
						const items = get(playlist);
						const idx = get(playlistIndex);
						if (idx < items.length - 1) {
							triggerAutoAdvance();
						} else {
							exitFullscreen();
						}
					}
					break;
			}
		}
	);

	// 'file-loaded' is only used to re-assert the selected track ids; the track
	// list itself arrives through the observed 'track-list' property. See the
	// comment on refreshSelectedTracks() for why we never *pull* track-list.
	// 'end-file' with reason 'error' is the only signal mpv gives for "could not
	// open/decode this": loadfile itself succeeds because it merely queues the file.
	unlistenEvents = await listenEvents((event) => {
		if (event.event === 'file-loaded') {
			// A file opened: the previous failure (if any) is over, so the
			// one-retry budget for the next one is restored.
			retriedItemPath = null;
			refreshSelectedTracks();
		} else if (event.event === 'end-file' && event.reason === 'error') {
			handleLoadError(event);
		}
	});

	attachLanguagePreferenceWatchers();
	attachPauseWatcher();
}

/** Remote path of the item we already retried once; cleared on a successful load. */
let retriedItemPath: string | null = null;

/**
 * mpv gave up on the current file.
 *
 * For a Mega stream the overwhelmingly likely cause is a dead WebDAV URL:
 * MEGAcmd restarted and the cached URL still points at the previous server
 * instance. The generation token in prefetch-service.ts catches that whenever we
 * sampled the server as down, but a server replaced between two samples slips
 * through — so the first failure per item buys one silent re-resolve + reload
 * before the user is told anything. Anything else (bad codec, deleted file, a
 * second failure) goes straight to the toast.
 */
function handleLoadError(event: { error?: number; file_error?: string }): void {
	// `file_error` is mpv's own description when available; the numeric code is
	// the MPV_ERROR_* value otherwise (e.g. -13 = loading failed).
	const detail = event.file_error ?? `mpv error ${event.error ?? 'unknown'}`;
	log.error('[player] end-file with reason=error:', detail, 'url:', get(currentVideoUrl));
	if (retryWithFreshUrl()) return;
	reportLoadFailure(detail);
}

/**
 * Put the player in an observable, idle, failed state and tell the user.
 *
 * Leaving fullscreen is NOT cosmetic, it is the only way out of the app. The
 * chain: `playerActive=false` unmounts <PlayerOverlay>, which owns the project's
 * only `<svelte:window onkeydown>`, so F and Escape stop existing; meanwhile
 * `playerFullscreen` stays true, which keeps `.app-shell.fullscreen .sidebar`
 * hidden — and on macOS "fullscreen" is an undecorated maximised window. The
 * result was a borderless window with no controls, no shortcuts and no sidebar,
 * escapable only with Cmd+Q. Reached by pressing F on a Mega stream and having
 * MEGAcmd die. `stopVideo()` already exits fullscreen for the same reason.
 *
 * Order matters: exit fullscreen BEFORE dropping `playerActive`, because the
 * exit path must not depend on state this function is about to tear down.
 */
function reportLoadFailure(detail: string): void {
	playbackError.set(detail);
	exitFullscreen().catch((e) => log.warn('[player] Could not leave fullscreen:', e));
	// The 60 s position tick would otherwise keep writing to SQLite for the rest
	// of the session, against a file that is not playing.
	stopPositionTimer();
	currentResumeTarget = null;
	playerActive.set(false);
	if (isMacOS || isWindows) hideMpvOverlay().catch(() => {});
	notify('error', get(t)['player.error.loadFailed'], { detail, persistent: true });
}

/**
 * Re-resolve the current Mega item's WebDAV URL and reload it, once.
 * Returns true if a retry was started (the caller must then stay quiet).
 *
 * The budget is one retry per playlist item, reset by the next successful
 * `file-loaded`, so a genuinely broken file cannot loop.
 */
function retryWithFreshUrl(): boolean {
	const items = get(playlist);
	const item = items[get(playlistIndex)];
	// Local files have no URL to refresh: their path IS the URL.
	if (!item || item.source !== 'mega') return false;
	if (retriedItemPath === item.path) return false;
	retriedItemPath = item.path;

	log.warn('[player] Mega stream failed to open; re-resolving its WebDAV URL and retrying once');
	// Until now this retry was completely silent: the picture froze for as long as
	// MEGAcmd needed to come back and the user had no idea anything was being
	// done. Transient, not persistent — if the retry works there is nothing left
	// to act on, and if it fails reportLoadFailure() raises the persistent error.
	notify('info', get(t)['player.error.streamExpired']);
	invalidate(item.path);

	void (async () => {
		try {
			const url = await resolvePlayableUrl(item);
			await loadVideo(url, item.name);
			await setProperty('pause', 'no');
		} catch (e) {
			log.error('[player] Retry with a fresh WebDAV URL also failed:', e);
			reportLoadFailure(e instanceof Error ? e.message : String(e));
		}
	})();
	return true;
}

/**
 * Destroy mpv player and clean up.
 */
export async function destroyPlayer(): Promise<void> {
	if (!initialized) return;
	// Last chance to record where the user was, before mpv stops reporting it.
	await persistPlaybackPosition();
	stopPositionTimer();
	currentResumeTarget = null;
	if (unsubscribePause) {
		unsubscribePause();
		unsubscribePause = null;
	}
	if (unlistenProperties) {
		unlistenProperties();
		unlistenProperties = null;
	}
	if (unlistenEvents) {
		unlistenEvents();
		unlistenEvents = null;
	}
	// Invalidate in-flight track reads so a reply can't land on a fresh instance.
	loadGeneration++;
	for (const unsub of unsubscribeLangPrefs) unsub();
	unsubscribeLangPrefs = [];
	cancelPreopenTracking();
	await destroy();
	initialized = false;
	playerActive.set(false);
}

/**
 * Everything that must happen BEFORE mpv starts on a new file, shared by both
 * routes into a new file: the cold `loadfile … replace` in loadVideo() and the
 * warm `playlist-next` in advanceToPreopened().
 *
 * Splitting this out is not tidying: every line of it is a bug that was fixed
 * once already (stale tracks, the outgoing file's position written under the
 * incoming file's key, a leaked `start`), and the warm path would have
 * reintroduced all of them by skipping loadVideo() entirely.
 */
async function prepareForNextFile(url: string): Promise<void> {
	// Record where the OUTGOING file was before anything about it is reset.
	// Auto-advance and "play the next episode" both come through here.
	await persistPlaybackPosition();

	// Invalidate the previous file's tracks straight away. Leaving them in place
	// would show the old file's audio/subtitle options until mpv reports the new
	// ones, and picking one would set a track id that belongs to another file.
	loadGeneration++;
	audioTracks.set([]);
	subtitleTracks.set([]);
	currentAid.set(null);
	currentSid.set(null);
	// Clearing the position/duration here is not cosmetic: loadVideo() sets
	// `pause` below, which wakes the pause watcher, which saves the position —
	// and mpv still reports the PREVIOUS file's time-pos until the new one is
	// open. Without this, the outgoing file's position gets written under the
	// incoming file's key. Nulls make every threshold in utils/resume.ts refuse.
	currentTime.set(null);
	duration.set(null);
	// Stale buffering state belongs to the previous file; clearing it stops the
	// UI from showing the old cache extent against the new file's timeline.
	eofReached.set(false);
	isBuffering.set(false);
	isSeeking.set(false);
	demuxerCacheTime.set(null);
	demuxerCacheDuration.set(null);

	playbackError.set(null);

	// Demuxer/cache options must be in place before the demuxer is created.
	// On the WARM path the demuxer for this file already exists (that is the
	// point), so this write lands too late for it — which is exactly why
	// shouldPreopenNext() refuses to pre-open across a profile change. Writing it
	// anyway keeps the global state honest for whatever is loaded next.
	await applyStreamProfile(url);

	// Resume. `start` is applied by mpv while OPENING the file, so playback
	// begins at the right place; seeking after `file-loaded` would instead cost a
	// full re-buffer over WebDAV (CLAUDE.md #4) and download the opening bytes
	// for nothing. It is written on EVERY load, 'none' included, because `start`
	// is a global option: leaving the previous file's value behind would make the
	// next one jump too.
	currentResumeTarget = currentResumeKey();
	const resumeAt = await readResumePosition(currentResumeTarget?.key);
	try {
		await setProperty('start', resumeAt != null ? String(resumeAt) : 'none');
	} catch (e) {
		log.warn('[player] Could not set the start position:', e);
	}

	// Whatever mpv had queued belongs to the file we are leaving behind.
	cancelPreopenTracking();

	// mpv's `sub-delay` is GLOBAL and `loadfile` does not reset it (the same trap
	// `start` has, which is handled above). Without this, five taps of G on
	// episode 1 silently carried -0.5 s into episode 2 while the panel and the OSD
	// both showed 0 ms, and the next tap jumped from -500 ms to -100 ms.
	try {
		await setProperty('sub-delay', 0);
	} catch (e) {
		log.warn('[player] Could not reset the subtitle delay:', e);
	}
}

/**
 * Everything that must happen AFTER mpv has been pointed at a new file, shared
 * by the cold and warm paths.
 */
async function commitCurrentFile(url: string, title?: string): Promise<void> {
	startPositionTimer();

	currentVideoUrl.set(url);
	currentVideoTitle.set(title ?? null);
	playerActive.set(true);

	// macOS/Windows: mpv creates a separate window. Attach it to the Tauri window
	// so it appears inside the app's player area instead of floating.
	if ((isMacOS || isWindows) && !mpvWindowAttached) {
		log.info('[player] Starting mpv window attach...');
		await attachMpvWindow();
		log.info('[player] attachMpvWindow done, attached:', mpvWindowAttached);
	}

	// Apply Anime4K shaders based on user's saved preference (silently)
	applyUserShaderPreset().catch((e) => {
		log.warn('[player] Failed to apply shader preset:', e);
	});
}

/**
 * Load a video file from a URL (WebDAV or local path). The COLD path: mpv opens
 * the stream from scratch, which over WebDAV costs three sequential HTTP round
 * trips. Used for every user-initiated play, and as the fallback whenever the
 * warm pre-open is not available.
 *
 * `loadfile … replace` also wipes mpv's other playlist entries (verified), so
 * this path cannot inherit a stale pre-open.
 */
export async function loadVideo(url: string, title?: string): Promise<void> {
	log.info('[player] loadVideo called:', { url, title, initialized, isMacOS, isWindows });

	if (!initialized) {
		log.info('[player] Not initialized, calling initPlayer...');
		await initPlayer();
	}

	await prepareForNextFile(url);

	log.info('[player] Sending loadfile command...');
	try {
		await command('loadfile', [url]);
	} catch (e) {
		log.error('[player] loadfile command FAILED:', e);
		throw e;
	}
	log.info('[player] loadfile command succeeded');

	// Start paused so the user decides when to play.
	await setProperty('pause', 'yes');

	await commitCurrentFile(url, title);
}

/**
 * Try to get mpv's native window pointer with retries.
 * mpv may take some time to create its window after loadfile.
 */
async function attachMpvWindow(): Promise<void> {
	const MAX_ATTEMPTS = 10;
	const POLL_INTERVAL = 300; // ms

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
		try {
			const raw = await getProperty('window-id', 'int64');
			// Handle all possible return types: number, BigInt, string
			let windowId: number;
			if (typeof raw === 'number') {
				windowId = raw;
			} else if (typeof raw === 'bigint') {
				windowId = Number(raw);
			} else if (typeof raw === 'string' && raw !== '') {
				windowId = parseInt(raw, 10);
			} else {
				log.debug(`[player] window-id attempt ${attempt}/${MAX_ATTEMPTS}: got ${typeof raw} = ${raw}`);
				continue;
			}

			if (!windowId || windowId === 0 || isNaN(windowId)) {
				log.debug(`[player] window-id attempt ${attempt}/${MAX_ATTEMPTS}: invalid value ${windowId}`);
				continue;
			}

			await invoke('attach_mpv_to_window', { mpvWindowPtr: windowId });
			mpvWindowAttached = true;
			// libmpv's Cocoa backend overwrites NSApp's icon with mpv's own when it
			// creates its window, and that property is per-process: the Dock tile for
			// dnjplayer becomes mpv's. Put ours back.
			invoke('restore_app_icon').catch(() => {});
			// Let Player.svelte push the current rect now that resizes are accepted.
			mpvSurfaceReady.update((n) => n + 1);
			log.debug('[player] mpv window attached as child, window-id:', windowId, `(attempt ${attempt})`);
			// Newer mpv can render to the desktop on the very first attach because
			// its window isn't fully realized yet (a stop+replay fixes it — i.e. a
			// second SetParent). Re-attach shortly after to settle it into the app
			// window without needing user interaction. Idempotent re-parent.
			setTimeout(() => {
				invoke('attach_mpv_to_window', { mpvWindowPtr: windowId }).catch(() => {});
			}, 700);
			return;
		} catch (e) {
			log.warn(`[player] attach attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e);
			if (attempt === MAX_ATTEMPTS) {
				log.error('[player] Could not attach mpv window after all attempts');
			}
		}
	}
}

/**
 * Resize/reposition the native video surface to match the video area.
 * Called by Player.svelte whenever the `.video-area` layout changes.
 */
export async function resizeMpvOverlay(x: number, y: number, width: number, height: number): Promise<void> {
	if (!(isMacOS || isWindows) || !mpvWindowAttached) return;
	try {
		await invoke('resize_mpv_window', { x, y, width, height });
	} catch (e) {
		log.warn('[player] Failed to resize mpv window:', e);
	}
}

/**
 * Hide the native video surface (host view on macOS, child window on Windows).
 * Used when stopping or navigating away from the player.
 */
export async function hideMpvOverlay(): Promise<void> {
	if (!(isMacOS || isWindows)) return;
	mpvWindowAttached = false;
	// The pause below persists the position; after that the periodic tick has
	// nothing left to do and would keep writing every 60 s for the rest of the
	// session. startPositionTimer() is idempotent, so returning to the player
	// re-arms it.
	stopPositionTimer();
	// Pause playback so audio doesn't keep going while the player view is hidden
	// (e.g. when navigating to another section). Hiding the window alone does NOT
	// stop mpv. Keeps the position so the user can resume on return.
	try {
		if (initialized) await setProperty('pause', 'yes');
	} catch {
		// ignore — mpv may not be ready
	}
	try {
		await invoke('hide_mpv_window');
	} catch (e) {
		// Silently ignore — window may already be gone
	}
}

/**
 * Re-show the native video surface after navigating back to the player page.
 * Player.svelte follows up with resizeMpvOverlay(), and the Rust side un-hides
 * the surface as part of the resize.
 */
export function showMpvOverlay(): void {
	if (!(isMacOS || isWindows)) return;
	if (!initialized) return;
	mpvWindowAttached = true;
}

/**
 * Stop playback.
 */
export async function stopVideo(): Promise<void> {
	if (!initialized) return;
	// Record the position BEFORE `stop` clears mpv's time-pos, or every stop
	// would be saved as "position unknown".
	await persistPlaybackPosition();
	stopPositionTimer();
	currentResumeTarget = null;
	// Leave fullscreen so the user isn't stuck on a chrome-less screen after stop.
	await exitFullscreen();
	// Clear flags FIRST so late layout events don't re-show the surface
	const wasAttached = mpvWindowAttached;
	mpvWindowAttached = false;
	playerActive.set(false);
	// Now safely hide the mpv window
	if ((isMacOS || isWindows) && wasAttached) {
		await hideMpvOverlay();
	}
	await command('stop', []);
	currentVideoUrl.set(null);
	currentVideoTitle.set(null);
	currentTime.set(null);
	duration.set(null);
	filename.set(null);
	audioTracks.set([]);
	subtitleTracks.set([]);
	currentAid.set(null);
	currentSid.set(null);
	eofReached.set(false);
	isBuffering.set(false);
	isSeeking.set(false);
	demuxerCacheTime.set(null);
	demuxerCacheDuration.set(null);
	mediaTitle.set(null);
	// `stop` empties mpv's playlist, so any pre-opened entry is gone with it.
	cancelPreopenTracking();
}

// --- Playback controls ---

export async function togglePause(): Promise<void> {
	if (!initialized) return;
	const current = await getProperty('pause', 'flag');
	await setProperty('pause', current ? 'no' : 'yes');
}

export async function seek(seconds: number): Promise<void> {
	if (!initialized) return;
	await command('seek', [String(seconds), 'relative']);
}

export async function seekAbsolute(seconds: number): Promise<void> {
	if (!initialized) return;
	await command('seek', [String(seconds), 'absolute']);
}

export async function setVolume(val: number): Promise<void> {
	if (!initialized) return;
	await setProperty('volume', val);
}

export async function setSpeed(val: number): Promise<void> {
	if (!initialized) return;
	await setProperty('speed', val);
}

export async function setMute(muted: boolean): Promise<void> {
	if (!initialized) return;
	await setProperty('mute', muted ? 'yes' : 'no');
}

// --- Video adjustments ---

const adjustmentStores: Record<string, typeof brightness> = {
	brightness,
	contrast,
	saturation,
	gamma,
	hue,
};

export async function setVideoAdjustment(property: string, value: number): Promise<void> {
	if (!initialized) return;
	await setProperty(property, value);
	adjustmentStores[property]?.set(value);
}

/**
 * Set mpv's subtitle delay, in milliseconds (mpv's own unit is seconds).
 *
 * Its own function rather than a `setVideoAdjustment('sub-delay', …)` call: that
 * one is named for the brightness/contrast/saturation family and mirrors the value
 * into `adjustmentStores`, so using it here both lies about what is being set and
 * silently skips the mirror. Positive values delay the subtitles.
 */
export async function setSubtitleDelay(milliseconds: number): Promise<void> {
	if (!initialized) return;
	try {
		await setProperty('sub-delay', milliseconds / 1000);
	} catch (e) {
		log.warn('[player] Failed to set subtitle delay:', e);
	}
}

export async function resetVideoAdjustments(): Promise<void> {
	const defaults: Record<string, number> = {
		brightness: 0,
		contrast: 0,
		saturation: 0,
		gamma: 0,
		hue: 0,
	};
	for (const [prop, val] of Object.entries(defaults)) {
		await setVideoAdjustment(prop, val);
	}
}

export function getDefaultAdjustments(): VideoAdjustments {
	return {
		brightness: 0,
		contrast: 0,
		saturation: 0,
		gamma: 0,
		hue: 0,
	};
}

// --- Audio / subtitle tracks ---

/**
 * !!! NEVER CALL getProperty(..., 'node') !!!
 *
 * The bundled native wrapper (src-tauri/lib/libmpv-wrapper.dylib) has a
 * memory-management bug on the property *pull* path: `MpvNode::from_node`, as
 * reached from `mpv_wrapper_get_property`, frees a pointer it does not own. That
 * trips libmalloc and aborts the ENTIRE app with SIGABRT — not a catchable JS
 * error, the process is gone.
 *
 * Confirmed from a real crash report (Abort trap: 6, thread `tokio-rt-worker`):
 *   ___BUG_IN_CLIENT_OF_LIBMALLOC_POINTER_BEING_FREED_WAS_NOT_ALLOCATED
 *   mpv_wrapper::property::MpvNode::from_node
 *   mpv_wrapper_get_property
 *   tauri_plugin_libmpv::commands::get_property
 * reproduced by pressing the audio-cycle shortcut, which used to pull
 * 'track-list' as a node.
 *
 * The *observed* path (`['track-list', 'node']` in OBSERVED_PROPERTIES) is fine:
 * there mpv owns the node and frees it itself, so the faulty free never runs.
 * That is why the track list is only ever received via observeProperties, and
 * why the previous "pull it manually" watchdog had to go — it would have turned
 * every file load into a coin flip on crashing.
 *
 * Scalar formats ('string' | 'flag' | 'int64' | 'double') do not go through
 * from_node and are safe to pull.
 */

// Re-exported because parseTrackList used to be part of this module's surface.
export { parseTrackList } from '$lib/utils/track-list';

/** Parse a raw track-list payload into the stores. Returns the parsed tracks. */
function applyTrackList(raw: unknown): MediaTrack[] {
	const tracks = parseTrackList(raw);
	const audio = tracks.filter((t) => t.type === 'audio');
	const subs = tracks.filter((t) => t.type === 'sub');
	audioTracks.set(audio);
	subtitleTracks.set(subs);
	return tracks;
}

/**
 * Human label for the OSD. mpv renders this text itself (not the DOM), so it
 * deliberately bypasses i18n and is built from the track's own metadata.
 */
function trackLabel(track: MediaTrack | undefined, kind: 'audio' | 'sub'): string {
	const prefix = kind === 'audio' ? 'Audio' : 'Subtitles';
	if (!track) return `${prefix}: off`;
	const parts = [track.lang?.toUpperCase(), track.title].filter(Boolean);
	const body = parts.length > 0 ? parts.join(' — ') : `Track ${track.id}`;
	return `${prefix}: ${body}`;
}

/**
 * Re-read only the SELECTED track ids (aid/sid) from mpv.
 *
 * Deliberately does not touch the track list: pulling 'track-list' would need
 * format 'node', which crashes the process (see the big warning above). The list
 * itself is kept up to date by the observed property.
 *
 * Guarded by the load generation so a reply for the previous file can't overwrite
 * the current one.
 */
export async function refreshSelectedTracks(): Promise<void> {
	if (!initialized) return;
	const generation = loadGeneration;
	try {
		const aid = await getProperty('aid', 'string');
		const sid = await getProperty('sid', 'string');
		if (generation !== loadGeneration) return;
		currentAid.set(parseTrackId(aid));
		currentSid.set(parseTrackId(sid));
	} catch (e) {
		log.warn('[player] Failed to refresh selected tracks:', e);
	}
}

/** Find the track matching an aid/sid value in one of the track stores. */
function findTrack(tracks: MediaTrack[], id: number | 'no' | null): MediaTrack | undefined {
	if (typeof id !== 'number') return undefined;
	return tracks.find((t) => t.id === id);
}

/**
 * Select an audio track by mpv id, or 'no' to disable audio.
 *
 * The id is sent as a STRING on purpose. mpv's `aid` is a choice-or-number
 * option ("auto" | "no" | <id>), and the plugin forwards whatever JSON type it
 * is given; a string goes through mpv's own option parser, which is the form
 * mpv documents and which behaves identically for every value.
 */
export async function setAudioTrack(id: number | 'no'): Promise<void> {
	if (!initialized) return;
	try {
		await setProperty('aid', String(id));
		currentAid.set(id);
		// Read back what mpv actually selected: if the track can't be used (e.g. an
		// unsupported codec) mpv may keep or drop the previous one, and the UI must
		// show reality rather than our optimistic guess.
		await refreshSelectedTracks();
		log.info('[player] setAudioTrack requested', id, '-> mpv reports', get(currentAid));
	} catch (e) {
		log.warn('[player] Failed to set audio track:', e);
	}
}

/** Select a subtitle track by mpv id, or 'no' to turn subtitles off. */
export async function setSubtitleTrack(id: number | 'no'): Promise<void> {
	if (!initialized) return;
	try {
		await setProperty('sid', String(id));
		currentSid.set(id);
		await refreshSelectedTracks();
		log.info('[player] setSubtitleTrack requested', id, '-> mpv reports', get(currentSid));
	} catch (e) {
		log.warn('[player] Failed to set subtitle track:', e);
	}
}

/**
 * Cycle to the next audio track, showing the result on mpv's OSD.
 *
 * Rotates over our own observed track list instead of mpv's `cycle audio`,
 * for two reasons:
 *  - mpv's cycle includes the "disabled" state, so cycling through a 2-track
 *    file goes 1 -> 2 -> no audio -> 1. Silently muting a video is not what a
 *    user pressing "next audio track" is asking for. Subtitles do want that
 *    extra step; audio doesn't.
 *  - it lets us build the OSD label from the list we already hold, with no
 *    property pull (see the getProperty(..., 'node') warning above).
 */
export async function cycleAudioTrack(): Promise<void> {
	if (!initialized) return;
	const tracks = get(audioTracks);
	if (tracks.length === 0) return;

	const current = get(currentAid);
	const currentIdx = tracks.findIndex((t) => t.id === current);
	const next = tracks[(currentIdx + 1) % tracks.length];

	await setAudioTrack(next.id);
	const label = trackLabel(findTrack(get(audioTracks), get(currentAid)), 'audio');
	await command('show-text', [label, '2000']).catch(() => {});
}

/**
 * Cycle to the next subtitle track, including an "off" step, showing it on the
 * OSD. Order is: off -> track 1 -> ... -> track N -> off.
 */
export async function cycleSubtitleTrack(): Promise<void> {
	if (!initialized) return;
	const tracks = get(subtitleTracks);
	if (tracks.length === 0) return;

	// 'no' first so the rotation naturally includes turning subtitles off.
	const sequence: (number | 'no')[] = ['no', ...tracks.map((t) => t.id)];
	const current = get(currentSid);
	const currentIdx = sequence.findIndex((entry) => entry === current);
	const next = sequence[(currentIdx + 1) % sequence.length];

	await setSubtitleTrack(next);
	const label = trackLabel(findTrack(get(subtitleTracks), get(currentSid)), 'sub');
	await command('show-text', [label, '2000']).catch(() => {});
}

/**
 * Load an external subtitle file and select it right away.
 * `path` is an absolute filesystem path (or any URL mpv can open).
 */
export async function addExternalSubtitle(path: string): Promise<void> {
	if (!initialized) return;
	log.info('[player] addExternalSubtitle:', path);
	try {
		await command('sub-add', [path, 'select']);
		// The new track arrives via the observed 'track-list'; we only need to learn
		// which sid mpv gave it.
		await refreshSelectedTracks();
	} catch (e) {
		log.warn('[player] Failed to add external subtitle:', e);
	}
}

/**
 * Push the persisted language preferences into the running mpv instance.
 * NOTE: mpv only consults `alang`/`slang` while *loading* a file, so this does
 * NOT re-pick tracks for whatever is playing right now — it takes effect on the
 * next file that gets loaded. Use setAudioTrack()/setSubtitleTrack() to change
 * the current file's selection.
 */
export async function applyLanguagePreferences(): Promise<void> {
	if (!initialized) return;
	const alang = get(preferredAudioLang);
	const slang = get(preferredSubtitleLang);
	try {
		// Empty string clears the preference list, restoring mpv's own defaults.
		await setProperty('alang', alang === 'auto' ? '' : alang);
		await setProperty('slang', slang === 'auto' ? '' : slang);
		log.info('[player] Language preferences applied (next file):', { alang, slang });
	} catch (e) {
		log.warn('[player] Failed to apply language preferences:', e);
	}
}

/**
 * Keep mpv in sync when the user edits the language preferences in Settings.
 * The initial values are already passed through buildMpvConfig(), so the first
 * (immediate) emission of each store is skipped.
 */
function attachLanguagePreferenceWatchers(): void {
	if (unsubscribeLangPrefs.length > 0) return;
	for (const store of [preferredAudioLang, preferredSubtitleLang]) {
		let first = true;
		unsubscribeLangPrefs.push(
			store.subscribe(() => {
				if (first) {
					first = false;
					return;
				}
				applyLanguagePreferences();
			})
		);
	}
}

// --- Anime4K shaders ---

// Shader pipeline templates per mode. Entries with {V} get the variant substituted;
// entries without {V} are variant-independent (shared across all quality levels).
const SHADER_PIPELINES: Record<string, string[]> = {
	A: [
		'Anime4K_Clamp_Highlights.glsl',
		'Anime4K_Restore_CNN_{V}.glsl',
		'Anime4K_Upscale_CNN_x2_{V}.glsl',
		'Anime4K_AutoDownscalePre_x2.glsl',
		'Anime4K_AutoDownscalePre_x4.glsl',
		'Anime4K_Upscale_CNN_x2_M.glsl',
	],
	B: [
		'Anime4K_Clamp_Highlights.glsl',
		'Anime4K_Restore_CNN_Soft_{V}.glsl',
		'Anime4K_Upscale_CNN_x2_{V}.glsl',
		'Anime4K_AutoDownscalePre_x2.glsl',
		'Anime4K_AutoDownscalePre_x4.glsl',
		'Anime4K_Upscale_CNN_x2_M.glsl',
	],
	C: [
		'Anime4K_Clamp_Highlights.glsl',
		'Anime4K_Upscale_Denoise_CNN_x2_{V}.glsl',
		'Anime4K_AutoDownscalePre_x2.glsl',
		'Anime4K_AutoDownscalePre_x4.glsl',
		'Anime4K_Upscale_CNN_x2_{V}.glsl',
	],
};

function getShaderFiles(mode: ShaderMode, variant: ShaderVariant): string[] {
	const pipeline = SHADER_PIPELINES[mode];
	if (!pipeline) return [];
	return pipeline.map((s) => s.replace(/\{V\}/g, variant));
}

/**
 * Absolute path of the shader directory, or null if it cannot be found.
 *
 * Resolved by Rust (`shader_dir`), which is the only side that knows the real
 * location in both a packaged bundle and a dev run, and which verifies the
 * directory exists. See that command for why the previous
 * `resolveResource('shaders')` was wrong in both modes.
 */
async function getShaderDir(): Promise<string | null> {
	try {
		return await invoke<string>('shader_dir');
	} catch (e) {
		log.error('[player] Anime4K shaders unavailable:', e);
		return null;
	}
}

export async function loadShaderPreset(mode: ShaderMode, variant: ShaderVariant, showOsd = true): Promise<void> {
	if (!initialized) return;

	if (mode === 'off') {
		await setProperty('glsl-shaders', '');
		activeShaderMode.set('off');
		log.info('[player] Shaders disabled');
		if (showOsd) await command('show-text', ['Anime4K: Off', '2000']).catch(() => {});
		return;
	}

	const shaders = getShaderFiles(mode, variant);
	if (shaders.length === 0) return;

	const shaderDir = await getShaderDir();
	if (!shaderDir) {
		// Never claim success here again. mpv accepts `glsl-shaders` paths it
		// cannot open and only complains at render time, so a bad path used to
		// produce a cheerful "shaders loaded" line and no upscaling whatsoever.
		notify('error', get(t)['player.shadersMissing'], {
			detail: 'shader_dir could not locate the bundled Anime4K .glsl files.',
		});
		activeShaderMode.set('off');
		return;
	}
	log.info(`[player] Loading Anime4K shaders: mode=${mode}, variant=${variant}, dir=${shaderDir}`);

	// Set all shaders in a single property update — no pause/resume needed.
	// mpv recompiles the shader pipeline in one pass without freezing playback.
	const separator = navigator.platform?.toLowerCase().includes('win') ? ';' : ':';
	const shaderPaths = shaders.map((s) => `${shaderDir}/${s}`).join(separator);

	try {
		await setProperty('glsl-shaders', shaderPaths);
		activeShaderMode.set(mode);
		activeShaderVariant.set(variant);
		log.info(`[player] Anime4K shaders loaded: ${shaders.join(', ')}`);

		if (showOsd) {
			const modeLabels: Record<string, string> = { A: 'Type A (1080p)', B: 'Type B (720p)', C: 'Type C (480p)' };
			await command('show-text', [`Anime4K: ${modeLabels[mode] ?? mode}`, '2000']).catch(() => {});
		}
	} catch (e) {
		log.warn('[player] Failed to load shaders:', e);
	}
}

async function applyUserShaderPreset(): Promise<void> {
	const mode = get(defaultShaderMode);
	const variant = get(defaultShaderVariant);
	await loadShaderPreset(mode, variant, false); // silent on initial load
}

export async function toggleFullscreen(): Promise<void> {
	const win = getCurrentWindow();
	const entering = !get(playerFullscreen);
	if (isMacOS) {
		// Native fullscreen is a no-go with the child-window embedding: AppKit does
		// move child windows into the fullscreen Space, but re-orders them ABOVE the
		// parent, so the video covers the whole UI (verified in the spike; re-adding
		// the child with NSWindowBelow after the transition doesn't stick either).
		//
		// This used to be `setDecorations(false)` + `maximize()`, which had two
		// faults. It was not full screen — `maximize` uses the screen's
		// *visibleFrame*, so the menu bar and the Dock stayed on top of the video —
		// and toggling decorations on a `transparent: true` window leaves the title
		// bar without its backing material on the way back, so the top strip of the
		// window turned see-through and showed whatever application was behind
		// dnjplayer. Both were reported on 1.5.0.
		//
		// commands::fullscreen does it natively instead: auto-hide the menu bar and
		// Dock, size the window to the screen's full frame, and make the title bar
		// invisible without touching the style mask's `Titled` bit. No Space
		// transition, so the child-window ordering that puts the video under the UI
		// survives, and no decoration toggle to corrupt the frame.
		await invoke('set_immersive_fullscreen', { on: entering });
	} else {
		await win.setFullscreen(entering);
	}
	// Drives the layout: hides sidebar/chrome and fills the viewport so the video
	// surface (which tracks the video area) covers the whole screen.
	playerFullscreen.set(entering);
	// mpv re-applies its own app icon whenever it rebuilds its window, which this
	// transition can trigger, so claim the Dock tile back afterwards too.
	invoke('restore_app_icon').catch(() => {});
}

/** Exit fullscreen if active (e.g. when leaving the player page). */
export async function exitFullscreen(): Promise<void> {
	if (get(playerFullscreen)) {
		await toggleFullscreen();
	}
}

export async function isFullscreen(): Promise<boolean> {
	return get(playerFullscreen);
}

export function isPlayerInitialized(): boolean {
	return initialized;
}

// --- Dev smoke harness ---

/**
 * Development only: load `path` on the player page, unpaused and looping, so the
 * embedding can be exercised without clicking through the file browser. Driven
 * by the DNJ_SMOKE_PLAY env var via the `dev_smoke_play_path` command; that
 * command returns null in release builds, so this is unreachable for users.
 */
export async function devSmokePlay(path: string): Promise<void> {
	const name = path.split(/[\\/]/).pop() ?? path;
	playlist.set([{ source: 'local', path, name }]);
	playlistIndex.set(0);
	await loadVideo(path, name);
	await setProperty('loop-file', 'inf');
	// Harness only: automated runs must not blast audio at whoever is at the desk.
	await setProperty('mute', 'yes');
	await setProperty('pause', 'no');
	log.info('[player] smoke playback started:', path);
}

// --- Queue pre-open ----------------------------------------------------------
//
// Why this exists, and why it is shaped like this, is documented in full in
// utils/preopen.ts (including the numbers). The short version: mpv's own
// `prefetch-playlist` is the only thing that can hide the 6 s of three
// sequential HTTP opens a Matroska stream costs, but it only prefetches entries
// that are in MPV'S playlist — and our queue is a Svelte store.
//
// So we lend mpv exactly ONE entry, ~45 s before we need it, and then consume it
// with `playlist-next`. mpv's playlist never holds more than two entries, our
// `playlistIndex` stays the single source of truth for the queue, and every
// existing path (auto-advance, resume, watched, error retry) keeps working.

/** The entry currently sitting in mpv's playlist behind the one that is playing. */
interface PreopenedEntry {
	/** Index in OUR playlist. */
	index: number;
	/** The item, so a queue edit can be detected by identity. */
	item: PlaylistItem;
	/** The exact URL handed to mpv. Compared against a fresh resolve before use. */
	url: string;
}

let preopened: PreopenedEntry | null = null;
// Guards against re-entering the append while the previous one is still in
// flight (the time-pos observer fires ~1/s, URL resolution can take longer).
let preopenInFlight = false;

/** Forget our bookkeeping. Does NOT touch mpv (the caller knows whether it must). */
function cancelPreopenTracking(): void {
	preopened = null;
	preopenInFlight = false;
}

/**
 * Drop any pre-opened entry from mpv's playlist as well.
 *
 * `playlist-clear` removes every entry EXCEPT the one playing, and playback
 * carries on untouched (verified). Call this whenever the queue changes under
 * us, so mpv can never advance into an item the user has removed or reordered.
 */
export async function cancelPreopen(): Promise<void> {
	const had = preopened !== null;
	cancelPreopenTracking();
	if (!had || !initialized) return;
	try {
		await command('playlist-clear', []);
		log.debug('[player] Pre-opened entry dropped from mpv\'s playlist');
	} catch (e) {
		log.warn('[player] Could not clear the mpv playlist:', e);
	}
}

/**
 * Called on every `time-pos` tick. Appends the next queue item to mpv's
 * playlist once the playhead is within PREOPEN_LEAD_SECONDS of the end.
 *
 * Fire-and-forget and entirely best effort: anything that goes wrong here just
 * means the next episode starts the slow way, which is what happens today.
 */
function maybePreopenNext(position: number | null): void {
	if (!initialized || preopenInFlight || !get(playerActive)) return;

	const items = get(playlist);
	const index = get(playlistIndex);
	const next = items[index + 1];
	const currentUrl = get(currentVideoUrl);
	if (!next || !currentUrl) return;

	// The profile gate. `next.source === 'local'` means mpv will be handed a bare
	// path, i.e. the local profile; anything else is a WebDAV URL. Comparing that
	// against the CURRENT url's remoteness is what keeps us from opening a stream
	// with the cache switched off (see PreopenInput.sameStreamProfile).
	const sameStreamProfile = isRemoteUrl(currentUrl) === (next.source !== 'local');

	if (
		!shouldPreopenNext({
			position,
			duration: get(duration),
			index,
			length: items.length,
			sameStreamProfile,
			alreadyArmed: preopened?.index === index + 1,
		})
	) {
		return;
	}

	preopenInFlight = true;
	void (async () => {
		try {
			// For a Mega item this is normally a cache hit put there by
			// prefetchAround(); it still re-checks the MEGAcmd generation token, so
			// a URL we are about to freeze into mpv's playlist is at least known
			// good as of this moment.
			const url = await resolvePlayableUrl(next);
			// The queue may have moved while we were resolving.
			if (get(playlistIndex) !== index || get(playlist)[index + 1] !== next) return;
			await command('loadfile', [url, 'append']);
			preopened = { index: index + 1, item: next, url };
			log.info(
				`[player] Pre-opened queue item ${index + 1} ("${next.name}") ` +
					`${PREOPEN_LEAD_SECONDS}s ahead; mpv is opening its demuxer now`
			);
		} catch (e) {
			log.warn('[player] Could not pre-open the next queue item:', e);
		} finally {
			preopenInFlight = false;
		}
	})();
}

/**
 * Advance to an already pre-opened next item, reusing mpv's warm demuxer.
 * Returns false if there is nothing usable, in which case the caller must fall
 * back to the cold loadVideo() path.
 *
 * The URL check is the safety net for an expired WebDAV link: resolvePlayableUrl
 * consults the MEGAcmd generation token, so if the server restarted during the
 * ~45 s the entry sat in mpv's playlist, the fresh URL differs from the frozen
 * one and we take the cold path with the good URL instead of playing into a
 * dead socket.
 */
async function advanceToPreopened(index: number, item: PlaylistItem): Promise<boolean> {
	const armed = preopened;
	if (!armed || armed.index !== index || armed.item !== item) return false;

	try {
		const fresh = await resolvePlayableUrl(item);
		if (fresh !== armed.url) {
			log.warn('[player] The pre-opened URL went stale; falling back to a cold load');
			await cancelPreopen();
			return false;
		}
		// `playlist-next` STOPS playback if there is nothing after the current
		// entry and still reports success (verified), so never issue it on a guess:
		// confirm mpv really is holding the second entry.
		const count = await getProperty('playlist-count', 'int64');
		if (typeof count !== 'number' || count < 2) {
			log.warn(`[player] mpv no longer holds the pre-opened entry (count=${count}); cold load`);
			cancelPreopenTracking();
			return false;
		}

		await prepareForNextFile(armed.url);
		await command('playlist-next', ['force']);
		// Drop the entry we just left, so mpv's playlist is back to a single entry
		// and the next pre-open starts from a known shape. Without this it grows by
		// one per episode and `playlist-count >= 2` above stops meaning anything.
		// Verified safe immediately after playlist-next: playback is unaffected
		// (playlist-clear never touches the entry that is playing).
		try {
			await command('playlist-clear', []);
		} catch (e) {
			log.warn('[player] Could not tidy the mpv playlist after advancing:', e);
		}
		await commitCurrentFile(armed.url, item.name);
		log.info(`[player] Advanced to the pre-opened item "${item.name}" (warm demuxer)`);
		return true;
	} catch (e) {
		log.warn('[player] Warm advance failed; falling back to a cold load:', e);
		cancelPreopenTracking();
		return false;
	}
}

// --- Playlist navigation ---

let autoAdvancing = false;

export async function playNext(): Promise<boolean> {
	const items = get(playlist);
	const idx = get(playlistIndex);
	if (idx >= items.length - 1) return false;

	const nextIdx = idx + 1;
	const item = items[nextIdx];
	playlistIndex.set(nextIdx);

	try {
		// Warm path first: if this item is the one mpv has already opened, moving to
		// it is effectively instant (0.01 s measured) instead of a cold three-round-
		// trip open. Falls through to the cold path on any doubt.
		if (!(await advanceToPreopened(nextIdx, item))) {
			const url = await resolvePlayableUrl(item);
			await loadVideo(url, item.name);
		}
		await setProperty('pause', 'no');
		prefetchAround(nextIdx);
		// Must go through toDbKey: a bare path is read back as a Mega path, which
		// would hide the "watched" badge for local files and make the history row
		// try to resolve a WebDAV URL for a local path.
		markWatched(toDbKey(item.source, item.path), item.name).catch((e) =>
			log.warn('[player] Failed to mark watched:', e)
		);
		return true;
	} catch (e) {
		log.error('[player] playNext failed:', e);
		return false;
	}
}

export async function playPrev(): Promise<boolean> {
	const items = get(playlist);
	const idx = get(playlistIndex);
	if (idx <= 0) return false;

	const prevIdx = idx - 1;
	const item = items[prevIdx];
	playlistIndex.set(prevIdx);

	try {
		const url = await resolvePlayableUrl(item);
		await loadVideo(url, item.name);
		await setProperty('pause', 'no');
		prefetchAround(prevIdx);
		markWatched(toDbKey(item.source, item.path), item.name).catch((e) =>
			log.warn('[player] Failed to mark watched:', e)
		);
		return true;
	} catch (e) {
		log.error('[player] playPrev failed:', e);
		return false;
	}
}

/** Advance to the next item once, guarded against re-entry. */
function triggerAutoAdvance(): void {
	if (autoAdvancing) return;
	const items = get(playlist);
	const idx = get(playlistIndex);
	if (idx >= items.length - 1) return; // nothing to advance to
	autoAdvancing = true;
	playNext().finally(() => {
		autoAdvancing = false;
	});
}

export function checkAutoAdvance(timePos: number | null, dur: number | null): void {
	if (!timePos || !dur || dur <= 5) return;
	// Fallback heuristic; the primary trigger is mpv's eof-reached property.
	if (timePos >= dur - 1) {
		triggerAutoAdvance();
	}
}
