import { writable } from 'svelte/store';
import type { PlaylistItem } from '$lib/types/player';

// Whether the player is actively playing something
export const playerActive = writable(false);

// Current video being played
export const currentVideoUrl = writable<string | null>(null);
export const currentVideoTitle = writable<string | null>(null);

// Playlist state
export const playlist = writable<PlaylistItem[]>([]);
export const playlistIndex = writable<number>(0);

// UI state for player page
export const showControls = writable(true);
