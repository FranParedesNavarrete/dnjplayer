import { writable } from 'svelte/store';

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'uptodate';

export interface UpdateInfo {
	version: string;
	currentVersion: string;
	notes: string;
}

/** Metadata of an available update (null when none is pending). */
export const availableUpdate = writable<UpdateInfo | null>(null);

/** Current phase of the update flow, drives the UI. */
export const updatePhase = writable<UpdatePhase>('idle');

/** Download progress 0–100 while phase === 'downloading'. */
export const updateProgress = writable<number>(0);

/** Last error message, if any. */
export const updateError = writable<string | null>(null);
