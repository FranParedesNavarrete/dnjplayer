import { writable } from 'svelte/store';
import { browser } from '$app/environment';

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

// Anime4K defaults
export const defaultShaderMode = writable<'A' | 'B' | 'C' | 'off'>('A');
export const defaultShaderVariant = writable<'S' | 'M' | 'L' | 'VL' | 'UL'>('VL');
