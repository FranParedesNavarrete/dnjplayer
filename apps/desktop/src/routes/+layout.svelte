<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { isConnected, userEmail } from '$lib/stores/mega';
	import { playerActive } from '$lib/stores/player-ui';
	import { theme } from '$lib/stores/theme';
	import { megaCheckStatus } from '$lib/services/mega-service';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { Library, CloudDownload, Zap, Settings, Play, Sun, Moon } from 'lucide-svelte';

	let { children } = $props();

	onMount(() => {
		theme.init();
		// Check Mega connection status on app startup
		megaCheckStatus().then((status) => {
			isConnected.set(status.logged_in);
			if (status.email) userEmail.set(status.email);
		}).catch(() => {
			// MEGAcmd not running or not installed — stay disconnected
		});
	});

	const navItems = [
		{ href: '/', labelKey: 'nav.library', icon: Library },
		{ href: '/browse', labelKey: 'nav.browse', icon: CloudDownload },
		{ href: '/player', labelKey: 'nav.player', icon: Play },
		{ href: '/queue', labelKey: 'nav.queue', icon: Zap },
		{ href: '/settings', labelKey: 'nav.settings', icon: Settings },
	];
</script>

<svelte:head>
	<title>dnjplayer</title>
</svelte:head>

<div class="app-shell">
	<nav class="sidebar">
		<div class="sidebar-header">
			<h1 class="logo">dnj<span class="logo-accent">player</span></h1>
		</div>
		<ul class="nav-list">
			{#each navItems as item}
				<li>
					<a
						href={item.href}
						class="nav-item"
						class:active={$page.url.pathname === item.href}
					>
						<span class="nav-icon">
							<item.icon size={18} strokeWidth={1.8} />
						</span>
						<span class="nav-label">{$t[item.labelKey]}</span>
					</a>
				</li>
			{/each}
		</ul>
		<div class="sidebar-footer">
			<button class="sidebar-theme-btn" onclick={() => theme.toggle()} aria-label="Toggle theme">
				{#if $theme === 'dark'}
					<Sun size={16} strokeWidth={1.8} />
				{:else}
					<Moon size={16} strokeWidth={1.8} />
				{/if}
			</button>
			<div class="connection-status">
				<span class="status-dot" class:online={$isConnected} class:offline={!$isConnected}></span>
				{#if $isConnected}
					<span class="status-text">{$userEmail ?? $t['status.connected']}</span>
				{:else}
					<span class="status-text">{$t['status.notConnected']}</span>
				{/if}
			</div>
		</div>
	</nav>
	<main class="content">
		{@render children()}
	</main>
</div>

<style>
	.app-shell {
		display: flex;
		height: 100vh;
		width: 100vw;
		background: var(--bg-primary);
	}

	.sidebar {
		width: var(--sidebar-width);
		min-width: var(--sidebar-width);
		background: var(--bg-secondary);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		padding: 0;
	}

	.sidebar-header {
		padding: 20px 16px 16px;
		border-bottom: 1px solid var(--border);
	}

	.logo {
		font-size: 1.3rem;
		font-weight: 700;
		letter-spacing: -0.5px;
	}

	.logo-accent {
		color: var(--accent);
	}

	.nav-list {
		list-style: none;
		padding: 8px;
		flex: 1;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 6px;
		color: var(--text-secondary);
		font-size: 0.9rem;
		transition: all 0.15s ease;
	}

	.nav-item:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.nav-item.active {
		background: var(--bg-tertiary);
		color: var(--accent);
	}

	.nav-icon {
		display: flex;
		align-items: center;
	}

	.sidebar-footer {
		padding: 12px 16px;
		border-top: 1px solid var(--border);
	}

	.connection-status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.status-dot.offline {
		background: var(--danger);
	}

	.status-dot.online {
		background: var(--success);
	}

	.status-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sidebar-theme-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text-secondary);
		margin-bottom: 8px;
		transition: all 0.15s ease;
	}

	.sidebar-theme-btn:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
	}
</style>
