<script lang="ts">
	import { goto } from '$app/navigation';
	import { megaListFiles, megaGetWebdavUrl, megaListShares } from '$lib/services/mega-service';
	import { loadVideo } from '$lib/services/player-service';
	import { log } from '$lib/log';
	import { currentPath, entries, isLoading, megaError } from '$lib/stores/mega';
	import type { MegaEntry } from '$lib/types/mega';
	import type { MegaShare } from '$lib/types/mega';
	import { Folder, Film, Music, Image, FileText, File, ArrowUp, Search, HardDrive, Users } from 'lucide-svelte';
	import { t } from '$lib/i18n';

	const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.webm', '.mov', '.flv', '.wmv', '.m4v', '.ts'];

	type SectionId = 'cloud' | 'shared';

	const SECTIONS: { id: SectionId; labelKey: string; icon: typeof HardDrive }[] = [
		{ id: 'cloud', labelKey: 'browser.cloudDrive', icon: HardDrive },
		{ id: 'shared', labelKey: 'browser.sharedItems', icon: Users },
	];

	let searchQuery = $state('');
	let error = $state('');
	let activeTab = $state<SectionId>('cloud');
	let shares = $state<MegaShare[]>([]);

	// Determine if we're browsing inside a share (path starts with //from/)
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

	function navigateToFolder(entry: MegaEntry) {
		currentPath.set(entry.path);
	}

	function navigateToShare(share: MegaShare) {
		currentPath.set(share.path);
	}

	function navigateUp() {
		const path = $currentPath;
		if (activeTab === 'cloud' && path === '/') return;
		if (isInsideShare) {
			// If at share root (//from/user:Folder), go back to shares list
			const afterFrom = path.replace('//from/', '');
			if (!afterFrom.includes('/')) {
				// At share root level, switch back to shares list
				activeTab = 'shared';
				currentPath.set('/');
				return;
			}
		}
		const parent = path.replace(/\/[^/]+\/?$/, '') || '/';
		currentPath.set(parent);
	}

	function switchTab(tab: SectionId) {
		activeTab = tab;
		if (tab === 'cloud') {
			currentPath.set('/');
		}
	}

	function isVideo(name: string): boolean {
		const lower = name.toLowerCase();
		return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
	}

	function isAudio(name: string): boolean {
		return /\.(mp3|flac|ogg|wav|aac|m4a)$/i.test(name);
	}

	function isImage(name: string): boolean {
		return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
	}

	function isSubtitle(name: string): boolean {
		return /\.(srt|ass|ssa|vtt|sub)$/i.test(name);
	}

	async function playVideo(entry: MegaEntry) {
		try {
			log.info('[FileBrowser] Getting WebDAV URL for:', entry.path);
			const url = await megaGetWebdavUrl(entry.path);
			log.info('[FileBrowser] WebDAV URL:', url);
			log.info('[FileBrowser] Calling loadVideo...');
			await loadVideo(url, entry.name);
			log.info('[FileBrowser] loadVideo completed, navigating to /player');
			goto('/player');
		} catch (e) {
			log.error('[FileBrowser] playVideo failed:', e);
			error = e instanceof Error ? e.message : String(e);
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

	let filteredEntries = $derived(
		searchQuery
			? $entries.filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
			: $entries
	);

	let folders = $derived(filteredEntries.filter((e) => e.entry_type === 'folder'));
	let files = $derived(filteredEntries.filter((e) => e.entry_type === 'file'));
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
				{#if activeTab === 'shared' && !isInsideShare}
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
				placeholder={$t['browser.filter']}
				bind:value={searchQuery}
			/>
		</div>
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if $isLoading}
		<div class="loading-state">
			<span class="spinner"></span>
			<span>{$t['browser.loading']}</span>
		</div>
	{:else if activeTab === 'shared' && !isInsideShare}
		<!-- Shares list view -->
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
	{:else if filteredEntries.length === 0}
		<div class="empty-state">
			<p>{$t['browser.noFiles']}</p>
		</div>
	{:else}
		<div class="file-list">
			{#each folders as entry (entry.path)}
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
			{/each}
			{#each files as entry (entry.path)}
				<button
					class="file-entry"
					class:is-video={isVideo(entry.name)}
					onclick={() => handleEntryClick(entry)}
					onkeydown={(e) => handleEntryKeydown(e, entry)}
				>
					<span class="entry-icon" class:video-icon={isVideo(entry.name)}>
						{#if isVideo(entry.name)}
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
					<span class="entry-size">{entry.size}</span>
					{#if isVideo(entry.name)}
						<span class="play-badge">{$t['browser.play']}</span>
					{/if}
				</button>
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
		padding: 7px 12px 7px 30px;
		color: var(--text-primary);
		font-size: 0.85rem;
		font-family: inherit;
		outline: none;
		width: 200px;
		transition: border-color 0.15s;
	}

	.search-bar input:focus {
		border-color: var(--accent);
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
		width: 100%;
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
</style>
