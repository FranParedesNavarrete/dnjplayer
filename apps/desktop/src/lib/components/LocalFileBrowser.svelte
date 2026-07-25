<script lang="ts">
	import { goto, afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import {
		localListDir,
		localListRoots,
		localScanFolder,
		localSearch,
		localPickFolder,
		type LocalRoot
	} from '$lib/services/local-service';
	import {
		getSavedRoots,
		addSavedRoot,
		removeSavedRoot,
		type SavedRoot
	} from '$lib/services/local-roots-service';
	import { resolvePlayableUrl, clearPrefetchCache } from '$lib/services/prefetch-service';
	import { loadVideo } from '$lib/services/player-service';
	import {
		markWatched,
		getWatchedPaths,
		getFavoritePaths,
		toggleFavorite,
		toDbKey
	} from '$lib/services/db-service';
	import { log } from '$lib/log';
	import { playlist, playlistIndex } from '$lib/stores/player-ui';
	import type { FsEntry } from '$lib/types/mega';
	import type { PlaylistItem } from '$lib/types/player';
	import { isVideo, isAudio, isImage, isSubtitle } from '$lib/utils/media-types';
	import { parentPath, baseName } from '$lib/utils/fs-path';
	import { t } from '$lib/i18n';
	import {
		Folder,
		FolderOpen,
		FolderPlus,
		Film,
		Music,
		Image,
		FileText,
		File,
		ArrowUp,
		HardDrive,
		Home,
		Search,
		Square,
		CheckSquare,
		Check,
		Play,
		Loader2,
		Heart,
		Trash2,
		AlertTriangle,
		X
	} from 'lucide-svelte';

	// `null` means "the starting view": saved folders + the machine's drives.
	let currentPath = $state<string | null>(null);
	let entries = $state<FsEntry[]>([]);
	let isLoading = $state(false);
	let error = $state('');
	// Set when the folder itself cannot be listed (typically an external drive
	// that got unplugged) so we can show a friendly message instead of the raw
	// Rust error.
	let unavailable = $state(false);

	let savedRoots = $state<SavedRoot[]>([]);
	let systemRoots = $state<LocalRoot[]>([]);
	let isPicking = $state(false);

	// Recursive search, scoped to the folder being browsed.
	let searchQuery = $state('');
	let searchResults = $state<FsEntry[]>([]);
	let isSearching = $state(false);
	let searchSeq = 0; // guards against stale async results
	let searchActive = $derived(searchQuery.trim().length >= 2);

	// DB-backed badges. These hold row keys AS STORED, i.e. `file://` + path for
	// local entries, so every lookup goes through toDbKey().
	let watchedPaths = $state<Set<string>>(new Set());
	let favoritePaths = $state<Set<string>>(new Set());

	// Selection is homogeneous: either files or folders, never both.
	let selectedPaths = $state<Set<string>>(new Set());
	let selectionType = $state<'file' | 'folder' | null>(null);
	let loadingSelection = $state(false);

	let selectedCount = $derived(selectedPaths.size);
	let hasSelection = $derived(selectedCount > 0);
	let foldersDisabled = $derived(selectionType === 'file');
	let filesDisabled = $derived(selectionType === 'folder');

	// Per-row playback feedback.
	let loadingPlay = $state('');
	let loadingStep = $state('');

	let sourceEntries = $derived(searchActive ? searchResults : entries);
	let folders = $derived(sourceEntries.filter((e) => e.entry_type === 'folder'));
	// Only playable files are listed. A local folder is usually not a curated
	// media library -- pointing this at Downloads would otherwise fill the list
	// with .dmg, .pdf and other noise the player can't open anyway. Folders are
	// always shown, since they may contain videos further down.
	let files = $derived(
		sourceEntries.filter((e) => e.entry_type === 'file' && isVideo(e.name))
	);

	onMount(async () => {
		await Promise.all([loadRoots(), loadDbBadges()]);
	});

	// Whether the URL we last handled carried a `?path=` deep link.
	let deepLinkWasApplied = false;

	/**
	 * Deep link support: History/Favorites open a local folder with
	 * `/local?path=<encoded absolute path>`.
	 *
	 * Consumed in `afterNavigate` rather than in an `$effect` on purpose. It runs
	 * once per navigation — including the initial one — and browsing inside this
	 * component never touches the URL, so it never fires while the user is moving
	 * around. An `$effect` reading the page store could re-run on any store
	 * update and drag the user back out of the folder they had just opened.
	 */
	afterNavigate(() => {
		// searchParams.get() already percent-decodes; no decodeURIComponent here.
		const deepLink = get(page).url.searchParams.get('path');
		if (deepLink) {
			// A folder that no longer exists lands in loadDir()'s missing-folder
			// branch, i.e. the `local.folderUnavailable` panel.
			openFolder(deepLink);
		} else if (deepLinkWasApplied) {
			// Navigated back to a bare /local: drop the deep link.
			goHome();
		}
		deepLinkWasApplied = deepLink !== null;
	});

	async function loadDbBadges() {
		try {
			const [w, f] = await Promise.all([getWatchedPaths(), getFavoritePaths()]);
			watchedPaths = w;
			favoritePaths = f;
		} catch (e) {
			log.warn('[LocalFileBrowser] Failed to load watched/favorite paths:', e);
		}
	}

	async function loadRoots() {
		try {
			savedRoots = await getSavedRoots();
		} catch (e) {
			log.warn('[LocalFileBrowser] Failed to load saved folders:', e);
		}
		try {
			systemRoots = await localListRoots();
		} catch (e) {
			log.warn('[LocalFileBrowser] Failed to list drives:', e);
		}
	}

	/** A listing error caused by the folder being gone (unplugged drive, moved). */
	function isMissingFolderError(message: string): boolean {
		return message.includes('Folder not found') || message.includes('Not a folder');
	}

	// Sequence guard for directory listings, mirroring `searchSeq`. Without it a
	// slow listing (unplugged drive, sluggish network mount) can land after the
	// user has already navigated elsewhere and overwrite the current folder --
	// either painting the wrong entries or flagging the new folder unavailable.
	let dirSeq = 0;

	async function loadDir(path: string) {
		const seq = ++dirSeq;
		isLoading = true;
		error = '';
		unavailable = false;
		try {
			const result = await localListDir(path);
			if (seq !== dirSeq) return; // superseded by a newer navigation
			entries = result;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.warn('[LocalFileBrowser] Failed to list folder:', path, msg);
			if (seq !== dirSeq) return;
			entries = [];
			if (isMissingFolderError(msg)) {
				unavailable = true;
			} else {
				error = msg;
			}
		} finally {
			if (seq === dirSeq) isLoading = false;
		}
	}

	function clearSelection() {
		selectedPaths = new Set();
		selectionType = null;
	}

	function clearSearch() {
		searchQuery = '';
		searchResults = [];
		searchSeq++;
		isSearching = false;
	}

	function openFolder(path: string) {
		clearSelection();
		clearSearch();
		currentPath = path;
		loadDir(path);
	}

	/** Back to the starting view (saved folders + drives). */
	function goHome() {
		clearSelection();
		clearSearch();
		dirSeq++; // discard any listing still in flight
		currentPath = null;
		entries = [];
		error = '';
		unavailable = false;
		isLoading = false;
		loadRoots();
	}

	/**
	 * Up one folder. Cross-platform via parentPath(): `null` means we are at a
	 * filesystem root (`/`, `C:\`, `\\server\share`), where the only sensible
	 * "up" is the starting view.
	 */
	function navigateUp() {
		if (currentPath === null) return;
		const parent = parentPath(currentPath);
		if (parent === null) goHome();
		else openFolder(parent);
	}

	async function runSearch(query: string) {
		if (currentPath === null) return;
		const seq = ++searchSeq;
		isSearching = true;
		error = '';
		try {
			const results = await localSearch(query, [currentPath]);
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

	// Debounced recursive search over the current folder. Queries shorter than
	// 2 chars clear the results and cancel anything in flight.
	$effect(() => {
		const query = searchQuery.trim();
		currentPath; // re-run when the browsed folder changes
		if (query.length < 2) {
			searchSeq++;
			searchResults = [];
			isSearching = false;
			return;
		}
		const timer = setTimeout(() => runSearch(query), 350);
		return () => clearTimeout(timer);
	});

	async function addFolder() {
		isPicking = true;
		error = '';
		try {
			const picked = await localPickFolder();
			if (!picked) return;
			await addSavedRoot(picked, baseName(picked));
			savedRoots = await getSavedRoots();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			isPicking = false;
		}
	}

	async function removeFolder(path: string) {
		try {
			await removeSavedRoot(path);
			savedRoots = await getSavedRoots();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function handleToggleFavorite(entry: FsEntry) {
		const key = toDbKey('local', entry.path);
		try {
			const added = await toggleFavorite(key, entry.name, entry.entry_type);
			const next = new Set(favoritePaths);
			if (added) next.add(key);
			else next.delete(key);
			favoritePaths = next;
		} catch (e) {
			log.warn('[LocalFileBrowser] Failed to toggle favorite:', e);
		}
	}

	function markPlayed(path: string, name: string) {
		const key = toDbKey('local', path);
		markWatched(key, name)
			.then(() => {
				watchedPaths = new Set([...watchedPaths, key]);
			})
			.catch((e) => log.warn('[LocalFileBrowser] Failed to mark watched:', e));
	}

	function toggleSelection(entry: FsEntry) {
		if (selectionType !== null && selectionType !== entry.entry_type) return;

		const next = new Set(selectedPaths);
		if (next.has(entry.path)) {
			next.delete(entry.path);
			if (next.size === 0) selectionType = null;
		} else {
			next.add(entry.path);
			selectionType = entry.entry_type;
		}
		selectedPaths = next;
	}

	const byNaturalName = (a: FsEntry, b: FsEntry) =>
		a.name.localeCompare(b.name, undefined, { numeric: true });

	async function playVideo(entry: FsEntry) {
		error = '';
		loadingPlay = entry.name;
		try {
			clearPrefetchCache();
			const item: PlaylistItem = { source: 'local', path: entry.path, name: entry.name };
			playlist.set([item]);
			playlistIndex.set(0);

			loadingStep = $t['browser.loadingPlayer'];
			// Local items resolve to their own path instantly, no WebDAV round-trip.
			const url = await resolvePlayableUrl(item);
			await loadVideo(url, entry.name);

			markPlayed(entry.path, entry.name);
			goto('/player');
		} catch (e) {
			log.error('[LocalFileBrowser] playVideo failed:', e);
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
				playlistItems = files
					.filter((f) => selectedPaths.has(f.path) && isVideo(f.name))
					.sort(byNaturalName)
					.map((f) => ({ source: 'local' as const, path: f.path, name: f.name }));
			} else if (selectionType === 'folder') {
				const selectedFolders = folders
					.filter((f) => selectedPaths.has(f.path))
					.sort(byNaturalName);

				for (const folder of selectedFolders) {
					try {
						// Already filtered to videos and naturally sorted by Rust.
						const videos = await localScanFolder(folder.path);
						playlistItems.push(
							...videos.map((f) => ({ source: 'local' as const, path: f.path, name: f.name }))
						);
					} catch (e) {
						log.warn('[LocalFileBrowser] Failed to scan folder:', folder.path, e);
					}
				}
			}

			if (playlistItems.length === 0) {
				error = $t['local.noVideos'];
				return;
			}

			clearPrefetchCache();
			playlist.set(playlistItems);
			playlistIndex.set(0);

			const firstItem = playlistItems[0];
			const url = await resolvePlayableUrl(firstItem);
			await loadVideo(url, firstItem.name);
			// No prefetchAround(): local items have nothing to warm up.
			markPlayed(firstItem.path, firstItem.name);

			log.info('[LocalFileBrowser] Playlist loaded with', playlistItems.length, 'items');
			clearSelection();
			goto('/player');
		} catch (e) {
			log.error('[LocalFileBrowser] playSelected failed:', e);
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loadingSelection = false;
		}
	}

	function handleEntryClick(entry: FsEntry) {
		if (entry.entry_type === 'folder') openFolder(entry.path);
		else if (isVideo(entry.name)) playVideo(entry);
	}

	function handleEntryKeydown(e: KeyboardEvent, entry: FsEntry) {
		if (e.key === 'Enter') handleEntryClick(entry);
	}
</script>

<div class="local-browser">
	{#if currentPath === null}
		<div class="browser-toolbar">
			<div class="path-bar">
				<span class="current-path">{$t['local.title']}</span>
			</div>
			<button class="add-folder-btn" onclick={addFolder} disabled={isPicking}>
				<FolderPlus size={14} strokeWidth={2} />
				{$t['local.addFolder']}
			</button>
		</div>
	{:else}
		<div class="browser-toolbar">
			<div class="path-bar">
				<button class="btn-icon" onclick={goHome} title={$t['local.savedFolders']}>
					<Home size={16} strokeWidth={2} />
				</button>
				<button class="btn-icon" onclick={navigateUp} title={$t['browser.goUp']}>
					<ArrowUp size={16} strokeWidth={2} />
				</button>
				<span class="current-path">{currentPath}</span>
			</div>
			<div class="search-bar">
				<span class="search-icon-wrap"><Search size={14} strokeWidth={2} /></span>
				<input
					type="text"
					placeholder={$t['local.searchPlaceholder']}
					bind:value={searchQuery}
				/>
				{#if searchQuery}
					<button class="search-clear" onclick={clearSearch} title={$t['browser.clearSelection']}>
						<X size={14} strokeWidth={2} />
					</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if hasSelection}
		<div class="selection-bar">
			<span class="selection-count">
				{$t['browser.selectedCount'].replace('{count}', String(selectedCount))}
			</span>
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

	{#if currentPath === null}
		<!-- Starting view: the user's pinned folders, then the machine's drives. -->
		<div class="roots-view">
			<section class="roots-section">
				<h3 class="section-title">{$t['local.savedFolders']}</h3>
				{#if savedRoots.length === 0}
					<p class="section-empty">{$t['local.noFolders']}</p>
				{:else}
					<div class="file-list">
						{#each savedRoots as root (root.path)}
							<div class="file-entry-row">
								<button class="file-entry is-folder" onclick={() => openFolder(root.path)}>
									<span class="entry-icon folder-icon">
										<FolderOpen size={16} strokeWidth={1.8} />
									</span>
									<span class="entry-name">{root.label}</span>
									<span class="entry-path">{root.path}</span>
								</button>
								<button
									class="remove-btn"
									onclick={() => removeFolder(root.path)}
									title={$t['local.removeFolder']}
								>
									<Trash2 size={14} strokeWidth={1.8} />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<section class="roots-section">
				<h3 class="section-title">{$t['local.roots']}</h3>
				<div class="file-list">
					{#each systemRoots as root (root.path)}
						<div class="file-entry-row">
							<button class="file-entry is-folder" onclick={() => openFolder(root.path)}>
								<span class="entry-icon drive-icon">
									<HardDrive size={16} strokeWidth={1.8} />
								</span>
								<span class="entry-name">{root.label}</span>
								<span class="entry-path">{root.path}</span>
							</button>
							<span class="remove-spacer"></span>
						</div>
					{/each}
				</div>
			</section>
		</div>
	{:else if isLoading || isSearching}
		<div class="loading-state">
			<span class="spinner"></span>
			<span>{isSearching ? $t['browser.searching'] : $t['local.loadingFolder']}</span>
		</div>
	{:else if unavailable}
		<div class="empty-state">
			<div class="empty-icon"><AlertTriangle size={40} strokeWidth={1.2} /></div>
			<p>{$t['local.folderUnavailable']}</p>
			<button class="selection-clear-btn" onclick={goHome}>{$t['local.savedFolders']}</button>
		</div>
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
						onclick={(e) => {
							e.stopPropagation();
							if (!foldersDisabled) toggleSelection(entry);
						}}
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
					</button>
					<button
						class="fav-btn"
						class:is-fav={favoritePaths.has(toDbKey('local', entry.path))}
						onclick={(e) => {
							e.stopPropagation();
							handleToggleFavorite(entry);
						}}
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
							onclick={(e) => {
								e.stopPropagation();
								if (!filesDisabled) toggleSelection(entry);
							}}
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
						{#if watchedPaths.has(toDbKey('local', entry.path))}
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
						class:is-fav={favoritePaths.has(toDbKey('local', entry.path))}
						onclick={(e) => {
							e.stopPropagation();
							handleToggleFavorite(entry);
						}}
					>
						<Heart size={14} strokeWidth={1.8} />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.local-browser {
		display: flex;
		flex-direction: column;
		height: 100%;
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
	}

	.current-path {
		font-size: 0.85rem;
		color: var(--text-secondary);
		font-family: monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.add-folder-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border-radius: 6px;
		background: var(--accent);
		border: none;
		color: var(--bg-primary);
		font-size: 0.8rem;
		font-weight: 600;
		font-family: inherit;
		white-space: nowrap;
		transition: background 0.15s;
	}

	.add-folder-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.add-folder-btn:disabled {
		opacity: 0.7;
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
		font-family: inherit;
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
		font-family: inherit;
		transition: background 0.15s;
	}

	.selection-play-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.selection-play-btn:disabled {
		opacity: 0.7;
	}

	.roots-view {
		display: flex;
		flex-direction: column;
		gap: 24px;
		overflow-y: auto;
	}

	.section-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin-bottom: 8px;
	}

	.section-empty {
		color: var(--text-secondary);
		font-size: 0.85rem;
		padding: 8px 12px;
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
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 60px 20px;
		text-align: center;
		color: var(--text-secondary);
	}

	.empty-icon {
		color: var(--text-muted);
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

	.entry-icon.drive-icon {
		color: var(--text-secondary);
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

	.entry-path {
		color: var(--text-muted);
		font-size: 0.75rem;
		font-family: monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 45%;
	}

	.entry-size {
		color: var(--text-muted);
		font-size: 0.8rem;
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

	.fav-btn,
	.remove-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 36px;
		background: none;
		border: none;
		color: var(--text-muted);
		flex-shrink: 0;
		border-radius: 4px;
		transition: color 0.15s;
		opacity: 0;
	}

	.remove-spacer {
		width: 32px;
		flex-shrink: 0;
	}

	.file-entry-row:hover .fav-btn,
	.file-entry-row:hover .remove-btn {
		opacity: 1;
	}

	.fav-btn:hover,
	.remove-btn:hover {
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
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
