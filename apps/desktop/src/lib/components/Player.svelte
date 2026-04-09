<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { resizeMpvOverlay, hideMpvOverlay, showMpvOverlay } from '$lib/services/player-service';
	import { playerActive } from '$lib/stores/player-ui';
	import { osdMessage } from '$lib/stores/player';
	import { controlsHideDelay } from '$lib/stores/settings';
	import PlayerControls from './PlayerControls.svelte';
	import { Play } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';

	let videoAreaEl: HTMLDivElement;
	let rafId: number | null = null;
	let lastRect = { x: 0, y: 0, w: 0, h: 0 };
	let resizeObserver: ResizeObserver | null = null;

	// Controls auto-hide logic
	let controlsVisible = $state(true);
	let controlsTimer: ReturnType<typeof setTimeout> | null = null;

	// OSD fade logic
	let osdVisible = $state(false);
	let osdText = $state('');
	let osdTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleHideControls() {
		if (controlsTimer) {
			clearTimeout(controlsTimer);
			controlsTimer = null;
		}
		const delay = get(controlsHideDelay);
		// delay === 0 means "never hide"
		if (delay <= 0) return;
		controlsTimer = setTimeout(() => {
			controlsVisible = false;
		}, delay);
	}

	function handleMouseMove() {
		if (!controlsVisible) {
			controlsVisible = true;
		}
		scheduleHideControls();
	}

	// Called when the max-height transition finishes — force an immediate
	// rect sync so mpv matches the final video-area size exactly.
	function handleControlsTransitionEnd(e: TransitionEvent) {
		if (e.propertyName === 'max-height') {
			forceRectUpdate();
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
	 * Snap a DOMRect to integer pixel boundaries, expanding outward so mpv
	 * always FULLY covers the video-area. Without this, fractional pixel
	 * values (e.g. 719.5) get rounded inconsistently between the webview
	 * and the native mpv window, creating a 1-pixel gap that depends on
	 * window size.
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
	 * requestAnimationFrame loop that checks if the video area position/size
	 * changed and calls resizeMpvOverlay when it does. This keeps the native
	 * mpv child window perfectly in sync during window resize, layout shifts,
	 * sidebar toggles, etc. — much more reliable than ResizeObserver + window
	 * resize event alone.
	 */
	function syncMpvLoop() {
		if (videoAreaEl && $playerActive) {
			const r = snapRect(videoAreaEl.getBoundingClientRect());
			if (
				r.x !== lastRect.x ||
				r.y !== lastRect.y ||
				r.w !== lastRect.w ||
				r.h !== lastRect.h
			) {
				lastRect = r;
				resizeMpvOverlay(r.x, r.y, r.w, r.h);
			}
		}
		rafId = requestAnimationFrame(syncMpvLoop);
	}

	function forceRectUpdate() {
		if (!videoAreaEl) return;
		const r = snapRect(videoAreaEl.getBoundingClientRect());
		lastRect = r;
		resizeMpvOverlay(r.x, r.y, r.w, r.h);
	}

	onMount(() => {
		// Re-show the mpv window if playback is active (e.g., navigated away and back)
		if ($playerActive) {
			showMpvOverlay();
			// Invalidate cached rect so the next rAF frame sends a resize
			lastRect = { x: 0, y: 0, w: 0, h: 0 };
		}
		rafId = requestAnimationFrame(syncMpvLoop);

		// ResizeObserver gives us pixel-perfect notifications when the video-area
		// dimensions change (e.g. controls show/hide). This is more reliable than
		// relying solely on the rAF loop catching intermediate frames.
		if (videoAreaEl && typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => {
				forceRectUpdate();
			});
			resizeObserver.observe(videoAreaEl);
		}

		// Start the inactivity timer
		scheduleHideControls();
	});

	onDestroy(() => {
		if (rafId !== null) cancelAnimationFrame(rafId);
		if (controlsTimer) clearTimeout(controlsTimer);
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		// Hide mpv when navigating away from the player page
		hideMpvOverlay();
	});

	// Reset timer when playback state or hide-delay setting changes
	$effect(() => {
		const _active = $playerActive;
		const delay = $controlsHideDelay;
		if (_active) {
			if (delay <= 0) {
				// Never hide — make sure controls are visible and cancel any timer
				controlsVisible = true;
				if (controlsTimer) {
					clearTimeout(controlsTimer);
					controlsTimer = null;
				}
			} else {
				scheduleHideControls();
			}
		}
	});
</script>

<div class="player-wrapper" onmousemove={handleMouseMove} role="presentation">
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
	</div>

	<!-- Controls bar below video (auto-hides after inactivity) -->
	{#if $playerActive}
		<div
			class="controls-wrapper"
			class:hidden={!controlsVisible}
			ontransitionend={handleControlsTransitionEnd}
		>
			<PlayerControls />
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

	.video-area {
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
		max-height: 300px;
		opacity: 1;
		min-height: 0;
	}

	.controls-wrapper.hidden {
		max-height: 0;
		opacity: 0;
		pointer-events: none;
	}

	.video-area.has-video {
		/* Transparent so mpv video shows through the native window behind webview */
		background: transparent;
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
