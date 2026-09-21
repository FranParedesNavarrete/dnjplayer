import { get } from 'svelte/store';
import { playlist } from '$lib/stores/player-ui';
import { megaGetWebdavUrl, megaServerGeneration } from '$lib/services/mega-service';
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
 * Within a single app run the same problem exists in miniature: if MEGAcmd
 * restarts (crash, user quit, machine sleep), every URL already in the cache
 * points at a server that no longer exists, and mpv opens it into a black
 * screen. The Rust side therefore hands out a generation token that is bumped
 * whenever the server is observed to come back up (mega/process.rs); the cache
 * checks it before every hit and wipes itself when it changes. It is a cheap
 * atomic read, not a MEGAcmd round trip.
 *
 * That covers "the server went away and came back". It cannot cover a server
 * that is replaced between two of our observations without ever looking down,
 * so player-service.ts also re-resolves once when mpv reports a load error.
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

// Generation token of the mega-cmd-server instance the cached URLs belong to.
// null = nothing cached yet / not asked yet.
let cachedServerGeneration: number | null = null;

/**
 * Drop every cached URL if the MEGAcmd server has restarted since they were
 * resolved. Best-effort: if the token can't be read (command missing, IPC
 * hiccup) we keep the cache rather than throwing away working URLs — the
 * re-resolve-on-error path in player-service.ts is the backstop.
 */
async function invalidateOnServerRestart(): Promise<void> {
	let generation: number;
	try {
		generation = await megaServerGeneration();
	} catch (e) {
		log.warn('[prefetch] Could not read the MEGAcmd server generation:', e);
		return;
	}

	if (cachedServerGeneration !== null && generation !== cachedServerGeneration) {
		log.info(
			`[prefetch] MEGAcmd restarted (generation ${cachedServerGeneration} -> ${generation}); dropping ${urlCache.size} cached WebDAV URL(s)`
		);
		urlCache.clear();
		// In-flight resolutions were issued against the new server (the command
		// ensures the server is up first), so they are left alone.
	}
	cachedServerGeneration = generation;
}

/**
 * Resolve a playlist item to a URL/path that mpv can open.
 *
 * - `local`: returns `item.path` verbatim and immediately. mpv opens local files
 *   directly, so there is no resolution step, no cache and no prefetch involved.
 * - `mega`: resolves the MEGAcmd WebDAV URL, using the in-memory cache first
 *   (after checking the cache is still valid for the running server).
 *   Concurrent calls for the same path share a single resolution.
 */
export async function resolvePlayableUrl(item: PlaylistItem): Promise<string> {
	if (item.source === 'local') return item.path;

	// Cache key for a Mega item is its remote path.
	const remotePath = item.path;
	await invalidateOnServerRestart();
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
	// Keep `cachedServerGeneration`: it describes which server we last talked to,
	// not what is in the cache, and forgetting it would skip the first restart
	// check after every queue change.
}
