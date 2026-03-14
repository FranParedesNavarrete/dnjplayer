<script lang="ts">
	import { Layers, X, Trash2, Play, Music } from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import { playlist, playlistIndex, playerActive } from '$lib/stores/player-ui';
	import { megaGetWebdavUrl } from '$lib/services/mega-service';
	import { loadVideo } from '$lib/services/player-service';
	import { setProperty } from 'tauri-plugin-libmpv-api';
	import { markWatched } from '$lib/services/db-service';
	import { log } from '$lib/log';
	import { goto } from '$app/navigation';

	async function playItem(index: number) {
		const items = $playlist;
		if (index < 0 || index >= items.length) return;

		const item = items[index];
		playlistIndex.set(index);

		try {
			const url = await megaGetWebdavUrl(item.megaPath);
			await loadVideo(url, item.name);
			await setProperty('pause', 'no');
			markWatched(item.megaPath, item.name).catch((e) =>
				log.warn('[queue] Failed to mark watched:', e)
			);
			goto('/player');
		} catch (e) {
			log.error('[queue] Failed to play item:', e);
		}
	}

	function removeItem(index: number) {
		const items = [...$playlist];
		const currentIdx = $playlistIndex;

		items.splice(index, 1);
		playlist.set(items);

		if (items.length === 0) {
			playlistIndex.set(0);
		} else if (index < currentIdx) {
			playlistIndex.set(currentIdx - 1);
		} else if (index === currentIdx && currentIdx >= items.length) {
			playlistIndex.set(items.length - 1);
		}
	}

	function clearQueue() {
		playlist.set([]);
		playlistIndex.set(0);
	}
</script>

<div class="queue-page">
	<div class="page-header">
		<div class="header-row">
			<div>
				<h2>{$t['queue.title']}</h2>
				<p class="subtitle">{$t['queue.subtitle']}</p>
			</div>
			{#if $playlist.length > 0}
				<button class="clear-btn" onclick={clearQueue}>
					<Trash2 size={14} />
					{$t['queue.clear']}
				</button>
			{/if}
		</div>
	</div>

	{#if $playlist.length === 0}
		<div class="empty-state">
			<div class="empty-icon">
				<Layers size={48} strokeWidth={1.2} />
			</div>
			<h3>{$t['queue.empty']}</h3>
			<p>{$t['queue.emptyHint']}</p>
			<a href="/browse" class="btn-primary">{$t['nav.browse']}</a>
		</div>
	{:else}
		<div class="queue-list">
			{#each $playlist as item, i}
				{@const isCurrent = i === $playlistIndex && $playerActive}
				{@const isPast = i < $playlistIndex && $playerActive}
				<div class="queue-item" class:current={isCurrent} class:past={isPast}>
					<button class="item-play" onclick={() => playItem(i)} title={$t['browser.play']}>
						{#if isCurrent}
							<Music size={16} />
						{:else}
							<Play size={16} />
						{/if}
					</button>
					<div class="item-info">
						<span class="item-index">{i + 1}</span>
						<span class="item-name">{item.name}</span>
						{#if isCurrent}
							<span class="now-playing-badge">{$t['queue.nowPlaying']}</span>
						{/if}
					</div>
					<button
						class="item-remove"
						onclick={() => removeItem(i)}
						title={$t['queue.removeItem']}
					>
						<X size={14} />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.queue-page {
		max-width: 1200px;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.header-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
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

	.clear-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 6px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8rem;
		border: 1px solid var(--border);
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.clear-btn:hover {
		color: var(--danger, #ef4444);
		border-color: var(--danger, #ef4444);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 80px 20px;
		text-align: center;
	}

	.empty-icon {
		color: var(--text-muted);
		margin-bottom: 16px;
	}

	.empty-state h3 {
		font-size: 1.2rem;
		margin-bottom: 8px;
	}

	.empty-state p {
		color: var(--text-secondary);
		margin-bottom: 20px;
	}

	.btn-primary {
		background: var(--accent);
		color: var(--bg-primary);
		padding: 10px 20px;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.9rem;
		transition: background 0.15s;
	}

	.btn-primary:hover {
		background: var(--accent-hover);
	}

	.queue-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.queue-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 6px;
		transition: background 0.15s;
	}

	.queue-item:hover {
		background: var(--bg-hover, var(--bg-tertiary));
	}

	.queue-item.current {
		background: rgba(88, 166, 255, 0.1);
	}

	.queue-item.past {
		opacity: 0.5;
	}

	.item-play {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		background: transparent;
		color: var(--text-secondary);
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.15s;
	}

	.item-play:hover {
		background: var(--bg-tertiary);
		color: var(--accent);
	}

	.queue-item.current .item-play {
		color: var(--accent);
	}

	.item-info {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.item-index {
		color: var(--text-muted);
		font-size: 0.8rem;
		min-width: 20px;
		text-align: right;
	}

	.item-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.9rem;
	}

	.now-playing-badge {
		font-size: 0.7rem;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--accent);
		color: var(--bg-primary);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.item-remove {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 4px;
		background: transparent;
		color: var(--text-muted);
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0;
		transition: all 0.15s;
	}

	.queue-item:hover .item-remove {
		opacity: 1;
	}

	.item-remove:hover {
		background: var(--bg-tertiary);
		color: var(--danger, #ef4444);
	}
</style>
