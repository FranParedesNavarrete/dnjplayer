<script lang="ts">
	import { onMount } from 'svelte';
	import { megaCheckStatus, megaLogout } from '$lib/services/mega-service';
	import { isConnected, userEmail, megaError } from '$lib/stores/mega';
	import AuthForm from '$lib/components/AuthForm.svelte';
	import FileBrowser from '$lib/components/FileBrowser.svelte';
	import { t } from '$lib/i18n';

	let checkingStatus = $state(true);

	onMount(async () => {
		try {
			const status = await megaCheckStatus();
			isConnected.set(status.logged_in);
			userEmail.set(status.email);
		} catch {
			// MEGAcmd not available - stay disconnected
		} finally {
			checkingStatus = false;
		}
	});

	async function handleLogout() {
		try {
			await megaLogout();
			isConnected.set(false);
			userEmail.set(null);
		} catch (e) {
			megaError.set(e instanceof Error ? e.message : String(e));
		}
	}
</script>

<div class="browse-page">
	<div class="page-header">
		<div class="header-left">
			<h2>{$t['browse.title']}</h2>
			<p class="subtitle">{$t['browse.subtitle']}</p>
		</div>
		{#if $isConnected}
			<div class="header-right">
				<span class="user-email">{$userEmail}</span>
				<button class="btn-secondary" onclick={handleLogout}>{$t['browse.signOut']}</button>
			</div>
		{/if}
	</div>

	{#if checkingStatus}
		<div class="loading-state">
			<span class="spinner"></span>
			<span>{$t['browse.checking']}</span>
		</div>
	{:else if $isConnected}
		<FileBrowser />
	{:else}
		<AuthForm />
	{/if}
</div>

<style>
	.browse-page {
		max-width: 1200px;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.subtitle {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin-top: 4px;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.user-email {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.btn-secondary {
		background: var(--bg-tertiary);
		color: var(--text-secondary);
		border: 1px solid var(--border);
		padding: 6px 14px;
		border-radius: 6px;
		font-size: 0.8rem;
		transition: all 0.15s;
	}

	.btn-secondary:hover {
		background: var(--border);
		color: var(--text-primary);
	}

	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 80px 20px;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	.spinner {
		display: inline-block;
		width: 18px;
		height: 18px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
