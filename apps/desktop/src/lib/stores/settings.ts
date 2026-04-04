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
