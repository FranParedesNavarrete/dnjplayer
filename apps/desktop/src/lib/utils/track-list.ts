// Defensive parsers for mpv's `track-list`, `aid` and `sid`.
//
// Extracted from player-service.ts so they can be unit tested: that module
// imports `tauri-plugin-libmpv-api` at the top level and cannot load under
// Node, which is why ~90 lines of the most defensive code in the player had no
// coverage at all. Same move as utils/source-key.ts.
//
// Everything here is pure and total: mpv's node payloads arrive kebab-cased,
// with most fields optional, booleans that may be real booleans or the strings
// "yes"/"no", and ids that may be numbers or numeric strings. Nothing is
// assumed; anything unusable is dropped rather than turned into a junk track.

import type { MediaTrack } from '$lib/types/player';

/** Coerce mpv's loose booleans ("yes"/"no"/1/0/true) into a real boolean. */
export function asFlag(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') return value === 'yes' || value === 'true' || value === '1';
	return false;
}

/** Non-empty trimmed string, or undefined — mpv omits absent fields, and can send "". */
export function asOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse an `aid`/`sid` value. mpv returns the literal "no" when the stream is
 * disabled and "auto" before a track has been picked, otherwise a track id
 * (which may arrive as a number or as a numeric string).
 */
export function parseTrackId(value: unknown): number | 'no' | null {
	if (value == null) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'boolean') return value ? null : 'no';
	if (typeof value === 'string') {
		if (value === 'no' || value === 'false') return 'no';
		if (value === 'auto' || value === '') return null;
		const parsed = parseInt(value, 10);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

/**
 * Parse mpv's `track-list` node into MediaTrack[]. Entries without a usable
 * numeric `id` or a known `type` are dropped.
 */
export function parseTrackList(raw: unknown): MediaTrack[] {
	// The plugin normally hands over already-decoded JSON, but tolerate a string
	// payload in case a transport ever passes the node through verbatim.
	let value = raw;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) return [];

	const tracks: MediaTrack[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue;
		const rec = entry as Record<string, unknown>;

		const rawType = rec['type'];
		if (rawType !== 'video' && rawType !== 'audio' && rawType !== 'sub') continue;

		const rawId = rec['id'];
		const id = typeof rawId === 'number' ? rawId : parseInt(String(rawId ?? ''), 10);
		if (!Number.isFinite(id)) continue;

		tracks.push({
			id,
			type: rawType,
			title: asOptionalString(rec['title']),
			lang: asOptionalString(rec['lang']),
			codec: asOptionalString(rec['codec']),
			selected: asFlag(rec['selected']),
			// mpv sets `external: true` and fills `external-filename` for sub-add'ed
			// or auto-loaded sidecar files; treat either as external.
			external: asFlag(rec['external']) || asOptionalString(rec['external-filename']) !== undefined,
			default: asFlag(rec['default']),
			forced: asFlag(rec['forced']),
		});
	}
	return tracks;
}
