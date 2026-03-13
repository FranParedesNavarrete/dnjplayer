import { invoke } from '@tauri-apps/api/core';
import type { MegaEntry, MegaStatus, MegaShare } from '$lib/types/mega';

export async function megaCheckStatus(): Promise<MegaStatus> {
	return invoke('mega_check_status');
}

export async function megaEnsureServer(): Promise<void> {
	return invoke('mega_ensure_server');
}

export async function megaLogin(email: string, password: string): Promise<string> {
	return invoke('mega_login', { email, password });
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

