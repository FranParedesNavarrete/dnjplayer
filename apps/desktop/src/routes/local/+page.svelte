<script lang="ts">
	// Local playback is entirely independent from MEGAcmd: no status check, no
	// login gate. This page must work with MEGAcmd closed or not installed.
	import LocalFileBrowser from '$lib/components/LocalFileBrowser.svelte';
	import { t } from '$lib/i18n';
</script>

<div class="local-page">
	<div class="page-header">
		<h2>{$t['local.title']}</h2>
	</div>

	<LocalFileBrowser />
</div>

<style>
	.local-page {
		max-width: var(--content-max);
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 600;
	}
</style>
