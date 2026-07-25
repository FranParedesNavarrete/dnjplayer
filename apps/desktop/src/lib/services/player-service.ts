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
	currentSid
} from '$lib/stores/player';
import { get } from 'svelte/store';
import { playerActive, currentVideoUrl, currentVideoTitle, playlist, playlistIndex, playerFullscreen } from '$lib/stores/player-ui';
import type { VideoAdjustments, ShaderMode, ShaderVariant, MediaTrack } from '$lib/types/player';
import { markWatched, toDbKey } from '$lib/services/db-service';
import { resolvePlayableUrl, prefetchAround } from '$lib/services/prefetch-service';
import {
	defaultShaderMode,
	defaultShaderVariant,
	preferredAudioLang,
	preferredSubtitleLang
} from '$lib/stores/settings';
import { activeShaderMode, shaderVariant as activeShaderVariant } from '$lib/stores/player';
import { resolveResource } from '@tauri-apps/api/path';
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
] as const satisfies MpvObservableProperty[];

const isMacOS = navigator.platform?.toLowerCase().includes('mac') ?? false;
const isWindows = navigator.platform?.toLowerCase().includes('win') ?? false;

/**
 * Build the mpv init config. This is a function (not a const) so the persisted
 * language preferences are read at init time rather than at module load time.
 */
function buildMpvConfig(): MpvConfig {
	const alang = get(preferredAudioLang);
	const slang = get(preferredSubtitleLang);
	return {
		initialOptions: {
			'hwdec': 'auto-safe',
			'keep-open': 'yes',
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
			// On macOS/Windows, mpv must create its own separate window so we can attach it
			// as a child/owned window of the Tauri window via native APIs.
			// 'force-window' ensures mpv creates a window; we override 'wid' to prevent
			// the plugin from injecting the Tauri HWND (which would embed behind the webview).
			// wid=0 means "no parent window" so mpv creates a standalone top-level window.
			...((isMacOS || isWindows) ? { 'force-window': 'yes' } : {}),
			...(isWindows ? { 'wid': 0 } : {}),
		},
		observedProperties: OBSERVED_PROPERTIES,
	};
}

let unlistenProperties: (() => void) | null = null;
let unlistenEvents: (() => void) | null = null;
let unsubscribeLangPrefs: (() => void)[] = [];
let initialized = false;
let mpvWindowAttached = false;

// In-flight init, shared by concurrent callers. Without this, two overlapping
// loadVideo() calls both see `initialized === false` and run init() twice, and
// the second observeProperties/listenEvents pair overwrites the first handles,
// which then can never be unregistered (double-processed events + a leak).
let initPromise: Promise<void> | null = null;

// Bumped on every loadVideo(). Async track reads compare against it so a reply
// for the previous file can't overwrite the current file's tracks.
let loadGeneration = 0;
// Watchdog timer id, so it can be cancelled on teardown or on the next file.

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
	const mpvConfig = buildMpvConfig();
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
				case 'eof-reached':
					// Reliable end-of-file signal (keep-open pauses at EOF). Advance
					// to the next item, or — if this was the last one — leave
					// fullscreen so the sidebar/UI is usable again.
					if (data === true || String(data) === 'yes') {
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
	unlistenEvents = await listenEvents((event) => {
		if (event.event !== 'file-loaded') return;
		refreshSelectedTracks();
	});

	attachLanguagePreferenceWatchers();
}

/**
 * Destroy mpv player and clean up.
 */
export async function destroyPlayer(): Promise<void> {
	if (!initialized) return;
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
	await destroy();
	initialized = false;
	playerActive.set(false);
}

/**
 * Load a video file from a URL (WebDAV or local path).
 */
export async function loadVideo(url: string, title?: string): Promise<void> {
	log.info('[player] loadVideo called:', { url, title, initialized, isMacOS, isWindows });

	if (!initialized) {
		log.info('[player] Not initialized, calling initPlayer...');
		await initPlayer();
	}

	// Invalidate the previous file's tracks straight away. Leaving them in place
	// would show the old file's audio/subtitle options until mpv reports the new
	// ones, and picking one would set a track id that belongs to another file.
	loadGeneration++;
	audioTracks.set([]);
	subtitleTracks.set([]);
	currentAid.set(null);
	currentSid.set(null);

	log.info('[player] Sending loadfile command...');
	try {
		await command('loadfile', [url]);
	} catch (e) {
		log.error('[player] loadfile command FAILED:', e);
		throw e;
	}
	log.info('[player] loadfile command succeeded');

	// Start paused so the user decides when to play
	await setProperty('pause', 'yes');

	currentVideoUrl.set(url);
	currentVideoTitle.set(title ?? null);
	playerActive.set(true);

	// On macOS/Windows, mpv creates a separate window. Attach it as a child of the Tauri window
	// so it appears inside the app's player area instead of as a floating window.
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
 * Resize/reposition the mpv child window to match the video area.
 * Called by Player.svelte's ResizeObserver when the video area changes.
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
 * Hide the mpv child window completely (orderOut on macOS, SW_HIDE on Windows).
 * Used when stopping or navigating away from the player.
 */
export async function hideMpvOverlay(): Promise<void> {
	if (!(isMacOS || isWindows)) return;
	mpvWindowAttached = false;
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
 * Re-show the mpv window after navigating back to the player page.
 * The rAF loop in Player.svelte will call resizeMpvOverlay() which
 * triggers the Rust side to re-show the hidden window (orderFront/ShowWindow).
 */
export function showMpvOverlay(): void {
	if (!(isMacOS || isWindows)) return;
	if (!initialized) return;
	// Mark as attached so resizeMpvOverlay() sends position updates,
	// which in turn re-show the hidden native window.
	mpvWindowAttached = true;
	// Force the rAF loop to send a resize on the next frame
	// by invalidating the cached rect in Player.svelte (handled via the flag).
}

/**
 * Stop playback.
 */
export async function stopVideo(): Promise<void> {
	if (!initialized) return;
	// Leave fullscreen so the user isn't stuck on a chrome-less screen after stop.
	await exitFullscreen();
	// Clear flags FIRST so the rAF loop stops resizing immediately
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

/** Coerce mpv's loose booleans ("yes"/"no"/1/0/true) into a real boolean. */
function asFlag(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') return value === 'yes' || value === 'true' || value === '1';
	return false;
}

/** Non-empty string or undefined — mpv omits absent fields, and can send "". */
function asOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse an `aid`/`sid` value. mpv returns the literal "no" when the stream is
 * disabled and "auto" before a track has been picked, otherwise a track id
 * (which may arrive as a number or as a numeric string).
 */
function parseTrackId(value: unknown): number | 'no' | null {
	if (value == null) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'boolean') return value ? null : 'no';
	if (typeof value === 'string') {
		if (value === 'no' || value === 'false') return 'no';
		if (value === 'auto' || value === '') return null;
		const parsed = parseInt(value, 10);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

/**
 * Defensive parser for mpv's `track-list`. Keys are kebab/snake-cased and most
 * fields are optional, so nothing here is assumed: entries without a usable
 * numeric `id` or a known `type` are dropped instead of producing junk tracks.
 */
export function parseTrackList(raw: unknown): MediaTrack[] {
	// The plugin normally hands over already-decoded JSON, but tolerate a string
	// payload in case a transport ever passes the node through verbatim.
	let value = raw;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) return [];

	const tracks: MediaTrack[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue;
		const rec = entry as Record<string, unknown>;

		const rawType = rec['type'];
		if (rawType !== 'video' && rawType !== 'audio' && rawType !== 'sub') continue;

		const rawId = rec['id'];
		const id = typeof rawId === 'number' ? rawId : parseInt(String(rawId ?? ''), 10);
		if (!Number.isFinite(id)) continue;

		tracks.push({
			id,
			type: rawType,
			title: asOptionalString(rec['title']),
			lang: asOptionalString(rec['lang']),
			codec: asOptionalString(rec['codec']),
			selected: asFlag(rec['selected']),
			// mpv sets `external: true` and fills `external-filename` for sub-add'ed
			// or auto-loaded sidecar files; treat either as external.
			external: asFlag(rec['external']) || asOptionalString(rec['external-filename']) !== undefined,
			default: asFlag(rec['default']),
			forced: asFlag(rec['forced']),
		});
	}
	return tracks;
}

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

async function getShaderDir(): Promise<string> {
	try {
		return await resolveResource('shaders');
	} catch {
		// In dev mode, shaders are in the static directory served by Vite
		return 'shaders';
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
		// On macOS with child NSWindow, native fullscreen (new Space) doesn't
		// bring the child window along. Use maximize + decorations toggle instead.
		if (entering) {
			await win.setDecorations(false);
			await win.maximize();
		} else {
			await win.unmaximize();
			await win.setDecorations(true);
		}
	} else {
		await win.setFullscreen(entering);
	}
	// Drives the layout: hides sidebar/chrome and fills the viewport so the mpv
	// overlay (which tracks the video area) covers the whole screen.
	playerFullscreen.set(entering);
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
		const url = await resolvePlayableUrl(item);
		await loadVideo(url, item.name);
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
