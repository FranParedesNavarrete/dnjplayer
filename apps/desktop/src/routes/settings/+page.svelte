<script lang="ts">
	import { onMount } from 'svelte';
	import { Cloud, Sparkles, Sun, Moon, Palette, Link, Play } from 'lucide-svelte';
	import { theme } from '$lib/stores/theme';
	import {
		language,
		defaultShaderMode,
		defaultShaderVariant,
		controlsHideDelay,
		type ControlsHideDelay,
	} from '$lib/stores/settings';
	import { isConnected, userEmail } from '$lib/stores/mega';
	import { megaCheckStatus } from '$lib/services/mega-service';
	import { t } from '$lib/i18n';
	import type { ShaderMode, ShaderVariant } from '$lib/types/player';

	onMount(() => {
		megaCheckStatus().then((status) => {
			isConnected.set(status.logged_in);
			if (status.email) userEmail.set(status.email);
		}).catch(() => {});
	});

	function handleLanguageChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		language.set(target.value as 'en' | 'es');
	}

	function handleShaderModeChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		defaultShaderMode.set(target.value as ShaderMode);
	}

	function handleShaderVariantChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		defaultShaderVariant.set(target.value as ShaderVariant);
	}

	function handleControlsHideDelayChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		controlsHideDelay.set(parseInt(target.value, 10) as ControlsHideDelay);
	}
</script>

<div class="settings-page">
	<div class="page-header">
		<h2>{$t['settings.title']}</h2>
	</div>

	<div class="settings-sections">
		<section class="settings-section">
			<div class="section-title">
				<Palette size={18} strokeWidth={1.8} />
				<h3>{$t['settings.appearance']}</h3>
			</div>
			<div class="setting-row">
				<span class="setting-label">{$t['settings.theme']}</span>
				<button class="theme-toggle" onclick={() => theme.toggle()}>
					{#if $theme === 'dark'}
						<Moon size={16} strokeWidth={2} />
						<span>{$t['settings.dark']}</span>
					{:else}
						<Sun size={16} strokeWidth={2} />
						<span>{$t['settings.light']}</span>
					{/if}
				</button>
			</div>
			<div class="setting-row">
				<span class="setting-label">{$t['settings.language']}</span>
				<select class="setting-select" value={$language} onchange={handleLanguageChange}>
					<option value="en">English</option>
					<option value="es">Español</option>
				</select>
			</div>
		</section>

		<section class="settings-section">
			<div class="section-title">
				<Link size={18} strokeWidth={1.8} />
				<h3>{$t['settings.connectors']}</h3>
			</div>
			<div class="setting-row">
				<div class="connector-info">
					<span class="connector-name">Mega.io</span>
				</div>
				{#if $isConnected}
					<span class="setting-value connected">{$userEmail ?? $t['settings.connected']}</span>
				{:else}
					<span class="setting-value disconnected">{$t['settings.notConnected']}</span>
				{/if}
			</div>
			<div class="setting-row">
				<div class="connector-info">
					<span class="connector-name">Google Drive</span>
				</div>
				<span class="badge coming-soon">{$t['settings.comingSoon']}</span>
			</div>
			<div class="setting-row">
				<div class="connector-info">
					<span class="connector-name">Dropbox</span>
				</div>
				<span class="badge coming-soon">{$t['settings.comingSoon']}</span>
			</div>
		</section>

		<section class="settings-section">
			<div class="section-title">
				<Cloud size={18} strokeWidth={1.8} />
				<h3>{$t['settings.megaAccount']}</h3>
			</div>
			<div class="setting-row">
				<span class="setting-label">{$t['settings.status']}</span>
				{#if $isConnected}
					<span class="setting-value connected">{$userEmail ?? $t['settings.connected']}</span>
				{:else}
					<span class="setting-value disconnected">{$t['settings.notConnected']}</span>
				{/if}
			</div>
		</section>

		<section class="settings-section">
			<div class="section-title">
				<Sparkles size={18} strokeWidth={1.8} />
				<h3>{$t['settings.anime4k']}</h3>
			</div>
			<div class="setting-row">
				<span class="setting-label">{$t['settings.shaderMode']}</span>
				<select class="setting-select" value={$defaultShaderMode} onchange={handleShaderModeChange}>
					<option value="A">{$t['settings.modeA']}</option>
					<option value="B">{$t['settings.modeB']}</option>
					<option value="C">{$t['settings.modeC']}</option>
					<option value="off">{$t['settings.modeOff']}</option>
				</select>
			</div>
			<div class="setting-row">
				<span class="setting-label">{$t['settings.shaderVariant']}</span>
				<select class="setting-select" value={$defaultShaderVariant} onchange={handleShaderVariantChange} disabled={$defaultShaderMode === 'off'}>
					<option value="UL">{$t['settings.variantUL']}</option>
					<option value="VL">{$t['settings.variantVL']}</option>
					<option value="L">{$t['settings.variantL']}</option>
					<option value="M">{$t['settings.variantM']}</option>
					<option value="S">{$t['settings.variantS']}</option>
				</select>
			</div>
		</section>

		<section class="settings-section">
			<div class="section-title">
				<Play size={18} strokeWidth={1.8} />
				<h3>{$t['settings.player']}</h3>
			</div>
			<div class="setting-row">
				<span class="setting-label">{$t['settings.controlsHideDelay']}</span>
				<select class="setting-select" value={String($controlsHideDelay)} onchange={handleControlsHideDelayChange}>
					<option value="0">{$t['settings.delayNever']}</option>
					<option value="5000">{$t['settings.delay5']}</option>
					<option value="10000">{$t['settings.delay10']}</option>
					<option value="15000">{$t['settings.delay15']}</option>
					<option value="30000">{$t['settings.delay30']}</option>
					<option value="60000">{$t['settings.delay60']}</option>
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
