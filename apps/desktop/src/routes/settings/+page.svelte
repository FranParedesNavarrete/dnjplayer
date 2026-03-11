<script lang="ts">
	import { onMount } from 'svelte';
	import { Cloud, Sparkles, Sun, Moon, Palette, Link } from 'lucide-svelte';
	import { theme } from '$lib/stores/theme';
	import { language } from '$lib/stores/settings';
	import { isConnected, userEmail } from '$lib/stores/mega';
	import { megaCheckStatus } from '$lib/services/mega-service';

	onMount(() => {
		// Refresh Mega connection status when visiting settings
		megaCheckStatus().then((status) => {
			isConnected.set(status.logged_in);
			if (status.email) userEmail.set(status.email);
		}).catch(() => {});
	});

	function handleLanguageChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		language.set(target.value as 'en' | 'es');
	}
</script>

<div class="settings-page">
	<div class="page-header">
		<h2>Settings</h2>
	</div>

	<div class="settings-sections">
		<section class="settings-section">
			<div class="section-title">
				<Palette size={18} strokeWidth={1.8} />
				<h3>Appearance</h3>
			</div>
			<div class="setting-row">
				<span class="setting-label">Theme</span>
				<button class="theme-toggle" onclick={() => theme.toggle()}>
					{#if $theme === 'dark'}
						<Moon size={16} strokeWidth={2} />
						<span>Dark</span>
					{:else}
						<Sun size={16} strokeWidth={2} />
						<span>Light</span>
					{/if}
				</button>
			</div>
			<div class="setting-row">
				<span class="setting-label">Language</span>
				<select class="setting-select" value={$language} onchange={handleLanguageChange}>
					<option value="en">English</option>
					<option value="es">Español</option>
				</select>
			</div>
		</section>

		<section class="settings-section">
			<div class="section-title">
				<Link size={18} strokeWidth={1.8} />
				<h3>Connectors</h3>
			</div>
			<div class="setting-row">
				<div class="connector-info">
					<span class="connector-name">Mega.io</span>
				</div>
				{#if $isConnected}
					<span class="setting-value connected">{$userEmail ?? 'Connected'}</span>
				{:else}
					<span class="setting-value disconnected">Not connected</span>
				{/if}
			</div>
			<div class="setting-row">
				<div class="connector-info">
					<span class="connector-name">Google Drive</span>
				</div>
				<span class="badge coming-soon">Coming soon</span>
			</div>
			<div class="setting-row">
				<div class="connector-info">
					<span class="connector-name">Dropbox</span>
				</div>
				<span class="badge coming-soon">Coming soon</span>
			</div>
		</section>

		<section class="settings-section">
			<div class="section-title">
				<Cloud size={18} strokeWidth={1.8} />
				<h3>Mega Account</h3>
			</div>
			<div class="setting-row">
				<span class="setting-label">Status</span>
				{#if $isConnected}
					<span class="setting-value connected">{$userEmail ?? 'Connected'}</span>
				{:else}
					<span class="setting-value disconnected">Not connected</span>
				{/if}
			</div>
		</section>

		<section class="settings-section">
			<div class="section-title">
				<Sparkles size={18} strokeWidth={1.8} />
				<h3>Anime4K</h3>
			</div>
			<div class="setting-row">
				<span class="setting-label">Default shader mode</span>
				<select class="setting-select">
					<option value="A">Mode A (1080p)</option>
					<option value="B">Mode B (720p)</option>
					<option value="C">Mode C (480p)</option>
					<option value="off">Off</option>
				</select>
			</div>
			<div class="setting-row">
				<span class="setting-label">Shader variant</span>
				<select class="setting-select">
					<option value="VL">Very Large (best quality)</option>
					<option value="L">Large</option>
					<option value="M">Medium (balanced)</option>
					<option value="S">Small (performance)</option>
				</select>
			</div>
		</section>
	</div>
</div>

<style>
	.settings-page {
		max-width: 700px;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.page-header h2 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.settings-section {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 20px;
		margin-bottom: 16px;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border);
		color: var(--text-primary);
	}

	.section-title h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 0;
	}

	.setting-label {
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	.setting-value {
		font-size: 0.9rem;
	}

	.setting-value.disconnected {
		color: var(--danger);
	}

	.setting-value.connected {
		color: var(--success);
	}

	.setting-select {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border);
		padding: 6px 10px;
		border-radius: 4px;
		font-size: 0.85rem;
	}

	.theme-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border);
		padding: 6px 14px;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.theme-toggle:hover {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}

	.connector-info {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.connector-name {
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.badge {
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 10px;
		font-weight: 500;
	}

	.badge.coming-soon {
		background: var(--bg-tertiary);
		color: var(--text-muted);
		border: 1px solid var(--border);
	}
</style>
