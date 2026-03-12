import { derived } from 'svelte/store';
import { language } from '$lib/stores/settings';
import { en } from './en';
import { es } from './es';

const translations: Record<string, Record<string, string>> = { en, es };

// Proxy that returns the key name as fallback if a translation is missing,
// preventing undefined values from breaking the UI.
function withFallback(dict: Record<string, string>): Record<string, string> {
	return new Proxy(dict, {
		get(target, prop: string) {
			return target[prop] ?? prop;
		},
	});
}

export const t = derived(language, ($lang) =>
	withFallback(translations[$lang] || translations.en),
);
