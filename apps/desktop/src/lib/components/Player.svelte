<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { resizeMpvOverlay } from '$lib/services/player-service';
	import { playerActive } from '$lib/stores/player-ui';
	import { isPaused } from '$lib/stores/player';
	import PlayerControls from './PlayerControls.svelte';
	import { Play } from 'lucide-svelte';

	let videoAreaEl: HTMLDivElement;
	let resizeObserver: ResizeObserver | null = null;

	function updateMpvPosition() {
		if (!videoAreaEl) return;
		const rect = videoAreaEl.getBoundingClientRect();
		// Send position relative to Tauri window content area
		resizeMpvOverlay(rect.x, rect.y, rect.width, rect.height);
	}

	onMount(() => {
		resizeObserver = new ResizeObserver(() => {
			if ($playerActive) {
				updateMpvPosition();
			}
		});
		if (videoAreaEl) {
			resizeObserver.observe(videoAreaEl);
		}

		// Also update on window resize/move
		window.addEventListener('resize', updateMpvPosition);
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		window.removeEventListener('resize', updateMpvPosition);
	});

	// Update position when player becomes active
	$: if ($playerActive && videoAreaEl) {
		// Small delay to let layout settle
		setTimeout(updateMpvPosition, 100);
	}
</script>

<div class="player-wrapper">
	<!-- Transparent video area — mpv renders behind this -->
	<div class="video-area" class:has-video={$playerActive} bind:this={videoAreaEl}>
		{#if !$playerActive}
			<div class="player-placeholder">
				<div class="placeholder-icon">
					<Play size={56} strokeWidth={1.2} />
				</div>
				<p>Select a video from Browse to start playing</p>
			</div>
		{/if}
	</div>

	<!-- Controls overlay -->
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
		border-radius: 8px;
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
</style>
