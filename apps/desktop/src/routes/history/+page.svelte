<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getHistory, removeFromHistory, clearHistory, getFavorites, removeFavorite, parseSourceKey } from '$lib/services/db-service';
	import { resolvePlayableUrl } from '$lib/services/prefetch-service';
	import { loadVideo } from '$lib/services/player-service';
	import { currentPath } from '$lib/stores/mega';
	import { playlist, playlistIndex } from '$lib/stores/player-ui';
	import { log } from '$lib/log';
	import { t } from '$lib/i18n';
	import type { HistoryEntry, FavoriteEntry } from '$lib/types/history';
	import type { MediaSource, PlaylistItem } from '$lib/types/player';
	import { Clock, Heart, Film, Folder, Trash2, Search, X, Cloud, HardDrive } from 'lucide-svelte';

	type TabId = 'history' | 'favorites';

	// History and favorites are shared by both media sources: their row key
	// (`mega_path`) is source-namespaced, so nothing here may assume Mega. Rows
	// are decorated once with the parsed source + bare path, and everything
	// downstream (playback, folder navigation, display) uses those instead of the
	// raw key. The raw key is still what the DB layer wants back, so removals and
	// the `loadingPlay` marker keep using `entry.mega_path` verbatim.
	interface Sourced {
		/** Where the row lives, derived from the stored key. */
		source: MediaSource;
		/**
		 * Bare, human-readable path: the Mega remote path, or the local
		 * filesystem path with the internal `file://` key prefix stripped.
		 */
		path: string;
	}
	type SourcedHistory = HistoryEntry & Sourced;
	type SourcedFavorite = FavoriteEntry & Sourced;
	/** Minimum shape `playEntry` needs -- satisfied by both decorated types. */
	type PlayableEntry = { mega_path: string; filename: string } & Sourced;

	function withSource<T extends { mega_path: string }>(entry: T): T & Sourced {
		return { ...entry, ...parseSourceKey(entry.mega_path) };
	}

	/**
	 * Human label for a source. Reuses existing nav/browser translations rather
	 * than introducing history-specific keys.
	 */
	function sourceLabel(source: MediaSource): string {
		return source === 'local' ? $t['local.title'] : $t['browser.cloudDrive'];
	}

	let activeTab = $state<TabId>('history');
	let historyItems = $state<HistoryEntry[]>([]);
	let favoriteItems = $state<FavoriteEntry[]>([]);
	let loading = $state(false);
	let error = $state('');
	let searchQuery = $state('');
	let loadingPlay = $state('');
	let confirmClear = $state(false);

	onMount(() => {
		loadData();
	});

	async function loadData() {
		loading = true;
		error = '';
		try {
			const [h, f] = await Promise.all([getHistory(), getFavorites()]);
			historyItems = h;
			favoriteItems = f;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function switchTab(tab: TabId) {
		activeTab = tab;
		searchQuery = '';
		confirmClear = false;
	}

	// Filename search works the same for both sources: local rows store their
	// basename in `filename` exactly like Mega rows do, so the filter needs no
	// source awareness (and never sees the `file://` key prefix).
	function matchesSearch(entry: { filename: string }): boolean {
		if (!searchQuery) return true;
		return entry.filename.toLowerCase().includes(searchQuery.toLowerCase());
	}

	let filteredHistory = $derived<SourcedHistory[]>(
		historyItems.filter(matchesSearch).map(withSource)
	);

	let filteredFavorites = $derived<SourcedFavorite[]>(
		favoriteItems.filter(matchesSearch).map(withSource)
	);

	/**
	 * Play a single history/favorite row, honouring its real source: local rows
	 * resolve to their filesystem path, Mega rows to a WebDAV URL.
	 *
	 * Note: this deliberately does not call `markWatched()`, so replaying from
	 * this page does not bump `play_count` -- same as before.
	 */
	async function playEntry(entry: PlayableEntry) {
		loadingPlay = entry.mega_path;
		error = '';
		try {
			const item: PlaylistItem = { source: entry.source, path: entry.path, name: entry.filename };
			playlist.set([item]);
			playlistIndex.set(0);
			const url = await resolvePlayableUrl(item);
			await loadVideo(url, entry.filename);
			goto('/player');
		} catch (e) {
			log.error('[History] playEntry failed:', e);
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loadingPlay = '';
		}
	}

	/**
	 * Open a favorited folder in the browser that owns it.
	 *
	 * Mega folders go through the mega store as before. Local folders go to the
	 * `/local` route, which reads the folder to open from the `path` query param
	 * (URL-encoded here): this page owns no local-browser state, so the URL is
	 * the hand-off contract. If that param were ever ignored, navigation still
	 * lands on the right page instead of failing.
	 */
	function navigateToFolder(entry: SourcedFavorite) {
		if (entry.source === 'local') {
			goto(`/local?path=${encodeURIComponent(entry.path)}`);
			return;
		}
		currentPath.set(entry.path);
		goto('/');
	}

	// Removals address rows by their stored key, prefix and all -- never the bare
	// path, which would miss every local row.
	async function handleRemoveHistory(key: string) {
		await removeFromHistory(key);
		historyItems = historyItems.filter((e) => e.mega_path !== key);
	}

	async function handleClearHistory() {
		if (!confirmClear) {
			confirmClear = true;
			return;
		}
		await clearHistory();
		historyItems = [];
		confirmClear = false;
	}

	async function handleRemoveFavorite(key: string) {
		await removeFavorite(key);
		favoriteItems = favoriteItems.filter((e) => e.mega_path !== key);
	}

	function formatDate(dateStr: string): string {
		try {
			const d = new Date(dateStr + 'Z');
			return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
		} catch {
			return dateStr;
		}
	}
</script>

<div class="history-page">
	<div class="page-header">
		<h2>{$t['history.title']}</h2>
		<p class="subtitle">{$t['history.subtitle']}</p>
	</div>

	<div class="tabs-row">
		<div class="tabs">
			<button class="tab" class:active={activeTab === 'history'} onclick={() => switchTab('history')}>
				<Clock size={14} strokeWidth={1.8} />
				<span>{$t['history.tabHistory']}</span>
			</button>
			<button class="tab" class:active={activeTab === 'favorites'} onclick={() => switchTab('favorites')}>
				<Heart size={14} strokeWidth={1.8} />
				<span>{$t['history.tabFavorites']}</span>
			</button>
		</div>
		<div class="tabs-actions">
			{#if activeTab === 'history' && historyItems.length > 0}
				<button class="clear-btn" class:confirm={confirmClear} onclick={handleClearHistory}>
					{#if confirmClear}
						{$t['history.clearConfirm']}
					{:else}
						<Trash2 size={14} strokeWidth={1.8} />
						{$t['history.clearHistory']}
					{/if}
				</button>
			{/if}
		</div>
	</div>

	<div class="search-bar">
		<span class="search-icon"><Search size={14} strokeWidth={2} /></span>
		<input type="text" placeholder={$t['history.filter']} bind:value={searchQuery} />
		{#if searchQuery}
			<button class="clear-search" onclick={() => searchQuery = ''}>
				<X size={14} />
			</button>
		{/if}
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if loading}
		<div class="loading-state">
			<span class="spinner"></span>
		</div>
	{:else if activeTab === 'history'}
		{#if filteredHistory.length === 0}
			<div class="empty-state">
				<Clock size={48} strokeWidth={1} />
				<p>{$t['history.empty']}</p>
				<p class="hint">{$t['history.emptyHint']}</p>
			</div>
		{:else}
			<div class="entry-list">
				{#each filteredHistory as entry (entry.mega_path)}
					<div class="entry-row" class:is-loading={loadingPlay === entry.mega_path}>
						<button class="entry-main" onclick={() => playEntry(entry)} disabled={!!loadingPlay} title={entry.path}>
							<span class="entry-icon"><Film size={16} strokeWidth={1.8} /></span>
							<span class="entry-name">{entry.filename}</span>
							<span class="entry-source" title={sourceLabel(entry.source)}>
								{#if entry.source === 'local'}
									<HardDrive size={13} strokeWidth={1.8} />
								{:else}
									<Cloud size={13} strokeWidth={1.8} />
								{/if}
							</span>
							<span class="entry-meta">{$t['history.playCount'].replace('{count}', String(entry.play_count))}</span>
							<span class="entry-date">{formatDate(entry.watched_at)}</span>
						</button>
						<button class="entry-action" onclick={() => handleRemoveHistory(entry.mega_path)} title={$t['history.removeFromHistory']}>
							<X size={14} strokeWidth={2} />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		{#if filteredFavorites.length === 0}
			<div class="empty-state">
				<Heart size={48} strokeWidth={1} />
				<p>{$t['history.favoritesEmpty']}</p>
				<p class="hint">{$t['history.favoritesEmptyHint']}</p>
			</div>
		{:else}
			<div class="entry-list">
				{#each filteredFavorites as entry (entry.mega_path)}
					<div class="entry-row">
						<button
							class="entry-main"
							onclick={() => entry.entry_type === 'folder' ? navigateToFolder(entry) : playEntry(entry)}
							disabled={!!loadingPlay}
							title={entry.path}
						>
							<span class="entry-icon" class:folder-icon={entry.entry_type === 'folder'}>
								{#if entry.entry_type === 'folder'}
									<Folder size={16} strokeWidth={1.8} />
								{:else}
									<Film size={16} strokeWidth={1.8} />
								{/if}
							</span>
							<span class="entry-name">{entry.filename}</span>
							<span class="entry-source" title={sourceLabel(entry.source)}>
								{#if entry.source === 'local'}
									<HardDrive size={13} strokeWidth={1.8} />
								{:else}
									<Cloud size={13} strokeWidth={1.8} />
								{/if}
							</span>
							<span class="entry-date">{formatDate(entry.favorited_at)}</span>
							{#if entry.entry_type === 'folder'}
								<span class="entry-badge">{$t['history.openFolder']}</span>
							{/if}
						</button>
						<button class="entry-action" onclick={() => handleRemoveFavorite(entry.mega_path)} title={$t['history.removeFavorite']}>
							<X size={14} strokeWidth={2} />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.history-page {
		max-width: var(--content-max-narrow);
	}

	.page-header {
		margin-bottom: 20px;
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

	.tabs-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.tabs {
		display: flex;
		gap: 4px;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border-radius: 6px;
		background: transparent;
		border: 1px solid transparent;
		color: var(--text-secondary);
		font-size: 0.82rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tab:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.tab.active {
		background: var(--bg-tertiary);
		border-color: var(--border);
		color: var(--accent);
	}

	.tabs-actions {
		display: flex;
		gap: 8px;
	}

	.clear-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		border-radius: 4px;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.clear-btn:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.clear-btn.confirm {
		background: rgba(248, 81, 73, 0.1);
		border-color: var(--danger);
		color: var(--danger);
	}

	.search-bar {
		position: relative;
		display: flex;
		align-items: center;
		margin-bottom: 12px;
	}

	.search-icon {
		position: absolute;
		left: 10px;
		color: var(--text-muted);
		pointer-events: none;
		display: flex;
		align-items: center;
	}

	.search-bar input {
		width: 100%;
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 8px 32px 8px 30px;
		color: var(--text-primary);
		font-size: 0.85rem;
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s;
	}

	.search-bar input:focus {
		border-color: var(--accent);
	}

	.clear-search {
		position: absolute;
		right: 8px;
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		padding: 2px;
	}

	.error-banner {
		background: rgba(248, 81, 73, 0.1);
		border: 1px solid var(--danger);
		border-radius: 6px;
		padding: 10px 14px;
		color: var(--danger);
		font-size: 0.85rem;
		margin-bottom: 12px;
	}

	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 60px 20px;
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

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px 20px;
		color: var(--text-muted);
		text-align: center;
		gap: 8px;
	}

	.empty-state p {
		font-size: 0.95rem;
	}

	.hint {
		font-size: 0.85rem !important;
		color: var(--text-muted);
	}

	.entry-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.entry-row {
		display: flex;
		align-items: center;
		gap: 0;
	}

	.entry-row.is-loading {
		opacity: 0.6;
		pointer-events: none;
	}

	.entry-main {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		padding: 10px 12px;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-size: 0.85rem;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
	}

	.entry-main:hover {
		background: rgba(88, 166, 255, 0.08);
	}

	.entry-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--success);
	}

	.entry-icon.folder-icon {
		color: var(--accent);
	}

	.entry-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Discreet source hint (Mega cloud vs local disk); tooltip carries the label. */
	.entry-source {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--text-muted);
		opacity: 0.75;
	}

	.entry-meta {
		color: var(--text-muted);
		font-size: 0.78rem;
		flex-shrink: 0;
	}

	.entry-date {
		color: var(--text-muted);
		font-size: 0.78rem;
		flex-shrink: 0;
	}

	.entry-badge {
		background: var(--accent);
		color: var(--bg-primary);
		font-size: 0.7rem;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 4px;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.entry-main:hover .entry-badge {
		opacity: 1;
	}

	.entry-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 36px;
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		border-radius: 4px;
		transition: color 0.15s;
		opacity: 0;
	}

	.entry-row:hover .entry-action {
		opacity: 1;
	}

	.entry-action:hover {
		color: var(--danger);
	}
</style>
