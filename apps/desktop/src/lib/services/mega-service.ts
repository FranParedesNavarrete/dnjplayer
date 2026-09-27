import { invoke } from '@tauri-apps/api/core';
import type { MegaEntry, MegaStatus, MegaShare } from '$lib/types/mega';

export async function megaCheckStatus(): Promise<MegaStatus> {
	return invoke('mega_check_status');
}

export async function megaEnsureServer(): Promise<void> {
	return invoke('mega_ensure_server');
}

/** Outcome of a login attempt. `twoFactorRequired` is not a failure. */
export interface LoginOutcome {
	twoFactorRequired: boolean;
}

/**
 * Log in, optionally with a multifactor code.
 *
 * Whether the account has MFA on cannot be asked first — MEGA does not tell
 * anyone holding only an email address — so the flow is: try, and if the
 * backend reports `twoFactorRequired`, collect a code and call this again with
 * the SAME email and password plus `authCode`.
 */
export async function megaLogin(
	email: string,
	password: string,
	authCode?: string
): Promise<LoginOutcome> {
	return invoke('mega_login', { email, password, authCode: authCode ?? null });
}

export async function megaLogout(): Promise<string> {
	return invoke('mega_logout');
}

export async function megaListFiles(path: string): Promise<MegaEntry[]> {
	return invoke('mega_list_files', { path });
}

export async function megaListShares(): Promise<MegaShare[]> {
	return invoke('mega_list_shares');
}

export async function megaGetWebdavUrl(remotePath: string): Promise<string> {
	return invoke('mega_get_webdav_url', { remotePath });
}

/**
 * Identity token of the mega-cmd-server instance currently running: bumped every
 * time the server is observed to come back up. WebDAV URLs only stay valid for
 * the server instance that minted them, so the prefetch cache compares this
 * value and drops everything when it changes. Cheap (an atomic read on the Rust
 * side, no MEGAcmd round trip).
 */
export async function megaServerGeneration(): Promise<number> {
	return invoke('mega_server_generation');
}

/**
 * Recursively search the given roots for nodes whose name matches `query`.
 * `roots` is the list of starting paths: `['/']` for the cloud drive, or one
 * entry per incoming share for the shared section.
 */
export async function megaSearch(query: string, roots: string[]): Promise<MegaEntry[]> {
	return invoke('mega_search', { query, roots });
}

/** Open the official MEGAcmd download page (auto-detects OS) in the browser. */
export async function megaOpenInstallPage(): Promise<void> {
	return invoke('mega_open_install_page');
}

