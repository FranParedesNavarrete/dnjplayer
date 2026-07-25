import { get } from 'svelte/store';
import { playlist } from '$lib/stores/player-ui';
import { megaGetWebdavUrl } from '$lib/services/mega-service';
import { log } from '$lib/log';
import type { PlaylistItem } from '$lib/types/player';

/**
 * Playable-URL resolution for playlist items, with prefetch/cache for Mega.
 *
 * Resolving a Mega chapter's streaming URL (`mega-exec webdav <path>` via
 * MEGAcmd) can take from 0.5s up to a minute. By resolving the next few
 * chapters' URLs in the background while the current one plays, the transition
 * to the next chapter becomes near-instant.
 *
 * The cache is IN-MEMORY only: WebDAV URLs are served by the MEGAcmd server on
 * port 4443 and only stay valid while that server runs. Persisting them across
 * app restarts would yield dead URLs.
 *
 * Local items need none of this: their path IS the playable URL, so resolution
 * is instantaneous and there is nothing to cache or prefetch.
 */

// mega path -> resolved webdav url
const urlCache = new Map<string, string>();
// mega path -> in-flight resolution (dedupes concurrent calls for the same path)
const inFlight = new Map<string, Promise<string>>();

// How many chapters ahead of the current one to keep warm in the cache.
const PREFETCH_AHEAD = 3;

// Generation token used to cancel stale prefetch batches when the user jumps
// around the queue. Each prefetchAround() call bumps it; an in-progress
// sequential batch aborts as soon as it notices the token changed.
let prefetchGeneration = 0;

/**
 * Resolve a playlist item to a URL/path that mpv can open.
 *
 * - `local`: returns `item.path` verbatim and immediately. mpv opens local files
 *   directly, so there is no resolution step, no cache and no prefetch involved.
 * - `mega`: resolves the MEGAcmd WebDAV URL, using the in-memory cache first.
 *   Concurrent calls for the same path share a single resolution.
 */
export async function resolvePlayableUrl(item: PlaylistItem): Promise<string> {
	if (item.source === 'local') return item.path;

	// Cache key for a Mega item is its remote path.
	const remotePath = item.path;
	const cached = urlCache.get(remotePath);
	if (cached) return cached;

	const pending = inFlight.get(remotePath);
	if (pending) return pending;

	const promise = megaGetWebdavUrl(remotePath)
		.then((url) => {
			urlCache.set(remotePath, url);
			return url;
		})
		.catch((e) => {
			// Don't cache failures; allow a later real play to retry fresh.
			invalidate(remotePath);
			throw e;
		})
		.finally(() => {
			inFlight.delete(remotePath);
		});

	inFlight.set(remotePath, promise);
	return promise;
}

/**
 * Kick off background resolution of the next PREFETCH_AHEAD chapters after
 * `currentIndex`. Best-effort and fire-and-forget: failures are swallowed.
 * Local items are skipped: they have nothing to resolve.
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
			// Local paths resolve instantly at play time; nothing to warm up.
			if (item.source === 'local') continue;
			if (urlCache.has(item.path) || inFlight.has(item.path)) continue;

			try {
				await resolvePlayableUrl(item);
			} catch (e) {
				// Best-effort: a failed prefetch will be retried on demand.
				log.warn('[prefetch] Failed to prefetch:', item.path, e);
			}
		}
	})();
}

/**
 * Drop a single cached entry (on prefetch failure or item removal).
 * Takes the cache key, i.e. the Mega remote path. Harmless no-op for local paths.
 */
export function invalidate(remotePath: string): void {
	urlCache.delete(remotePath);
}

/** Clear the entire cache and cancel any in-progress prefetch batch. */
export function clearPrefetchCache(): void {
	prefetchGeneration++;
	urlCache.clear();
	inFlight.clear();
}
