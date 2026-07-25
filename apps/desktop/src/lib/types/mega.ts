/**
 * A filesystem-like entry, source-neutral: the same shape describes a Mega
 * remote entry and a local filesystem entry.
 *
 * `size` is a STRING already formatted by the Rust side (`format_size()`),
 * not a number of bytes.
 */
export interface FsEntry {
	name: string;
	path: string;
	size: string;
	entry_type: 'file' | 'folder';
}

/** @deprecated Alias kept for existing callers; prefer {@link FsEntry}. */
export type MegaEntry = FsEntry;

export interface MegaUser {
	email: string;
	name: string;
}

export interface MegaStatus {
	installed: boolean;
	server_running: boolean;
	logged_in: boolean;
	email: string | null;
}

export interface MegaShare {
	name: string;
	path: string;
	owner: string;
	access: string;
}
