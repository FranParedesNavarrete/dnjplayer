<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import Player from '$lib/components/Player.svelte';
	import { playerFullscreen, playerActive } from '$lib/stores/player-ui';
	import { devSmokePlay } from '$lib/services/player-service';
	import { log } from '$lib/log';
	import { get } from 'svelte/store';

	onMount(() => {
		// Dev smoke harness: `DNJ_SMOKE_PLAY=/path/to/file pnpm tauri dev` starts
		// playing that file as soon as the player page mounts, no clicks needed.
		// The command returns null in release builds and when the var is unset.
		if (!import.meta.env.DEV || get(playerActive)) return;
		invoke<string | null>('dev_smoke_play_path')
			.then((path) => {
				if (path) return devSmokePlay(path);
			})
			.catch((e) => log.warn('[player] smoke harness failed:', e));
	});
</script>

<div class="player-page" class:fullscreen={$playerFullscreen}>
	<Player />
</div>

<style>
	/* Full viewport height, not `100vh - 48px`: the layout gives the player page
	   no chrome of its own to subtract, and the 48px guess left a strip below the
	   video. With the video hole active that strip is TRANSPARENT, so it showed
	   whatever was behind the window instead of just being empty. Fullscreen needs
	   no override now that windowed already fills the viewport. */
	.player-page {
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
</style>
