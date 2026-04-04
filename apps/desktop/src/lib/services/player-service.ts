import {
	init,
	command,
	setProperty,
	getProperty,
	observeProperties,
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
	hue
} from '$lib/stores/player';
import { get } from 'svelte/store';
import { playerActive, currentVideoUrl, currentVideoTitle, playlist, playlistIndex } from '$lib/stores/player-ui';
import type { VideoAdjustments, ShaderMode, ShaderVariant } from '$lib/types/player';
import { markWatched } from '$lib/services/db-service';
import { megaGetWebdavUrl } from '$lib/services/mega-service';
import { defaultShaderMode, defaultShaderVariant } from '$lib/stores/settings';
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
] as const satisfies MpvObservableProperty[];

const isMacOS = navigator.platform?.toLowerCase().includes('mac') ?? false;
const isWindows = navigator.platform?.toLowerCase().includes('win') ?? false;

const MPV_CONFIG: MpvConfig = {
	initialOptions: {
		'hwdec': 'auto-safe',
		'keep-open': 'yes',
		'osc': 'no',
		'input-default-bindings': 'no',
		'input-vo-keyboard': 'no',
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

let unlistenProperties: (() => void) | null = null;
let initialized = false;
let mpvWindowAttached = false;

/**
 * Initialize mpv player and start observing properties.
 */
export async function initPlayer(): Promise<void> {
	if (initialized) return;

	log.info('[player] Initializing mpv with config:', JSON.stringify(MPV_CONFIG.initialOptions));
	try {
		await init(MPV_CONFIG);
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
			}
		}
	);
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
	try {
		await invoke('hide_mpv_window');
	} catch (e) {
		// Silently ignore — window may already be gone
	}
}

/**
 * Stop playback.
 */
export async function stopVideo(): Promise<void> {
	if (!initialized) return;
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
	if (isMacOS) {
		// On macOS with child NSWindow, native fullscreen (new Space) doesn't
		// bring the child window along. Use maximize + decorations toggle instead.
		const isMax = await win.isMaximized();
		if (isMax) {
			await win.unmaximize();
			await win.setDecorations(true);
		} else {
			await win.setDecorations(false);
			await win.maximize();
		}
	} else {
		const isFs = await win.isFullscreen();
		await win.setFullscreen(!isFs);
	}
}

export async function isFullscreen(): Promise<boolean> {
	const win = getCurrentWindow();
	if (isMacOS) {
		return win.isMaximized();
	}
	return win.isFullscreen();
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
		const url = await megaGetWebdavUrl(item.megaPath);
		await loadVideo(url, item.name);
		await setProperty('pause', 'no');
		markWatched(item.megaPath, item.name).catch((e) =>
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
		const url = await megaGetWebdavUrl(item.megaPath);
		await loadVideo(url, item.name);
		await setProperty('pause', 'no');
		markWatched(item.megaPath, item.name).catch((e) =>
			log.warn('[player] Failed to mark watched:', e)
		);
		return true;
	} catch (e) {
		log.error('[player] playPrev failed:', e);
		return false;
	}
}

export function checkAutoAdvance(timePos: number | null, dur: number | null): void {
	if (autoAdvancing || !timePos || !dur || dur <= 5) return;
	if (timePos >= dur - 1) {
		autoAdvancing = true;
		playNext().finally(() => {
			autoAdvancing = false;
		});
	}
}
