<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { resizeMpvOverlay, hideMpvOverlay } from '$lib/services/player-service';
	import { playerActive } from '$lib/stores/player-ui';
	import { osdMessage } from '$lib/stores/player';
	import PlayerControls from './PlayerControls.svelte';
	import { Play } from 'lucide-svelte';
	import { t } from '$lib/i18n';

	let videoAreaEl: HTMLDivElement;
	let rafId: number | null = null;
	let lastRect = { x: 0, y: 0, w: 0, h: 0 };

	// OSD fade logic
	let osdVisible = $state(false);
	let osdText = $state('');
	let osdTimer: ReturnType<typeof setTimeout> | null = null;

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
	 * requestAnimationFrame loop that checks if the video area position/size
	 * changed and calls resizeMpvOverlay when it does. This keeps the native
	 * mpv child window perfectly in sync during window resize, layout shifts,
	 * sidebar toggles, etc. — much more reliable than ResizeObserver + window
	 * resize event alone.
	 */
	function syncMpvLoop() {
		if (videoAreaEl && $playerActive) {
			const rect = videoAreaEl.getBoundingClientRect();
			if (
				rect.x !== lastRect.x ||
				rect.y !== lastRect.y ||
				rect.width !== lastRect.w ||
				rect.height !== lastRect.h
			) {
				lastRect = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
				resizeMpvOverlay(rect.x, rect.y, rect.width, rect.height);
			}
		}
		rafId = requestAnimationFrame(syncMpvLoop);
	}

	onMount(() => {
		rafId = requestAnimationFrame(syncMpvLoop);
	});

	onDestroy(() => {
		if (rafId !== null) cancelAnimationFrame(rafId);
		// Hide mpv when navigating away from the player page
		hideMpvOverlay();
	});
</script>

<div class="player-wrapper">
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

	<!-- Controls bar below video -->
	{#if $playerActive}
		<PlayerControls />
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
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px 8px 0 0;
		overflow: hidden;
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
		margin-bottom: 16px;
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
