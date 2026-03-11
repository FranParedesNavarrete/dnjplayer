import { writable } from 'svelte/store';

// Whether the player is actively playing something
export const playerActive = writable(false);

// Current video being played
export const currentVideoUrl = writable<string | null>(null);
export const currentVideoTitle = writable<string | null>(null);

// UI state for player page
export const showControls = writable(true);
export const controlsTimeout = writable<ReturnType<typeof setTimeout> | null>(null);
