import { get, writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { PlaylistItem } from '$lib/types/player';

// Whether the player is actively playing something
export const playerActive = writable(false);

// Current video being played
export const currentVideoUrl = writable<string | null>(null);
export const currentVideoTitle = writable<string | null>(null);

// Playlist state
export const playlist = writable<PlaylistItem[]>([]);
export const playlistIndex = writable<number>(0);

/**
 * Where the player chrome can be drawn — the SINGLE source of truth for the
 * macOS/Windows fork. Nothing else in the UI may sniff the platform for layout.
 *
 * 'over'  — the DOM paints ABOVE the video. macOS only, since the spike made
 *           mpv's NSWindow a child window ordered `NSWindowBelow` the webview
 *           (plus `html.video-hole`). The overlay can float on the video, and
 *           showing/hiding it must NOT change the `.video-area` rectangle.
 * 'below' — the native mpv window paints ABOVE the webview (Windows, and Linux
 *           until its own spike lands). Anything absolutely positioned over
 *           `.video-area` would simply be invisible, and mpv swallows the mouse
 *           there, so the chrome has to be a sibling bar that pushes the video
 *           area up (see CLAUDE.md hard constraint #2).
 */
export type ChromeMode = 'over' | 'below';
export const chromeMode: ChromeMode =
	browser && (navigator.platform?.toLowerCase().includes('mac') ?? false) ? 'over' : 'below';
export const chromeOverVideo = chromeMode === 'over';

/**
 * Whether the player chrome (top bar + timeline + actions) is currently shown.
 * Written by PlayerOverlay, which owns the auto-hide timer; read by Player to
 * collapse the bar on Windows and to hide the cursor on macOS.
 */
export const controlsVisible = writable(true);

// When true, the chrome must NOT auto-hide. Set it while a popover/panel is
// open (track picker, speed, video adjustments…) so it doesn't vanish from
// under the user's cursor, and clear it on close.
export const controlsPinned = writable(false);

/**
 * Monotonic "poke" counter bumped on any user activity (mouse move, click on
 * the chrome, keyboard shortcut). The auto-hide timer keys off this value
 * rather than off a mutable deadline: an unchanged state must NOT restart the
 * countdown, and a plain deadline variable can't express that in an $effect.
 */
export const uiActivityTick = writable(0);

// Nuvio throttles activity to 300 ms (`chromeActivityThrottleMs`) so a mouse
// moving across the window doesn't rerun the whole reschedule 60 times a second.
const ACTIVITY_THROTTLE_MS = 300;
let lastActivityAt = 0;

/**
 * Report user activity: reveal the chrome immediately and (throttled) restart
 * the inactivity countdown. Revealing bypasses the throttle — the very first
 * mouse move after the chrome hid itself must bring it back at once.
 */
export function pokeUiActivity(): void {
	if (!get(controlsVisible)) {
		controlsVisible.set(true);
		// Force the countdown to restart from this moment; the reveal itself is
		// the activity and the throttle window must not swallow it.
		lastActivityAt = 0;
	}
	const now = Date.now();
	if (now - lastActivityAt < ACTIVITY_THROTTLE_MS) return;
	lastActivityAt = now;
	uiActivityTick.update((n) => n + 1);
}

// Whether the player is in immersive fullscreen (sidebar/chrome hidden, video
// fills the whole window). Drives the layout + player page CSS.
export const playerFullscreen = writable(false);

// Last playback failure reported by mpv (`end-file` with reason 'error'), as a
// short technical detail; null while nothing has failed / after the next load.
// Set only by player-service.ts. The toast is raised there too; this store is for
// UI that wants to reflect the error state (e.g. show it in the placeholder).
export const playbackError = writable<string | null>(null);

// Bumped by player-service.ts each time the native video surface becomes
// positionable (mpv window attached on macOS/Windows). Player.svelte reacts by
// pushing the current video-area rect: the attach happens asynchronously after
// playback starts, so without this the first layout sync would be lost.
export const mpvSurfaceReady = writable(0);
