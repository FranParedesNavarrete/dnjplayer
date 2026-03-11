import { writable } from 'svelte/store';
import type { MegaEntry } from '$lib/types/mega';

export const isConnected = writable(false);
export const userEmail = writable<string | null>(null);
export const currentPath = writable('/');
export const entries = writable<MegaEntry[]>([]);
export const isLoading = writable(false);
export const megaError = writable<string | null>(null);
