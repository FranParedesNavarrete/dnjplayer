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
	subtitleTracks,
	currentSubtitleId
} from '$lib/stores/player';
import { playerActive, currentVideoUrl, currentVideoTitle } from '$lib/stores/player-ui';
import type { VideoAdjustments, ShaderMode } from '$lib/types/player';

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

const MPV_CONFIG: MpvConfig = {
	initialOptions: {
		'hwdec': 'auto-safe',
		'keep-open': 'yes',
		'osc': 'no',
		'input-default-bindings': 'no',
		'input-vo-keyboard': 'no',
	},
	observedProperties: OBSERVED_PROPERTIES,
};

let unlistenProperties: (() => void) | null = null;
let initialized = false;
let mpvWindowAttached = false;
const isMacOS = navigator.platform?.toLowerCase().includes('mac') ?? false;

/**
 * Initialize mpv player and start observing properties.
 */
export async function initPlayer(): Promise<void> {
	if (initialized) return;

	await init(MPV_CONFIG);
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
	if (!initialized) await initPlayer();
	await command('loadfile', [url]);
	currentVideoUrl.set(url);
	currentVideoTitle.set(title ?? null);
	playerActive.set(true);

	// On macOS, mpv creates a separate window. Attach it as a child of the Tauri window.
	if (isMacOS && !mpvWindowAttached) {
		// Wait for mpv to create its window
		await new Promise((r) => setTimeout(r, 500));
		try {
			const windowId = await getProperty('window-id', 'int64');
			if (windowId && typeof windowId === 'number' && windowId !== 0) {
				await invoke('attach_mpv_to_window', { mpvWindowPtr: windowId });
				mpvWindowAttached = true;
				console.log('[player] mpv window attached as child, window-id:', windowId);
			}
		} catch (e) {
			console.warn('[player] Failed to attach mpv window:', e);
		}
	}

	// Fetch subtitle tracks after video loads
	setTimeout(() => getSubtitleTracks(), 1000);
}

/**
 * Resize/reposition the mpv overlay window (macOS only).
 * Called by Player.svelte's ResizeObserver when the video area changes.
 */
export async function resizeMpvOverlay(x: number, y: number, width: number, height: number): Promise<void> {
	if (!isMacOS || !mpvWindowAttached) return;
	try {
		await invoke('resize_mpv_window', { x, y, width, height });
	} catch (e) {
		console.warn('[player] Failed to resize mpv window:', e);
	}
}

/**
 * Stop playback.
 */
export async function stopVideo(): Promise<void> {
	if (!initialized) return;
	await command('stop', []);
	mpvWindowAttached = false;
	playerActive.set(false);
	currentVideoUrl.set(null);
	currentVideoTitle.set(null);
	currentTime.set(null);
	duration.set(null);
	filename.set(null);
	subtitleTracks.set([]);
	currentSubtitleId.set(0);
}

// --- Subtitle tracks ---

export async function getSubtitleTracks(): Promise<void> {
	if (!initialized) return;
	try {
		const trackList = await getProperty('track-list', 'node');
		if (Array.isArray(trackList)) {
			const subs = trackList
				.filter((t: any) => t.type === 'sub')
				.map((t: any) => ({
					id: t.id as number,
					title: t.title as string | undefined,
					lang: t.lang as string | undefined,
				}));
			subtitleTracks.set(subs);
		} else {
			subtitleTracks.set([]);
		}
	} catch (e) {
		console.warn('[player] Failed to get subtitle tracks:', e);
		subtitleTracks.set([]);
	}
}

export async function setSubtitleTrack(id: number): Promise<void> {
	if (!initialized) return;
	await setProperty('sid', id === 0 ? 'no' : id);
	currentSubtitleId.set(id);
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

export async function setVideoAdjustment(property: string, value: number): Promise<void> {
	if (!initialized) return;
	await setProperty(property, value);
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
		deband: false,
		deinterlace: false,
	};
}

// --- Anime4K shaders ---

const SHADER_PRESETS: Record<string, string[]> = {
	A: [
		'Anime4K_Clamp_Highlights.glsl',
		'Anime4K_Restore_CNN_VL.glsl',
		'Anime4K_Upscale_CNN_x2_VL.glsl',
		'Anime4K_AutoDownscalePre_x2.glsl',
		'Anime4K_AutoDownscalePre_x4.glsl',
		'Anime4K_Upscale_CNN_x2_M.glsl',
	],
	B: [
		'Anime4K_Clamp_Highlights.glsl',
		'Anime4K_Restore_CNN_Soft_VL.glsl',
		'Anime4K_Upscale_CNN_x2_VL.glsl',
		'Anime4K_AutoDownscalePre_x2.glsl',
		'Anime4K_AutoDownscalePre_x4.glsl',
		'Anime4K_Upscale_CNN_x2_M.glsl',
	],
	C: [
		'Anime4K_Clamp_Highlights.glsl',
		'Anime4K_Upscale_Denoise_CNN_x2_VL.glsl',
		'Anime4K_AutoDownscalePre_x2.glsl',
		'Anime4K_AutoDownscalePre_x4.glsl',
		'Anime4K_Upscale_CNN_x2_VL.glsl',
	],
};

export async function loadShaderPreset(mode: ShaderMode, shaderDir: string): Promise<void> {
	if (!initialized) return;
	await command('change-list', ['glsl-shaders', 'clr', '']);
	if (mode === 'off') return;

	const shaders = SHADER_PRESETS[mode];
	if (!shaders) return;

	for (const shader of shaders) {
		await command('change-list', ['glsl-shaders', 'append', `${shaderDir}/${shader}`]);
	}
}

export async function toggleFullscreen(): Promise<void> {
	const win = getCurrentWindow();
	const isFs = await win.isFullscreen();
	await win.setFullscreen(!isFs);
}

export async function isFullscreen(): Promise<boolean> {
	return getCurrentWindow().isFullscreen();
}

export function isPlayerInitialized(): boolean {
	return initialized;
}
