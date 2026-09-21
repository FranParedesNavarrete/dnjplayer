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
	.player-page {
		height: calc(100vh - 48px);
		display: flex;
		flex-direction: column;
	}

	/* In immersive fullscreen the sidebar/padding are hidden by the layout, so
	   the player fills the entire viewport (the video surface tracks the video area). */
	.player-page.fullscreen {
		height: 100vh;
	}
</style>
