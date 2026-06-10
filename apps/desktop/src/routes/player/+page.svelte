<script lang="ts">
	import Player from '$lib/components/Player.svelte';
	import { playerFullscreen } from '$lib/stores/player-ui';
</script>

<div class="player-page" class:fullscreen={$playerFullscreen}>
	<Player />
</div>

<style>
	.player-page {
		height: calc(100vh - 48px);
		display: flex;
		flex-direction: column;
	}

	/* In immersive fullscreen the sidebar/padding are hidden by the layout, so
	   the player fills the entire viewport (mpv overlay tracks the video area). */
	.player-page.fullscreen {
		height: 100vh;
	}
</style>
