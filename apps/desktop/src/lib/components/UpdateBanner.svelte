<script lang="ts">
	import { availableUpdate, updatePhase, updateProgress } from '$lib/stores/update';
	import { downloadAndInstallUpdate, dismissUpdate } from '$lib/services/update-service';
	import { t } from '$lib/i18n';
	import { Download, X, RefreshCw } from 'lucide-svelte';

	let downloading = $derived($updatePhase === 'downloading' || $updatePhase === 'ready');
</script>

{#if $availableUpdate && ($updatePhase === 'available' || downloading)}
	<div class="update-banner">
		<div class="update-icon">
			<RefreshCw size={16} strokeWidth={2} />
		</div>
		<div class="update-text">
			<span class="update-title">
				{$t['update.available'].replace('{version}', $availableUpdate.version)}
			</span>
			{#if downloading}
				<div class="progress-track">
					<div class="progress-fill" style="width: {$updateProgress}%"></div>
				</div>
			{/if}
		</div>
		<div class="update-actions">
			{#if downloading}
				<span class="downloading-label">
					{$updatePhase === 'ready'
						? $t['update.restarting']
						: $t['update.downloading'].replace('{pct}', String($updateProgress))}
				</span>
			{:else}
				<button class="update-btn" onclick={downloadAndInstallUpdate}>
					<Download size={14} strokeWidth={2} />
					{$t['update.installNow']}
				</button>
				<button class="dismiss-btn" onclick={dismissUpdate} title={$t['update.later']}>
					<X size={14} strokeWidth={2} />
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.update-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		margin-bottom: 16px;
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
		border: 1px solid var(--accent);
		border-radius: 8px;
	}

	.update-icon {
		display: flex;
		align-items: center;
		color: var(--accent);
		flex-shrink: 0;
	}

	.update-text {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}

	.update-title {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.progress-track {
		height: 5px;
		border-radius: 3px;
		background: var(--bg-tertiary);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s ease;
	}

	.update-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.downloading-label {
		font-size: 0.82rem;
		color: var(--text-secondary);
	}

	.update-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border-radius: 6px;
		background: var(--accent);
		color: var(--bg-primary);
		font-size: 0.82rem;
		font-weight: 600;
		border: none;
		cursor: pointer;
		transition: background 0.15s;
		white-space: nowrap;
	}

	.update-btn:hover {
		background: var(--accent-hover);
	}

	.dismiss-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		border: none;
		cursor: pointer;
		transition: color 0.15s;
	}

	.dismiss-btn:hover {
		color: var(--text-primary);
	}
</style>
