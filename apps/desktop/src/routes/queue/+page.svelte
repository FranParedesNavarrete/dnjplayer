<script lang="ts">
	import { Layers } from 'lucide-svelte';
	import { t } from '$lib/i18n';
</script>

<div class="queue-page">
	<div class="page-header">
		<h2>{$t['queue.title']}</h2>
		<p class="subtitle">{$t['queue.subtitle']}</p>
	</div>

	<div class="empty-state">
		<div class="empty-icon">
			<Layers size={48} strokeWidth={1.2} />
		</div>
		<h3>{$t['queue.empty']}</h3>
		<p>{$t['queue.emptyHint']}</p>
	</div>
</div>

<style>
	.queue-page {
		max-width: 1200px;
	}

	.page-header {
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
	}
</style>
