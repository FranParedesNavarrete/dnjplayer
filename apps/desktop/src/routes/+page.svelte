<script lang="ts">
	import { Clapperboard } from 'lucide-svelte';
</script>

<div class="library-page">
	<div class="page-header">
		<h2>Library</h2>
		<p class="subtitle">Your recently played and pre-processed content</p>
	</div>

	<div class="empty-state">
		<div class="empty-icon">
			<Clapperboard size={48} strokeWidth={1.2} />
		</div>
		<h3>No content yet</h3>
		<p>Browse your Mega storage and play a video to get started.</p>
		<a href="/browse" class="btn-primary">Browse Mega</a>
	</div>
</div>

<style>
	.library-page {
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
</style>
