import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'dnjplayer-theme';

function getInitialTheme(): Theme {
	if (browser) {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'light' || stored === 'dark') return stored;
	}
	return 'dark'; // default
}

function createThemeStore() {
	const { subscribe, set, update } = writable<Theme>(getInitialTheme());

	return {
		subscribe,
		set(value: Theme) {
			set(value);
			if (browser) {
				localStorage.setItem(STORAGE_KEY, value);
				applyTheme(value);
			}
		},
		toggle() {
			update((current) => {
				const next: Theme = current === 'dark' ? 'light' : 'dark';
				if (browser) {
					localStorage.setItem(STORAGE_KEY, next);
					applyTheme(next);
				}
				return next;
			});
		},
		init() {
			if (browser) {
				applyTheme(getInitialTheme());
			}
		},
	};
}

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	root.classList.remove('dark', 'light');
	root.classList.add(theme);
}

export const theme = createThemeStore();
