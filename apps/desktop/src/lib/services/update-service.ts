import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { get } from 'svelte/store';
import {
	availableUpdate,
	updatePhase,
	updateProgress,
	updateError
} from '$lib/stores/update';
import { log } from '$lib/log';

// Holds the pending Update handle between check and install.
let pending: Update | null = null;

/**
 * Check GitHub releases for a newer signed build.
 *
 * @param silent when true, a "no update / network error" outcome is swallowed
 *   (used for the automatic check on startup). When false, the phase reflects
 *   the result so the UI can show "up to date" / errors (manual check).
 * @returns true if an update is available.
 */
export async function checkForUpdates(silent = false): Promise<boolean> {
	updateError.set(null);
	updatePhase.set('checking');
	try {
		const update = await check();
		if (update) {
			pending = update;
			availableUpdate.set({
				version: update.version,
				currentVersion: update.currentVersion,
				notes: update.body ?? ''
			});
			updatePhase.set('available');
			log.info('[update] Update available:', update.version);
			return true;
		}
		pending = null;
		availableUpdate.set(null);
		updatePhase.set(silent ? 'idle' : 'uptodate');
		return false;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		log.warn('[update] Check failed:', msg);
		if (silent) {
			updatePhase.set('idle');
		} else {
			updateError.set(msg);
			updatePhase.set('error');
		}
		return false;
	}
}

/**
 * Download and install the pending update, reporting progress, then relaunch
 * the app. On success the process restarts and this never returns.
 */
export async function downloadAndInstallUpdate(): Promise<void> {
	if (!pending) {
		// Re-check in case the handle was lost (e.g. after an error).
		const has = await checkForUpdates(false);
		if (!has || !pending) return;
	}
	const update = pending;
	if (!update) return;

	updateError.set(null);
	updateProgress.set(0);
	updatePhase.set('downloading');

	let downloaded = 0;
	let total = 0;
	try {
		await update.downloadAndInstall((event) => {
			switch (event.event) {
				case 'Started':
					total = event.data.contentLength ?? 0;
					break;
				case 'Progress':
					downloaded += event.data.chunkLength;
					if (total > 0) {
						updateProgress.set(Math.min(100, Math.round((downloaded / total) * 100)));
					}
					break;
				case 'Finished':
					updateProgress.set(100);
					break;
			}
		});
		updatePhase.set('ready');
		log.info('[update] Installed, relaunching...');
		await relaunch();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		log.error('[update] Install failed:', msg);
		updateError.set(msg);
		updatePhase.set('error');
	}
}

/** Dismiss the available-update prompt without installing. */
export function dismissUpdate(): void {
	if (get(updatePhase) === 'downloading') return; // don't interrupt a download
	availableUpdate.set(null);
	updatePhase.set('idle');
}
