import { writable, derived } from 'svelte/store';

// mpv playback state
export const isPaused = writable(true);
export const currentTime = writable<number | null>(null);
export const duration = writable<number | null>(null);
export const filename = writable<string | null>(null);
export const videoWidth = writable<number | null>(null);
export const videoHeight = writable<number | null>(null);
export const volume = writable(100);
export const speed = writable(1.0);

// Video adjustments
export const brightness = writable(0);
export const contrast = writable(0);
export const saturation = writable(0);
export const gamma = writable(0);
export const hue = writable(0);

// Anime4K shader state
export const activeShaderMode = writable<'A' | 'B' | 'C' | 'off'>('off');
export const shaderVariant = writable<'S' | 'M' | 'L' | 'VL' | 'UL'>('VL');

// OSD (on-screen display) message — shown briefly over the video
export const osdMessage = writable<string | null>(null);

// Derived
export const progress = derived(
	[currentTime, duration],
	([$time, $dur]) => ($time != null && $dur != null && $dur > 0) ? $time / $dur : 0
);

export const resolution = derived(
	[videoWidth, videoHeight],
	([$w, $h]) => ($w && $h) ? `${$w}x${$h}` : null
);
