<script lang="ts">
	import { megaLogin, megaCheckStatus } from '$lib/services/mega-service';
	import { isConnected, userEmail, megaError } from '$lib/stores/mega';
	import { Lock, ShieldCheck } from 'lucide-svelte';
	import { t } from '$lib/i18n';

	/** MEGA uses standard 6-digit TOTP (`--auth-code=XXXXXX` in MEGAcmd). */
	const CODE_LENGTH = 6;

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let errorMsg = $state('');

	// Whether the account has multifactor enabled cannot be asked up front: MEGA
	// does not tell anyone holding only an email address. So the form asks for
	// credentials, and moves to this step only if the backend reports that
	// MEGAcmd asked for a code.
	let step = $state<'credentials' | 'code'>('credentials');
	let digits = $state<string[]>(Array(CODE_LENGTH).fill(''));
	let boxes: HTMLInputElement[] = [];
	let code = $derived(digits.join(''));

	async function finishLogin() {
		const status = await megaCheckStatus();
		isConnected.set(status.logged_in);
		userEmail.set(status.email);
		megaError.set(null);
		// The password is only held for as long as the two-step flow needs it.
		password = '';
		digits = Array(CODE_LENGTH).fill('');
		step = 'credentials';
	}

	function reportError(e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		errorMsg = msg;
		megaError.set(msg);
	}

	async function handleLogin() {
		if (!email || !password) {
			errorMsg = $t['auth.required'];
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			const outcome = await megaLogin(email, password);
			if (outcome.twoFactorRequired) {
				step = 'code';
				// Wait for the boxes to exist before reaching for one.
				queueMicrotask(() => boxes[0]?.focus());
				return;
			}
			await finishLogin();
		} catch (e) {
			reportError(e);
		} finally {
			loading = false;
		}
	}

	async function submitCode() {
		if (code.length < CODE_LENGTH) {
			errorMsg = $t['auth.twoFactorIncomplete'];
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			// Same credentials, now with the code: MEGAcmd takes all three at once.
			await megaLogin(email, password, code);
			await finishLogin();
		} catch (e) {
			reportError(e);
			// A rejected code is the common case here, and re-typing over six
			// half-filled boxes is worse than starting clean.
			digits = Array(CODE_LENGTH).fill('');
			queueMicrotask(() => boxes[0]?.focus());
		} finally {
			loading = false;
		}
	}

	function backToCredentials() {
		step = 'credentials';
		digits = Array(CODE_LENGTH).fill('');
		errorMsg = '';
		password = '';
	}

	function handleDigitInput(index: number, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		// Take the LAST character typed: typing into a full box should replace it
		// rather than be ignored.
		const digit = input.value.replace(/\D/g, '').slice(-1);
		digits[index] = digit;
		input.value = digit;
		if (digit && index < CODE_LENGTH - 1) boxes[index + 1]?.focus();
		if (digit && index === CODE_LENGTH - 1 && digits.every(Boolean)) void submitCode();
	}

	function handleDigitKeydown(index: number, e: KeyboardEvent) {
		if (e.key === 'Backspace' && !digits[index] && index > 0) {
			// Empty box: step back and clear the one behind, which is what every
			// code field does and what the hand expects.
			e.preventDefault();
			digits[index - 1] = '';
			boxes[index - 1]?.focus();
		} else if (e.key === 'ArrowLeft' && index > 0) {
			e.preventDefault();
			boxes[index - 1]?.focus();
		} else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
			e.preventDefault();
			boxes[index + 1]?.focus();
		} else if (e.key === 'Enter') {
			void submitCode();
		}
	}

	function handleDigitPaste(e: ClipboardEvent) {
		// Authenticator apps copy as "123456" or "123 456"; either should just work
		// instead of landing six characters in the first box.
		const pasted = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
		if (!pasted) return;
		e.preventDefault();
		const next = Array(CODE_LENGTH).fill('');
		for (let i = 0; i < Math.min(pasted.length, CODE_LENGTH); i++) next[i] = pasted[i];
		digits = next;
		const lastFilled = Math.min(pasted.length, CODE_LENGTH) - 1;
		boxes[lastFilled]?.focus();
		if (next.every(Boolean)) void submitCode();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleLogin();
	}
</script>

<div class="auth-form">
	<div class="auth-header">
		<div class="auth-icon">
			{#if step === 'code'}
				<ShieldCheck size={40} strokeWidth={1.4} />
			{:else}
				<Lock size={40} strokeWidth={1.4} />
			{/if}
		</div>
		<h3>{step === 'code' ? $t['auth.twoFactorTitle'] : $t['auth.title']}</h3>
		<p>{step === 'code' ? $t['auth.twoFactorHint'] : $t['auth.subtitle']}</p>
	</div>

	{#if errorMsg}
		<div class="error-banner">{errorMsg}</div>
	{/if}

	{#if step === 'code'}
		<!-- One input per digit. `inputmode="numeric"` so a touch keyboard comes up
		     as a keypad, and paste is handled on the group rather than per box. -->
		<div class="code-boxes" onpaste={handleDigitPaste}>
			{#each digits as digit, i (i)}
				<input
					bind:this={boxes[i]}
					class="code-box"
					type="text"
					inputmode="numeric"
					autocomplete="one-time-code"
					maxlength="1"
					value={digit}
					aria-label={`${$t['auth.twoFactorTitle']} ${i + 1}/${digits.length}`}
					disabled={loading}
					oninput={(e) => handleDigitInput(i, e)}
					onkeydown={(e) => handleDigitKeydown(i, e)}
				/>
			{/each}
		</div>

		<button class="btn-primary" onclick={submitCode} disabled={loading}>
			{#if loading}
				{$t['auth.twoFactorVerifying']}
			{:else}
				{$t['auth.twoFactorVerify']}
			{/if}
		</button>

		<button class="btn-link" onclick={backToCredentials} disabled={loading}>
			{$t['auth.twoFactorBack']}
		</button>
	{:else}
		<div class="form-fields">
			<div class="field">
				<label for="mega-email">{$t['auth.email']}</label>
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
				<label for="mega-password">{$t['auth.password']}</label>
				<input
					id="mega-password"
					type="password"
					bind:value={password}
					placeholder={$t['auth.password']}
					disabled={loading}
					onkeydown={handleKeydown}
				/>
			</div>
		</div>

		<button class="btn-primary" onclick={handleLogin} disabled={loading}>
			{#if loading}
				{$t['auth.connecting']}
			{:else}
				{$t['auth.signIn']}
			{/if}
		</button>

		<p class="auth-note">
			{$t['auth.megacmdNote']}
		</p>
	{/if}
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

	.code-boxes {
		display: flex;
		gap: 8px;
		margin-bottom: 20px;
	}

	.code-box {
		width: 44px;
		height: 54px;
		text-align: center;
		font-size: 1.4rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text-primary);
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s;
	}

	.code-box:focus {
		border-color: var(--accent);
	}

	.code-box:disabled {
		opacity: 0.6;
	}

	.btn-link {
		margin-top: 14px;
		background: none;
		border: none;
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-family: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	.btn-link:hover:not(:disabled) {
		color: var(--text-primary);
	}

	.btn-link:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.auth-note {
		margin-top: 20px;
		font-size: 0.75rem;
		color: var(--text-muted);
		text-align: center;
	}
</style>
