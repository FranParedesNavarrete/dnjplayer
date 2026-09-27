<script lang="ts">
	import { availableUpdate, updatePhase, updateProgress } from '$lib/stores/update';
	import { downloadAndInstallUpdate, dismissUpdate } from '$lib/services/update-service';
	import { playerActive } from '$lib/stores/player-ui';
	import { t } from '$lib/i18n';
	import { Download, X, RefreshCw } from 'lucide-svelte';

	let downloading = $derived($updatePhase === 'downloading' || $updatePhase === 'ready');

	// Never over a video. This used to be a full-width bar inside the page flow,
	// so it could not overlap anything; floating it means it CAN, and an update
	// nag across something you are watching is worse than the bar it replaced.
	// A dismissed-by-playback update is not lost: the check runs again on the
	// next launch.
	let visible = $derived(
		!!$availableUpdate && !$playerActive && ($updatePhase === 'available' || downloading)
	);
</script>

{#if visible}
	<!-- Floating, not in the flow: the old banner pushed the whole page down by
	     ~56px the moment a release landed, which moved the content under the
	     user's cursor. -->
	<div class="update-pill" class:busy={downloading} role="status">
		<!-- Flat fill, not a gradient: it grows behind the text to turn the pill
		     itself into the progress bar. -->
		{#if downloading}
			<div class="pill-progress" style="width: {$updateProgress}%"></div>
		{/if}

		<span class="pill-body">
			<span class="pill-icon" class:spin={downloading}>
				<RefreshCw size={14} strokeWidth={2.2} />
			</span>

			{#if downloading}
				<span class="pill-text">
					{$updatePhase === 'ready'
						? $t['update.restarting']
						: $t['update.downloading'].replace('{pct}', String($updateProgress))}
				</span>
			{:else}
				<span class="pill-text">
					{$t['update.available'].replace('{version}', $availableUpdate?.version ?? '')}
				</span>
				<button class="pill-btn" onclick={downloadAndInstallUpdate}>
					<Download size={13} strokeWidth={2.2} />
					{$t['update.installNow']}
				</button>
				<button class="pill-dismiss" onclick={dismissUpdate} title={$t['update.later']}>
					<X size={13} strokeWidth={2.2} />
				</button>
			{/if}
		</span>
	</div>
{/if}

<style>
	/* Same visual language as ToastHost: top centre, pill, one shadow. z-index is
	   one BELOW the toasts so a real error is never hidden behind an update nag. */
	.update-pill {
		position: fixed;
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 49;
		display: flex;
		align-items: center;
		overflow: hidden;
		max-width: min(560px, calc(100vw - 2rem));
		border-radius: 9999px;
		border: 1px solid var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
		box-shadow: 0 10px 25px -5px rgb(0 0 0 / 0.35);
		animation: pill-in 0.22s ease-out;
	}

	@keyframes pill-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.update-pill {
			animation: none;
		}
	}

	.pill-progress {
		position: absolute;
		inset: 0 auto 0 0;
		background: color-mix(in srgb, var(--accent) 28%, transparent);
		transition: width 0.2s ease;
	}

	.pill-body {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem 0.375rem 0.85rem;
		min-width: 0;
	}

	.pill-icon {
		display: inline-flex;
		color: var(--accent);
		flex-shrink: 0;
	}

	.pill-icon.spin :global(svg) {
		animation: pill-spin 1.1s linear infinite;
	}

	@keyframes pill-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pill-icon.spin :global(svg) {
			animation: none;
		}
	}

	.pill-text {
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-variant-numeric: tabular-nums;
	}

	.pill-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		border: none;
		border-radius: 9999px;
		background: var(--accent);
		color: var(--bg-primary);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.3rem 0.7rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.pill-btn:hover {
		background: var(--accent-hover);
	}

	.pill-dismiss {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.pill-dismiss:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}
</style>
