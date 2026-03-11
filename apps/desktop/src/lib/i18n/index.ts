import { derived } from 'svelte/store';
import { language } from '$lib/stores/settings';
import { en } from './en';
import { es } from './es';

const translations: Record<string, Record<string, string>> = { en, es };

export const t = derived(language, ($lang) => translations[$lang] || translations.en);
