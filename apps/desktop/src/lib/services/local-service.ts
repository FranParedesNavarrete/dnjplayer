import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { FsEntry } from '$lib/types/mega';

/** A browsable starting point: a drive letter, a mounted volume or the home folder. */
export interface LocalRoot {
	path: string;
	label: string;
}

/** List the direct children of `path`: folders first, then natural order. */
export async function localListDir(path: string): Promise<FsEntry[]> {
	return invoke('local_list_dir', { path });
}

/** Drives/volumes plus the home folder of this machine. */
export async function localListRoots(): Promise<LocalRoot[]> {
	return invoke('local_list_roots');
}

/**
 * Video files directly inside `path`, in natural order. Non-recursive: it builds
 * the playback queue for the folder being browsed.
 */
export async function localScanFolder(path: string): Promise<FsEntry[]> {
	return invoke('local_scan_folder', { path });
}

/**
 * Recursively search `roots` for folders and video files whose name contains
 * `query` (case-insensitive). Capped at 4 levels deep and 300 results.
 */
export async function localSearch(query: string, roots: string[]): Promise<FsEntry[]> {
	return invoke('local_search', { query, roots });
}

/** Native folder picker. Returns the chosen absolute path, or null if cancelled. */
export async function localPickFolder(): Promise<string | null> {
	return first(await open({ directory: true, multiple: false }));
}

/** Native subtitle-file picker. Returns the absolute path, or null if cancelled. */
export async function localPickSubtitle(): Promise<string | null> {
	return first(
		await open({
			multiple: false,
			filters: [{ name: 'Subtitles', extensions: ['srt', 'ass', 'ssa', 'vtt', 'sub'] }]
		})
	);
}

/** `open()` is typed as `string | string[] | null` even with `multiple: false`. */
function first(selection: string | string[] | null): string | null {
	if (selection === null) return null;
	return Array.isArray(selection) ? (selection[0] ?? null) : selection;
}
