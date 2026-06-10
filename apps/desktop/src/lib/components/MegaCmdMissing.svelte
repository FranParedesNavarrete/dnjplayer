<script lang="ts">
	import { Download, RefreshCw, PackageOpen } from 'lucide-svelte';
	import { megaCheckStatus, megaOpenInstallPage } from '$lib/services/mega-service';
	import { isConnected, userEmail, megaInstalled } from '$lib/stores/mega';
	import { t } from '$lib/i18n';

	let opening = $state(false);
	let rechecking = $state(false);

	async function install() {
		opening = true;
		try {
			await megaOpenInstallPage();
		} finally {
			opening = false;
		}
	}

	async function recheck() {
		rechecking = true;
		try {
			const status = await megaCheckStatus();
			megaInstalled.set(status.installed);
			isConnected.set(status.logged_in);
			if (status.email) userEmail.set(status.email);
		} catch {
			megaInstalled.set(false);
		} finally {
			rechecking = false;
		}
	}
</script>

<div class="megacmd-missing">
	<div class="icon">
		<PackageOpen size={44} strokeWidth={1.3} />
	</div>
	<h3>{$t['megacmd.title']}</h3>
	<p>{$t['megacmd.body']}</p>
	<div class="actions">
		<button class="btn-primary" onclick={install} disabled={opening}>
			<Download size={16} strokeWidth={2} />
			{$t['megacmd.install']}
		</button>
		<button class="btn-secondary" onclick={recheck} disabled={rechecking}>
			<RefreshCw size={15} strokeWidth={2} />
			{rechecking ? $t['megacmd.checking'] : $t['megacmd.recheck']}
		</button>
	</div>
	<p class="hint">{$t['megacmd.hint']}</p>
</div>

<style>
	.megacmd-missing {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		max-width: 440px;
		margin: 0 auto;
		padding: 48px 20px;
	}

	.icon {
		color: var(--text-muted);
		margin-bottom: 16px;
	}

	h3 {
		font-size: 1.3rem;
		font-weight: 600;
		margin-bottom: 8px;
	}

	p {
		color: var(--text-secondary);
		font-size: 0.9rem;
		line-height: 1.5;
		margin-bottom: 20px;
	}

	.actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.btn-primary,
	.btn-secondary {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 10px 18px;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.88rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-primary {
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-secondary {
		background: transparent;
		color: var(--text-secondary);
		border: 1px solid var(--border);
	}

	.btn-secondary:hover:not(:disabled) {
		color: var(--text-primary);
		border-color: var(--text-secondary);
	}

	.btn-primary:disabled,
	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.hint {
		margin-top: 18px;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
</style>
