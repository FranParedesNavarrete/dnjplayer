<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { megaListFiles, megaListShares, megaSearch } from '$lib/services/mega-service';
	import {
		resolvePlayableUrl,
		prefetchAround,
		clearPrefetchCache
	} from '$lib/services/prefetch-service';
	import { loadVideo } from '$lib/services/player-service';
	import { markWatched, getWatchedPaths, getFavoritePaths, toggleFavorite } from '$lib/services/db-service';
	import { log } from '$lib/log';
	import { currentPath, entries, isLoading, megaError } from '$lib/stores/mega';
	import { playlist, playlistIndex } from '$lib/stores/player-ui';
	import type { MegaEntry } from '$lib/types/mega';
	import type { MegaShare } from '$lib/types/mega';
	import type { PlaylistItem } from '$lib/types/player';
	import { Folder, Film, Music, Image, FileText, File, ArrowUp, Search, Cloud, Users, Check, Square, CheckSquare, Play, Loader2, Heart, X } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import { isVideo, isAudio, isImage, isSubtitle } from '$lib/utils/media-types';

	type SectionId = 'cloud' | 'shared';

	const SECTIONS: { id: SectionId; labelKey: string; icon: typeof Cloud }[] = [
		{ id: 'cloud', labelKey: 'browser.cloudDrive', icon: Cloud },
		{ id: 'shared', labelKey: 'browser.sharedItems', icon: Users },
	];

	let searchQuery = $state('');
	let error = $state('');
	let activeTab = $state<SectionId>('cloud');
	let shares = $state<MegaShare[]>([]);

	// Global recursive search state
	let searchResults = $state<MegaEntry[]>([]);
	let isSearching = $state(false);
	let searchSeq = 0; // guards against stale async results
	let searchActive = $derived(searchQuery.trim().length >= 2);
	let watchedPaths = $state<Set<string>>(new Set());
	let favoritePaths = $state<Set<string>>(new Set());

	// Selection state
	let selectedPaths = $state<Set<string>>(new Set());
	let selectionType = $state<'file' | 'folder' | null>(null);
	let loadingSelection = $state(false);

	let selectedCount = $derived(selectedPaths.size);
	let hasSelection = $derived(selectedCount > 0);
	let foldersDisabled = $derived(selectionType === 'file');
	let filesDisabled = $derived(selectionType === 'folder');

	onMount(async () => {
		try {
			const [w, f] = await Promise.all([getWatchedPaths(), getFavoritePaths()]);
			watchedPaths = w;
			favoritePaths = f;
		} catch (e) {
			log.warn('[FileBrowser] Failed to load watched/favorite paths:', e);
		}
	});

	async function handleToggleFavorite(entry: MegaEntry) {
		const entryType = entry.entry_type === 'folder' ? 'folder' : 'file';
		const added = await toggleFavorite(entry.path, entry.name, entryType as 'file' | 'folder');
		const next = new Set(favoritePaths);
		if (added) {
			next.add(entry.path);
		} else {
			next.delete(entry.path);
		}
		favoritePaths = next;
	}

	let isInsideShare = $derived($currentPath.startsWith('//from/'));

	$effect(() => {
		if (activeTab === 'cloud' || isInsideShare) {
			loadFiles($currentPath);
		} else if (activeTab === 'shared') {
			loadShares();
		}
	});

	async function loadFiles(path: string) {
		isLoading.set(true);
		error = '';
		megaError.set(null);
		try {
			const files = await megaListFiles(path);
			entries.set(files);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			error = msg;
			megaError.set(msg);
		} finally {
			isLoading.set(false);
		}
	}

	async function loadShares() {
		isLoading.set(true);
		error = '';
		megaError.set(null);
		try {
			shares = await megaListShares();
			entries.set([]);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			error = msg;
			megaError.set(msg);
		} finally {
			isLoading.set(false);
		}
	}

	/**
	 * Roots to search recursively, scoped to the current location:
	 * - Cloud drive: the folder you're browsing (root `/` = the whole drive).
	 * - Inside a share: that share/subfolder (recurses into its subfolders).
	 * - Shared list: every incoming share (MEGAcmd can't search `//from`
	 *   directly, so each share is searched individually).
	 * In every case `find` recurses all the way down, so nested subfolder
	 * contents are always included.
	 */
	async function getSearchRoots(): Promise<string[]> {
		if (activeTab === 'cloud' || isInsideShare) return [$currentPath];
		// Shared section, at the list of shares: search across all shares.
		let list = shares;
		if (list.length === 0) {
			list = await megaListShares();
			shares = list;
		}
		return list.map((s) => s.path);
	}

	async function runSearch(query: string) {
		const seq = ++searchSeq;
		isSearching = true;
		error = '';
		try {
			const roots = await getSearchRoots();
			const results = await megaSearch(query, roots);
			if (seq !== searchSeq) return; // a newer search superseded this one
			searchResults = results;
		} catch (e) {
			if (seq !== searchSeq) return;
			error = e instanceof Error ? e.message : String(e);
			searchResults = [];
		} finally {
			if (seq === searchSeq) isSearching = false;
		}
	}

	// Debounced recursive search: re-runs when the query or the active section
	// changes. Queries shorter than 2 chars clear the results.
	$effect(() => {
		const query = searchQuery.trim();
		activeTab; // track section so switching tabs re-runs the search
		$currentPath; // track location so the scope follows where you are
		if (query.length < 2) {
			searchSeq++; // cancel any in-flight search
			searchResults = [];
			isSearching = false;
			return;
		}
		const timer = setTimeout(() => runSearch(query), 350);
		return () => clearTimeout(timer);
	});

	function clearSearch() {
		searchQuery = '';
		searchResults = [];
		searchSeq++;
		isSearching = false;
	}

	function clearSelection() {
		selectedPaths = new Set();
		selectionType = null;
	}

	function navigateToFolder(entry: MegaEntry) {
		clearSelection();
		// If we navigated from a search result, switch to the share section when
		// the target lives inside an incoming share so the browse view loads it.
		if (entry.path.startsWith('//from/')) activeTab = 'shared';
		clearSearch();
		currentPath.set(entry.path);
	}

	function navigateToShare(share: MegaShare) {
		clearSelection();
		currentPath.set(share.path);
	}

	function navigateUp() {
		clearSelection();
		const path = $currentPath;
		if (activeTab === 'cloud' && path === '/') return;
		if (isInsideShare) {
			const afterFrom = path.replace('//from/', '');
			if (!afterFrom.includes('/')) {
				activeTab = 'shared';
				currentPath.set('/');
				return;
			}
		}
		const parent = path.replace(/\/[^/]+\/?$/, '') || '/';
		currentPath.set(parent);
	}

	function switchTab(tab: SectionId) {
		clearSelection();
		clearSearch();
		activeTab = tab;
		if (tab === 'cloud') {
			currentPath.set('/');
		}
	}

	function toggleSelection(entry: MegaEntry) {
		const entryType = entry.entry_type === 'folder' ? 'folder' : 'file';
		if (selectionType !== null && selectionType !== entryType) return;

		const next = new Set(selectedPaths);
		if (next.has(entry.path)) {
			next.delete(entry.path);
			if (next.size === 0) selectionType = null;
		} else {
			next.add(entry.path);
			selectionType = entryType;
		}
		selectedPaths = next;
	}

	let loadingPlay = $state('');
	let loadingStep = $state('');

	async function playVideo(entry: MegaEntry) {
		error = '';
		loadingPlay = entry.name;
		try {
			clearPrefetchCache();
			const item: PlaylistItem = { source: 'mega', path: entry.path, name: entry.name };
			playlist.set([item]);
			playlistIndex.set(0);

			loadingStep = $t['browser.loadingWebdav'];
			log.info('[FileBrowser] Getting WebDAV URL for:', entry.path);
			const url = await resolvePlayableUrl(item);
			log.info('[FileBrowser] Got WebDAV URL:', url);

			loadingStep = $t['browser.loadingPlayer'];
			log.info('[FileBrowser] Initializing player...');
			await loadVideo(url, entry.name);
			log.info('[FileBrowser] Player ready, navigating...');

			markWatched(entry.path, entry.name).then(() => {
				watchedPaths = new Set([...watchedPaths, entry.path]);
			}).catch((e) => log.warn('[FileBrowser] Failed to mark watched:', e));
			goto('/player');
		} catch (e) {
			log.error('[FileBrowser] playVideo failed:', e);
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loadingPlay = '';
			loadingStep = '';
		}
	}

	async function playSelected() {
		if (selectedPaths.size === 0) return;

		loadingSelection = true;
		error = '';

		try {
			let playlistItems: PlaylistItem[] = [];

			if (selectionType === 'file') {
				const selectedFiles = files
					.filter((f) => selectedPaths.has(f.path) && isVideo(f.name))
					.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
				playlistItems = selectedFiles.map((f) => ({
					source: 'mega' as const,
					path: f.path,
					name: f.name
				}));
			} else if (selectionType === 'folder') {
				const selectedFolders = folders
					.filter((f) => selectedPaths.has(f.path))
					.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

				for (const folder of selectedFolders) {
					try {
						const folderEntries = await megaListFiles(folder.path);
						const videoFiles = folderEntries
							.filter((e) => e.entry_type === 'file' && isVideo(e.name))
							.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
						playlistItems.push(
							...videoFiles.map((f) => ({
								source: 'mega' as const,
								path: f.path,
								name: f.name
							}))
						);
					} catch (e) {
						log.warn('[FileBrowser] Failed to load folder:', folder.path, e);
					}
				}
			}

			if (playlistItems.length === 0) {
				error = 'No video files found in selection.';
				return;
			}

			clearPrefetchCache();
			playlist.set(playlistItems);
			playlistIndex.set(0);

			const firstItem = playlistItems[0];
			const url = await resolvePlayableUrl(firstItem);
			await loadVideo(url, firstItem.name);
			prefetchAround(0);
			markWatched(firstItem.path, firstItem.name).then(() => {
				watchedPaths = new Set([...watchedPaths, firstItem.path]);
			}).catch((e) => log.warn('[FileBrowser] Failed to mark watched:', e));

			log.info('[FileBrowser] Playlist loaded with', playlistItems.length, 'items');
			clearSelection();
			goto('/player');
		} catch (e) {
			log.error('[FileBrowser] playSelected failed:', e);
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loadingSelection = false;
		}
	}

	function handleEntryClick(entry: MegaEntry) {
		if (entry.entry_type === 'folder') {
			navigateToFolder(entry);
		} else if (isVideo(entry.name)) {
			playVideo(entry);
		}
	}

	function handleEntryKeydown(e: KeyboardEvent, entry: MegaEntry) {
		if (e.key === 'Enter') handleEntryClick(entry);
	}

	// When a search is active, show recursive results; otherwise the current folder.
	let sourceEntries = $derived(searchActive ? searchResults : $entries);

	let folders = $derived(sourceEntries.filter((e) => e.entry_type === 'folder'));
	let files = $derived(sourceEntries.filter((e) => e.entry_type === 'file'));
</script>

<div class="file-browser">
	<div class="section-tabs">
		{#each SECTIONS as section}
			<button
				class="section-tab"
				class:active={activeTab === section.id}
				onclick={() => switchTab(section.id)}
			>
				<section.icon size={14} strokeWidth={1.8} />
				<span>{$t[section.labelKey]}</span>
			</button>
		{/each}
	</div>

	<div class="browser-toolbar">
		<div class="path-bar">
			<button
				class="btn-icon"
				onclick={navigateUp}
				disabled={activeTab === 'cloud' && $currentPath === '/' && !isInsideShare}
				title={$t['browser.goUp']}
			>
				<ArrowUp size={16} strokeWidth={2} />
			</button>
			<span class="current-path">
				{#if searchActive}
					{($t['browser.searching'].replace('...', '') + ': ') +
						(activeTab === 'shared' && !isInsideShare
							? $t['browser.sharedItems']
							: $currentPath)}
				{:else if activeTab === 'shared' && !isInsideShare}
					{$t['browser.sharedWith']}
				{:else}
					{$currentPath}
				{/if}
			</span>
		</div>
		<div class="search-bar">
			<span class="search-icon-wrap"><Search size={14} strokeWidth={2} /></span>
			<input
				type="text"
				placeholder={activeTab === 'shared'
					? $t['browser.searchShared']
					: $t['browser.searchCloud']}
				bind:value={searchQuery}
			/>
			{#if searchQuery}
				<button class="search-clear" onclick={clearSearch} title={$t['browser.clearSelection']}>
					<X size={14} strokeWidth={2} />
				</button>
			{/if}
		</div>
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if hasSelection}
		<div class="selection-bar">
			<span class="selection-count">{$t['browser.selectedCount'].replace('{count}', String(selectedCount))}</span>
			<div class="selection-actions">
				<button class="selection-clear-btn" onclick={clearSelection}>
					{$t['browser.clearSelection']}
				</button>
				<button class="selection-play-btn" onclick={playSelected} disabled={loadingSelection}>
					{#if loadingSelection}
						<span class="spinner-small"></span>
						{$t['browser.loadingFolders']}
					{:else}
						<Play size={14} strokeWidth={2} />
						{$t['browser.playSelected']}
					{/if}
				</button>
			</div>
		</div>
	{/if}

	{#if $isLoading || isSearching}
		<div class="loading-state">
			<span class="spinner"></span>
			<span>{isSearching ? $t['browser.searching'] : $t['browser.loading']}</span>
		</div>
	{:else if activeTab === 'shared' && !isInsideShare && !searchActive}
		{#if shares.length === 0}
			<div class="empty-state">
				<p>{$t['browser.noShared']}</p>
			</div>
		{:else}
			<div class="file-list">
				{#each shares as share (share.path)}
					<button
						class="file-entry is-folder"
						onclick={() => navigateToShare(share)}
					>
						<span class="entry-icon folder-icon">
							<Users size={16} strokeWidth={1.8} />
						</span>
						<span class="entry-name">{share.name}</span>
						<span class="share-owner">{share.owner}</span>
						<span class="share-access">{share.access}</span>
					</button>
				{/each}
			</div>
		{/if}
	{:else if sourceEntries.length === 0}
		<div class="empty-state">
			<p>{searchActive ? $t['browser.noResults'] : $t['browser.noFiles']}</p>
		</div>
	{:else}
		<div class="file-list">
			{#each folders as entry (entry.path)}
				<div class="file-entry-row">
					<button
						class="checkbox-btn"
						class:disabled={foldersDisabled}
						onclick={(e) => { e.stopPropagation(); if (!foldersDisabled) toggleSelection(entry); }}
					>
						{#if selectedPaths.has(entry.path)}
							<CheckSquare size={16} />
						{:else}
							<Square size={16} />
						{/if}
					</button>
					<button
						class="file-entry is-folder"
						onclick={() => handleEntryClick(entry)}
						onkeydown={(e) => handleEntryKeydown(e, entry)}
					>
						<span class="entry-icon folder-icon">
							<Folder size={16} strokeWidth={1.8} />
						</span>
						<span class="entry-name">{entry.name}</span>
						<span class="entry-size">{entry.size}</span>
					</button>
					<button
						class="fav-btn"
						class:is-fav={favoritePaths.has(entry.path)}
						onclick={(e) => { e.stopPropagation(); handleToggleFavorite(entry); }}
					>
						<Heart size={14} strokeWidth={1.8} />
					</button>
				</div>
			{/each}
			{#each files as entry (entry.path)}
				<div class="file-entry-row">
					{#if isVideo(entry.name)}
						<button
							class="checkbox-btn"
							class:disabled={filesDisabled}
							onclick={(e) => { e.stopPropagation(); if (!filesDisabled) toggleSelection(entry); }}
						>
							{#if selectedPaths.has(entry.path)}
								<CheckSquare size={16} />
							{:else}
								<Square size={16} />
							{/if}
						</button>
					{:else}
						<span class="checkbox-spacer"></span>
					{/if}
					<button
						class="file-entry"
						class:is-video={isVideo(entry.name)}
						class:is-loading={loadingPlay === entry.name}
						disabled={!!loadingPlay}
						onclick={() => handleEntryClick(entry)}
						onkeydown={(e) => handleEntryKeydown(e, entry)}
					>
						<span class="entry-icon" class:video-icon={isVideo(entry.name)}>
							{#if loadingPlay === entry.name}
								<Loader2 size={16} strokeWidth={1.8} class="spin" />
							{:else if isVideo(entry.name)}
								<Film size={16} strokeWidth={1.8} />
							{:else if isAudio(entry.name)}
								<Music size={16} strokeWidth={1.8} />
							{:else if isImage(entry.name)}
								<Image size={16} strokeWidth={1.8} />
							{:else if isSubtitle(entry.name)}
								<FileText size={16} strokeWidth={1.8} />
							{:else}
								<File size={16} strokeWidth={1.8} />
							{/if}
						</span>
						<span class="entry-name">{entry.name}</span>
						{#if watchedPaths.has(entry.path)}
							<span class="watched-badge" title={$t['browser.watched']}>
								<Check size={14} strokeWidth={2.5} />
							</span>
						{/if}
						<span class="entry-size">{entry.size}</span>
						{#if loadingPlay === entry.name}
							<span class="loading-badge">{loadingStep || $t['browser.loading']}</span>
						{:else if isVideo(entry.name)}
							<span class="play-badge">{$t['browser.play']}</span>
						{/if}
					</button>
					<button
						class="fav-btn"
						class:is-fav={favoritePaths.has(entry.path)}
						onclick={(e) => { e.stopPropagation(); handleToggleFavorite(entry); }}
					>
						<Heart size={14} strokeWidth={1.8} />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.file-browser {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.section-tabs {
		display: flex;
		gap: 4px;
		padding-bottom: 12px;
		margin-bottom: 12px;
		border-bottom: 1px solid var(--border);
	}

	.section-tab {
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

	.section-tab:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.section-tab.active {
		background: var(--bg-tertiary);
		border-color: var(--border);
		color: var(--accent);
	}

	.browser-toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 12px;
	}

	.path-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.btn-icon {
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px 8px;
		color: var(--text-primary);
		transition: background 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.btn-icon:hover:not(:disabled) {
		background: var(--border);
	}

	.btn-icon:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.current-path {
		font-size: 0.85rem;
		color: var(--text-secondary);
		font-family: monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.search-bar {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon-wrap {
		position: absolute;
		left: 10px;
		color: var(--text-muted);
		pointer-events: none;
		display: flex;
		align-items: center;
	}

	.search-bar input {
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 7px 30px 7px 30px;
		color: var(--text-primary);
		font-size: 0.85rem;
		font-family: inherit;
		outline: none;
		width: clamp(160px, 20vw, 280px);
		transition: border-color 0.15s;
	}

	.search-bar input:focus {
		border-color: var(--accent);
	}

	.search-clear {
		position: absolute;
		right: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: var(--text-muted);
		cursor: pointer;
		transition: color 0.15s;
	}

	.search-clear:hover {
		color: var(--text-primary);
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

	.selection-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px;
		margin-bottom: 12px;
		background: rgba(88, 166, 255, 0.08);
		border: 1px solid var(--accent);
		border-radius: 6px;
	}

	.selection-count {
		font-size: 0.85rem;
		color: var(--accent);
		font-weight: 500;
	}

	.selection-actions {
		display: flex;
		gap: 8px;
	}

	.selection-clear-btn {
		padding: 5px 12px;
		border-radius: 4px;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.selection-clear-btn:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.selection-play-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 14px;
		border-radius: 4px;
		background: var(--accent);
		border: none;
		color: var(--bg-primary);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.selection-play-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.selection-play-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 60px 20px;
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

	.spinner-small {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255,255,255,0.3);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.empty-state {
		padding: 60px 20px;
		text-align: center;
		color: var(--text-secondary);
	}

	.file-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
	}

	.file-entry-row {
		display: flex;
		align-items: center;
		gap: 0;
	}

	.checkbox-btn {
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
	}

	.checkbox-btn:hover:not(.disabled) {
		color: var(--accent);
	}

	.checkbox-btn.disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.checkbox-spacer {
		width: 32px;
		flex-shrink: 0;
	}

	.file-entry {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-size: 0.85rem;
		font-family: inherit;
		text-align: left;
		transition: background 0.1s;
		flex: 1;
		min-width: 0;
	}

	.file-entry:hover {
		background: var(--bg-tertiary);
		cursor: pointer;
	}

	.file-entry.is-video:hover,
	.file-entry.is-folder:hover {
		background: rgba(88, 166, 255, 0.08);
	}

	.entry-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.entry-icon.folder-icon {
		color: var(--accent);
	}

	.entry-icon.video-icon {
		color: var(--success);
	}

	.entry-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.entry-size {
		color: var(--text-muted);
		font-size: 0.8rem;
		flex-shrink: 0;
	}

	.share-owner {
		color: var(--text-muted);
		font-size: 0.78rem;
		flex-shrink: 0;
	}

	.share-access {
		color: var(--text-muted);
		font-size: 0.72rem;
		background: var(--bg-tertiary);
		padding: 2px 8px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.watched-badge {
		display: flex;
		align-items: center;
		color: var(--success);
		flex-shrink: 0;
	}

	.play-badge {
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

	.file-entry:hover .play-badge {
		opacity: 1;
	}

	.file-entry.is-loading {
		opacity: 0.7;
		pointer-events: none;
	}

	.loading-badge {
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 500;
		flex-shrink: 0;
	}

	.fav-btn {
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

	.file-entry-row:hover .fav-btn {
		opacity: 1;
	}

	.fav-btn:hover {
		color: #f85149;
	}

	.fav-btn.is-fav {
		color: #f85149;
		opacity: 1;
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
