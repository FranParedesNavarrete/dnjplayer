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

// When true, the controls bar must NOT auto-hide. Set it while a popover/panel
// anchored to the bar is open (track picker, settings, playlist…) so the bar
// doesn't vanish from under the user's cursor, and clear it on close.
export const controlsPinned = writable(false);

// Whether the player is in immersive fullscreen (sidebar/chrome hidden, video
// fills the whole window). Drives the layout + player page CSS.
export const playerFullscreen = writable(false);
