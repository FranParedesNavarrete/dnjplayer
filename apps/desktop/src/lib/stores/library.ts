import { writable } from 'svelte/store';
import type { LibraryItem } from '$lib/types/player';

export const libraryItems = writable<LibraryItem[]>([]);
export const isLoading = writable(false);
