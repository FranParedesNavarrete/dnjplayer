import { get } from 'svelte/store';
import { playlist } from '$lib/stores/player-ui';
import { megaGetWebdavUrl } from '$lib/services/mega-service';
import { log } from '$lib/log';

/**
 * Prefetch / cache service for playlist (chapter) WebDAV URLs.
 *
 * Resolving a chapter's streaming URL (`mega-exec webdav <path>` via MEGAcmd) can
 * take from 0.5s up to a minute. By resolving the next few chapters' URLs in the
 * background while the current one plays, the transition to the next chapter
 * becomes near-instant.
 *
 * The cache is IN-MEMORY only: WebDAV URLs are served by the MEGAcmd server on
 * port 4443 and only stay valid while that server runs. Persisting them across
 * app restarts would yield dead URLs.
 */

// megaPath -> resolved webdav url
const urlCache = new Map<string, string>();
// megaPath -> in-flight resolution (dedupes concurrent calls for the same path)
const inFlight = new Map<string, Promise<string>>();

// How many chapters ahead of the current one to keep warm in the cache.
const PREFETCH_AHEAD = 3;

// Generation token used to cancel stale prefetch batches when the user jumps
// around the queue. Each prefetchAround() call bumps it; an in-progress
// sequential batch aborts as soon as it notices the token changed.
let prefetchGeneration = 0;

/**
 * Resolve a chapter's WebDAV URL, using the cache first. Concurrent calls for the
 * same path share a single resolution.
 */
export async function getCachedWebdavUrl(megaPath: string): Promise<string> {
	const cached = urlCache.get(megaPath);
	if (cached) return cached;

	const pending = inFlight.get(megaPath);
	if (pending) return pending;

	const promise = megaGetWebdavUrl(megaPath)
		.then((url) => {
			urlCache.set(megaPath, url);
			return url;
		})
		.catch((e) => {
			// Don't cache failures; allow a later real play to retry fresh.
			invalidate(megaPath);
			throw e;
		})
		.finally(() => {
			inFlight.delete(megaPath);
		});

	inFlight.set(megaPath, promise);
	return promise;
}

/**
 * Kick off background resolution of the next PREFETCH_AHEAD chapters after
 * `currentIndex`. Best-effort and fire-and-forget: failures are swallowed.
 *
 * Resolves sequentially because the MEGAcmd WebDAV serve is effectively
 * single-threaded per server; parallel spawns would contend with the foreground
 * transition and slow it down.
 */
export function prefetchAround(currentIndex: number): void {
	const gen = ++prefetchGeneration;
	const items = get(playlist);

	void (async () => {
		const start = currentIndex + 1;
		const end = Math.min(items.length, start + PREFETCH_AHEAD);
		for (let i = start; i < end; i++) {
			// Abort if a newer prefetch batch (or a jump) superseded this one.
			if (gen !== prefetchGeneration) return;

			const item = items[i];
			if (!item) continue;
			if (urlCache.has(item.megaPath) || inFlight.has(item.megaPath)) continue;

			try {
				await getCachedWebdavUrl(item.megaPath);
			} catch (e) {
				// Best-effort: a failed prefetch will be retried on demand.
				log.warn('[prefetch] Failed to prefetch:', item.megaPath, e);
			}
		}
	})();
}

/** Drop a single cached entry (on prefetch failure or item removal). */
export function invalidate(megaPath: string): void {
	urlCache.delete(megaPath);
}

/** Clear the entire cache and cancel any in-progress prefetch batch. */
export function clearPrefetchCache(): void {
	prefetchGeneration++;
	urlCache.clear();
	inFlight.clear();
}
