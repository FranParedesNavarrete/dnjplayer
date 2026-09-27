<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { resizeMpvOverlay, hideMpvOverlay, showMpvOverlay, exitFullscreen } from '$lib/services/player-service';
	import {
		playerActive,
		playerFullscreen,
		controlsVisible,
		pokeUiActivity,
		mpvSurfaceReady,
		chromeOverVideo,
	} from '$lib/stores/player-ui';
	import { osdMessage } from '$lib/stores/player';
	import PlayerOverlay from './PlayerOverlay.svelte';
	import { Play } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { log } from '$lib/log';

	const isWindows = navigator.platform?.toLowerCase().includes('win') ?? false;
	const isMacOS = navigator.platform?.toLowerCase().includes('mac') ?? false;

	// Windows only: the native mpv window sits on top of the webview and swallows
	// mouse-move events, so the webview can't see the cursor over the video.
	let cursorPollTimer: ReturnType<typeof setInterval> | null = null;
	let lastCursor = { x: -1, y: -1 };

	let videoAreaEl: HTMLDivElement;
	let resizeObserver: ResizeObserver | null = null;
	let lastRect = { x: -1, y: -1, w: -1, h: -1 };

	// OSD fade logic
	let osdVisible = $state(false);
	let osdText = $state('');
	let osdTimer: ReturnType<typeof setTimeout> | null = null;

	// Called when the max-height transition finishes — the video area has its
	// final size only now, so sync once more (ResizeObserver already tracked the
	// intermediate frames; this guarantees the last one). Only reachable in
	// 'below' chrome mode: the floating overlay never resizes anything.
	function handleControlsTransitionEnd(e: TransitionEvent) {
		if (e.propertyName === 'max-height') {
			syncVideoSurface();
		}
	}

	$effect(() => {
		const msg = $osdMessage;
		if (msg) {
			osdText = msg;
			osdVisible = true;
			if (osdTimer) clearTimeout(osdTimer);
			osdTimer = setTimeout(() => {
				osdVisible = false;
				osdMessage.set(null);
			}, 2000);
		}
	});

	/**
	 * Snap a DOMRect to integer pixel boundaries, expanding outward so the native
	 * surface always FULLY covers the video-area. Fractional values (e.g. 719.5)
	 * round differently in the webview and in AppKit/Win32, leaving a 1px gap.
	 */
	function snapRect(rect: DOMRect) {
		const left = Math.floor(rect.left);
		const top = Math.floor(rect.top);
		const right = Math.ceil(rect.right);
		const bottom = Math.ceil(rect.bottom);
		return {
			x: left,
			y: top,
			w: right - left,
			h: bottom - top,
		};
	}

	/**
	 * Push the current `.video-area` rect to the native video surface.
	 *
	 * Event-driven, not a requestAnimationFrame loop: a ResizeObserver on the
	 * video area catches every size change (window resize, sidebar toggle,
	 * controls bar collapsing, fullscreen), and the window `resize` / document
	 * `scroll` listeners cover the position-only moves the observer can't see.
	 * The old rAF loop compared getBoundingClientRect() 60x/s forever, even with
	 * no video, and each change blocked a tokio worker on the main thread.
	 */
	function syncVideoSurface(force = false) {
		if (!videoAreaEl || !$playerActive) return;
		const r = snapRect(videoAreaEl.getBoundingClientRect());
		if (r.w <= 0 || r.h <= 0) return;
		if (!force && r.x === lastRect.x && r.y === lastRect.y && r.w === lastRect.w && r.h === lastRect.h) {
			return;
		}
		lastRect = r;
		resizeMpvOverlay(r.x, r.y, r.w, r.h);
	}

	function handleWindowResize() {
		syncVideoSurface();
	}

	// `.content` can scroll a little (its padding plus the page height overflow
	// the viewport at large paddings); scrolling moves the video area without
	// resizing it, which the ResizeObserver does not report.
	function handleScroll() {
		syncVideoSurface();
	}

	// Re-sync after entering/exiting fullscreen. The window resizes and the layout
	// changes; the ResizeObserver catches the size change, but the native
	// fullscreen animation on macOS can finish after the last DOM layout, so
	// force one more sync once it has settled.
	$effect(() => {
		$playerFullscreen; // track changes
		const timer = setTimeout(() => syncVideoSurface(true), 600);
		return () => clearTimeout(timer);
	});

	// macOS video hole: while a video is showing, no ancestor may paint under the
	// video area because mpv's window sits BELOW the transparent Tauri window (see
	// app.css). Windows keeps its opaque body — the mpv window is on top there.
	$effect(() => {
		if (!isMacOS) return;
		document.documentElement.classList.toggle('video-hole', $playerActive);
	});

	// Safety net for the failure a user hit on 1.5.0: with the app in its own
	// full screen, the green title-bar button put the window into a native
	// full-screen Space. AppKit then re-orders child windows ABOVE their parent,
	// so mpv's surface covered the whole webview and lost its synced geometry —
	// no video, no controls — and on the way back out the window was left
	// transparent over the desktop. `disable_native_fullscreen` in the Rust setup
	// stops it happening at all; this catches any route that still gets there
	// (a future macOS default, a menu shortcut, a restored window state) and
	// backs out instead of leaving the app unusable. Deliberately not gated on
	// the surface being attached: hiding the surface does NOT detach mpv's child
	// window, so that signal would close the hole on return from another section
	// and hide the video behind an opaque body.
	$effect(() => {
		if (!isMacOS || !$playerActive) return;
		const win = getCurrentWindow();
		let stop = false;
		const check = async () => {
			try {
				if (!stop && (await win.isFullscreen())) {
					log.warn('[player] native fullscreen detected; backing out (see CLAUDE.md #2)');
					document.documentElement.classList.remove('video-hole');
					await win.setFullscreen(false);
					syncVideoSurface(true);
				}
			} catch (e) {
				log.warn('[player] fullscreen check failed:', e);
			}
		};
		void check();
		const unlisten = win.onResized(() => void check());
		return () => {
			stop = true;
			void unlisten.then((off: () => void) => off());
		};
	});

	// When playback starts while this page is mounted (or is resumed after a
	// navigation), the surface is still hidden/misplaced: sync as soon as the
	// player becomes active, and again once the native surface gets attached
	// (that happens asynchronously after playerActive flips).
	$effect(() => {
		$mpvSurfaceReady; // track attach events
		if ($playerActive) {
			showMpvOverlay();
			lastRect = { x: -1, y: -1, w: -1, h: -1 };
			// Wait for the layout to include the controls bar before measuring.
			const timer = setTimeout(() => syncVideoSurface(true), 0);
			return () => clearTimeout(timer);
		}
	});

	onMount(() => {
		// ResizeObserver gives us a notification on every size change of the
		// video-area — including the intermediate frames of CSS transitions.
		if (videoAreaEl && typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => {
				syncVideoSurface();
			});
			resizeObserver.observe(videoAreaEl);
		}
		window.addEventListener('resize', handleWindowResize);
		document.addEventListener('scroll', handleScroll, true);

		// Start the inactivity countdown (PlayerOverlay owns the timer).
		pokeUiActivity();

		// Windows: the native mpv window sits over the video and swallows
		// mouse-move events, so the webview's onmousemove doesn't fire over the
		// video and the controls bar could never reappear. Poll the global cursor
		// and treat any movement as activity. Not needed on macOS: the webview is
		// above the video and receives the mouse directly.
		if (isWindows) {
			cursorPollTimer = setInterval(async () => {
				if (!$playerActive) return;
				try {
					const pos = await invoke<[number, number]>('get_cursor_pos');
					if (pos[0] !== lastCursor.x || pos[1] !== lastCursor.y) {
						lastCursor = { x: pos[0], y: pos[1] };
						pokeUiActivity();
					}
				} catch {
					// ignore
				}
			}, 200);
		}
	});

	onDestroy(() => {
		if (cursorPollTimer) clearInterval(cursorPollTimer);
		if (osdTimer) clearTimeout(osdTimer);
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		window.removeEventListener('resize', handleWindowResize);
		document.removeEventListener('scroll', handleScroll, true);
		if (isMacOS) document.documentElement.classList.remove('video-hole');
		// Exit immersive fullscreen and hide the video surface when leaving the page
		exitFullscreen();
		hideMpvOverlay();
	});
</script>

<!-- `cursor: none` only where the DOM is above the video: there the webview owns
     the pointer over the picture. On Windows the native window does, so hiding
     the webview cursor would be both useless and confusing. -->
<div
	class="player-wrapper"
	class:cursor-hidden={chromeOverVideo && $playerActive && !$controlsVisible}
	onmousemove={pokeUiActivity}
	role="presentation"
>
	<!-- Transparent video area — mpv renders behind this -->
	<div class="video-area" class:has-video={$playerActive} bind:this={videoAreaEl}>
		{#if !$playerActive}
			<div class="player-placeholder">
				<div class="placeholder-icon">
					<Play size={56} strokeWidth={1.2} />
				</div>
				<p>{$t['player.placeholder']}</p>
			</div>
		{/if}

		<!-- OSD overlay -->
		{#if osdText}
			<div class="osd-overlay" class:osd-visible={osdVisible}>
				{osdText}
			</div>
		{/if}

		<!-- macOS: the chrome floats INSIDE the video area, absolutely positioned.
		     It is mounted here (and not below) so it can never influence the
		     video-area rectangle the native surface is synced to. -->
		{#if chromeOverVideo && $playerActive}
			<PlayerOverlay />
		{/if}
	</div>

	<!-- Windows/Linux: the chrome is a bar BELOW the video that pushes it up, and
	     auto-hiding collapses it (the ResizeObserver then re-syncs the surface). -->
	{#if !chromeOverVideo && $playerActive}
		<div
			class="controls-wrapper"
			class:hidden={!$controlsVisible}
			class:fullscreen={$playerFullscreen}
			class:win={isWindows}
			ontransitionend={handleControlsTransitionEnd}
		>
			<PlayerOverlay />
		</div>
	{/if}
</div>

<style>
	.player-wrapper {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.player-wrapper.cursor-hidden {
		cursor: none;
	}

	.video-area {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px 8px 0 0;
		overflow: hidden;
	}

	.controls-wrapper {
		overflow: hidden;
		transition: max-height 0.25s ease, opacity 0.2s ease;
		/* Cap must clear the tallest expanded inline panel (tracks / adjustments),
		   otherwise the panel gets clipped. The panels scroll internally too. */
		max-height: 420px;
		opacity: 1;
		min-height: 0;
	}

	.controls-wrapper.hidden {
		max-height: 0;
		opacity: 0;
		pointer-events: none;
	}

	/* Windows only. In fullscreen the sidebar is hidden, so when the controls also
	   collapse the native mpv window would cover the ENTIRE webview; Windows then
	   treats the webview as occluded and throttles its timers, so the cursor poll
	   stops and the controls can never reappear. Keep a tiny sliver of the webview
	   uncovered so it stays "visible" and active. On macOS the webview is above
	   the video and is never occluded. */
	.controls-wrapper.hidden.fullscreen.win {
		max-height: 4px;
	}

	.video-area.has-video {
		/* Transparent so the native video surface shows through */
		background: transparent;
	}

	/* macOS video hole (see app.css): body and the layout shell stop painting, so
	   the video area itself repaints everything AROUND it with a huge spread
	   shadow (clipped by `.content`'s overflow). The rounded corners of the shadow
	   double as rounded corners for the video. */
	:global(html.video-hole) .video-area.has-video {
		box-shadow: 0 0 0 200vmax var(--bg-primary);
		/* Bottom-right ONLY. The other three corners butt against app chrome — the
		   sidebar on the left, the title bar above — so a radius there just bites
		   a notch out of the picture against something that is already square.
		   Bottom-right is the one corner with nothing next to it. The base
		   `8px 8px 0 0` dates from when the controls sat in a bar BELOW the video
		   and that bar owned the bottom corners; it still does in 'below' mode,
		   which is why this is scoped to the video-hole case. The shadow above
		   follows this radius, and that is what actually rounds the hole. */
		border-radius: 0 0 8px 0;
	}

	.video-area:not(.has-video) {
		background: #000;
	}

	.player-placeholder {
		text-align: center;
		color: var(--text-muted);
	}

	.placeholder-icon {
		margin-bottom: 0px;
	}

	.osd-overlay {
		position: absolute;
		top: 16px;
		left: 16px;
		background: rgba(0, 0, 0, 0.75);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		padding: 8px 16px;
		border-radius: 6px;
		pointer-events: none;
		z-index: 10;
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.osd-overlay.osd-visible {
		opacity: 1;
	}
</style>
