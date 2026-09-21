<script lang="ts">
	// Renders the app-wide notification queue (`$lib/stores/notifications`).
	//
	// Two visual variants, on purpose:
	// - transient (success/info): nero's "top pill" — fades in with a 4 px
	//   drop, stays readable, fades out. `animation-duration` is the store's
	//   `durationMs`, so the CSS exit and the store's auto-dismiss coincide.
	//   Pointer-transparent: it must never block a click underneath.
	// - persistent (errors, or `persistent: true`): NO exit animation, danger
	//   border, explicit close button, optional expandable technical detail.
	//   The pill reference is meant for quick confirmations, not for anything
	//   the user needs to read calmly — errors stay until dismissed.
	//
	// NOTE (CLAUDE.md constraint #2): the mpv window is drawn ON TOP of the
	// webview, so a fixed toast over `.video-area` is invisible on the player
	// page while a video is loaded. This host is positioned at the top centre,
	// which overlaps the video on that page — mount it knowing that.
	import { X, CircleCheck, CircleAlert, Info } from 'lucide-svelte';
	import { notifications, dismiss } from '$lib/stores/notifications';
	import { t } from '$lib/i18n';

	// Which persistent notifications have their technical detail expanded.
	let expanded = $state<Record<number, boolean>>({});

	function toggleDetail(id: number) {
		expanded[id] = !expanded[id];
	}

	function close(id: number) {
		delete expanded[id];
		dismiss(id);
	}
</script>

<div class="toast-host">
	{#each $notifications as n (n.id)}
		{#if n.persistent}
			<div
				class="toast toast--persistent"
				class:toast--error={n.kind === 'error'}
				class:toast--success={n.kind === 'success'}
				class:toast--expanded={!!(n.detail && expanded[n.id])}
				role={n.kind === 'error' ? 'alert' : 'status'}
			>
				<div class="toast__row">
					<span class="toast__icon" aria-hidden="true">
						{#if n.kind === 'error'}
							<CircleAlert size={14} />
						{:else if n.kind === 'success'}
							<CircleCheck size={14} />
						{:else}
							<Info size={14} />
						{/if}
					</span>
					<span class="toast__message">{n.message}</span>
					{#if n.detail}
						<button
							type="button"
							class="toast__btn"
							aria-expanded={!!expanded[n.id]}
							onclick={() => toggleDetail(n.id)}
						>
							{expanded[n.id] ? $t['notify.hideDetails'] : $t['player.error.detail']}
						</button>
					{/if}
					<button
						type="button"
						class="toast__close"
						aria-label={$t['notify.dismiss']}
						title={$t['notify.dismiss']}
						onclick={() => close(n.id)}
					>
						<X size={14} />
					</button>
				</div>
				{#if n.detail && expanded[n.id]}
					<pre class="toast__detail">{n.detail}</pre>
				{/if}
			</div>
		{:else}
			<div
				class="toast toast--transient"
				class:toast--success={n.kind === 'success'}
				role="status"
				style="animation-duration: {n.durationMs}ms"
			>
				<span class="toast__icon" aria-hidden="true">
					{#if n.kind === 'success'}
						<CircleCheck size={14} />
					{:else}
						<Info size={14} />
					{/if}
				</span>
				<span class="toast__message">{n.message}</span>
			</div>
		{/if}
	{/each}
</div>

<style>
	/* The host is centred once; children only animate on the Y axis so the
	   reference's translate(-50%, ...) is not needed per toast. */
	.toast-host {
		position: fixed;
		top: 1rem;
		left: 50%;
		z-index: 50;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		width: max-content;
		max-width: min(560px, calc(100vw - 2rem));
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: 100%;
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--bg-secondary);
		color: var(--text-primary);
		padding: 0.375rem 1rem;
		font-size: 0.75rem;
		line-height: 1.3;
		box-shadow: 0 10px 25px -5px rgb(0 0 0 / 0.3);
	}

	.toast__icon {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--text-secondary);
	}

	.toast--success .toast__icon {
		color: var(--success);
	}

	.toast__message {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	/* --- Transient pill (reference curve: 0 / 15 / 80 / 100) --- */
	.toast--transient {
		white-space: nowrap;
		animation: toast-fade 2s ease-in-out forwards;
		pointer-events: none;
	}

	@keyframes toast-fade {
		0% {
			opacity: 0;
			transform: translateY(-4px);
		}
		15% {
			opacity: 1;
			transform: translateY(0);
		}
		80% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	/* --- Persistent: enters like the pill, never leaves on its own --- */
	.toast--persistent {
		flex-direction: column;
		align-items: stretch;
		gap: 0.375rem;
		pointer-events: auto;
		animation: toast-in 0.3s ease-out;
	}

	.toast--persistent.toast--error {
		border-color: var(--danger);
	}

	.toast--error .toast__icon {
		color: var(--danger);
	}

	.toast--expanded {
		border-radius: 12px;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.toast__row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.toast__btn,
	.toast__close {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font: inherit;
		cursor: pointer;
		padding: 0.125rem 0.25rem;
		border-radius: 4px;
	}

	.toast__btn {
		color: var(--accent);
	}

	.toast__btn:hover,
	.toast__close:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.toast__btn:focus-visible,
	.toast__close:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.toast__detail {
		margin: 0;
		padding: 0.5rem 0.625rem;
		max-height: 30vh;
		overflow: auto;
		border-radius: 8px;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.6875rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
	}

	@media (prefers-reduced-motion: reduce) {
		.toast--transient,
		.toast--persistent {
			animation: none;
			opacity: 1;
		}
	}
</style>
