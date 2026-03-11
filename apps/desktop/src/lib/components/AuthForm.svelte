<script lang="ts">
	import { megaLogin, megaCheckStatus } from '$lib/services/mega-service';
	import { isConnected, userEmail, megaError } from '$lib/stores/mega';
	import { Lock } from 'lucide-svelte';

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let errorMsg = $state('');

	async function handleLogin() {
		if (!email || !password) {
			errorMsg = 'Email and password are required';
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			await megaLogin(email, password);
			const status = await megaCheckStatus();
			isConnected.set(status.logged_in);
			userEmail.set(status.email);
			megaError.set(null);
			password = '';
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errorMsg = msg;
			megaError.set(msg);
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleLogin();
	}
</script>

<div class="auth-form">
	<div class="auth-header">
		<div class="auth-icon">
			<Lock size={40} strokeWidth={1.4} />
		</div>
		<h3>Sign in to Mega</h3>
		<p>Enter your Mega.io credentials to access your files.</p>
	</div>

	{#if errorMsg}
		<div class="error-banner">{errorMsg}</div>
	{/if}

	<div class="form-fields">
		<div class="field">
			<label for="mega-email">Email</label>
			<input
				id="mega-email"
				type="email"
				bind:value={email}
				placeholder="your@email.com"
				disabled={loading}
				onkeydown={handleKeydown}
			/>
		</div>
		<div class="field">
			<label for="mega-password">Password</label>
			<input
				id="mega-password"
				type="password"
				bind:value={password}
				placeholder="Password"
				disabled={loading}
				onkeydown={handleKeydown}
			/>
		</div>
	</div>

	<button class="btn-primary" onclick={handleLogin} disabled={loading}>
		{#if loading}
			Connecting...
		{:else}
			Sign In
		{/if}
	</button>

	<p class="auth-note">
		Requires <a href="https://mega.io/cmd" target="_blank" rel="noopener">MEGAcmd</a> installed on your system.
	</p>
</div>

<style>
	.auth-form {
		display: flex;
		flex-direction: column;
		align-items: center;
		max-width: 360px;
		margin: 0 auto;
		padding: 40px 20px;
	}

	.auth-header {
		text-align: center;
		margin-bottom: 24px;
	}

	.auth-icon {
		color: var(--text-muted);
		margin-bottom: 12px;
	}

	.auth-header h3 {
		font-size: 1.3rem;
		font-weight: 600;
		margin-bottom: 6px;
	}

	.auth-header p {
		color: var(--text-secondary);
		font-size: 0.85rem;
	}

	.error-banner {
		width: 100%;
		background: rgba(248, 81, 73, 0.1);
		border: 1px solid var(--danger);
		border-radius: 6px;
		padding: 10px 14px;
		color: var(--danger);
		font-size: 0.85rem;
		margin-bottom: 16px;
	}

	.form-fields {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-bottom: 20px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field label {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.field input {
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 10px 12px;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s;
	}

	.field input:focus {
		border-color: var(--accent);
	}

	.field input:disabled {
		opacity: 0.6;
	}

	.btn-primary {
		width: 100%;
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		padding: 11px 20px;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.9rem;
		transition: background 0.15s;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.auth-note {
		margin-top: 20px;
		font-size: 0.75rem;
		color: var(--text-muted);
		text-align: center;
	}

	.auth-note a {
		color: var(--accent);
	}
</style>
