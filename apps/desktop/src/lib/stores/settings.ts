import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { ShaderMode, ShaderVariant } from '$lib/types/player';

// Language preference
export type Language = 'en' | 'es';

function createLanguageStore() {
	const stored = browser ? localStorage.getItem('dnjplayer-lang') : null;
	const initial: Language = stored === 'es' ? 'es' : 'en';

	const { subscribe, set } = writable<Language>(initial);

	return {
		subscribe,
		set(value: Language) {
			set(value);
			if (browser) {
				localStorage.setItem('dnjplayer-lang', value);
			}
		},
	};
}

export const language = createLanguageStore();

// Anime4K shader preferences (persisted to localStorage)

const VALID_MODES: ShaderMode[] = ['A', 'B', 'C', 'off'];
const VALID_VARIANTS: ShaderVariant[] = ['S', 'M', 'L', 'VL', 'UL'];

function createShaderModeStore() {
	const stored = browser ? localStorage.getItem('dnjplayer-shader-mode') : null;
	const initial: ShaderMode = stored && VALID_MODES.includes(stored as ShaderMode)
		? (stored as ShaderMode)
		: 'A';

	const { subscribe, set } = writable<ShaderMode>(initial);

	return {
		subscribe,
		set(value: ShaderMode) {
			set(value);
			if (browser) {
				localStorage.setItem('dnjplayer-shader-mode', value);
			}
		},
	};
}

function createShaderVariantStore() {
	const stored = browser ? localStorage.getItem('dnjplayer-shader-variant') : null;
	const initial: ShaderVariant = stored && VALID_VARIANTS.includes(stored as ShaderVariant)
		? (stored as ShaderVariant)
		: 'VL';

	const { subscribe, set } = writable<ShaderVariant>(initial);

	return {
		subscribe,
		set(value: ShaderVariant) {
			set(value);
			if (browser) {
				localStorage.setItem('dnjplayer-shader-variant', value);
			}
		},
	};
}

export const defaultShaderMode = createShaderModeStore();
export const defaultShaderVariant = createShaderVariantStore();

// Player controls auto-hide delay (milliseconds). 0 = never hide.
export const CONTROLS_HIDE_DELAYS = [0, 5000, 10000, 15000, 30000, 60000] as const;
export type ControlsHideDelay = (typeof CONTROLS_HIDE_DELAYS)[number];

function createControlsHideDelayStore() {
	const stored = browser ? localStorage.getItem('dnjplayer-controls-delay') : null;
	const parsed = stored ? parseInt(stored, 10) : 10000;
	const initial: ControlsHideDelay = (CONTROLS_HIDE_DELAYS as readonly number[]).includes(parsed)
		? (parsed as ControlsHideDelay)
		: 10000;

	const { subscribe, set } = writable<ControlsHideDelay>(initial);

	return {
		subscribe,
		set(value: ControlsHideDelay) {
			set(value);
			if (browser) {
				localStorage.setItem('dnjplayer-controls-delay', String(value));
			}
		},
	};
}

export const controlsHideDelay = createControlsHideDelayStore();
