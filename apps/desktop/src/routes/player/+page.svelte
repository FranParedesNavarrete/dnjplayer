<script lang="ts">
	import Player from '$lib/components/Player.svelte';
</script>

<div class="player-page">
	<Player />
</div>

<style>
	.player-page {
		height: calc(100vh - 48px);
		display: flex;
		flex-direction: column;
	}
</style>
