// Human-readable labels for mpv media tracks.
//
// mpv reports track languages as ISO 639-2/B three-letter codes (`jpn`, `eng`,
// `spa`, …) because that is what Matroska stores. `Intl.DisplayNames` expects
// BCP-47 tags instead: given a three-letter code it may echo the input back
// unchanged, return undefined, or throw a RangeError depending on the engine.
// So we map the codes we care about down to their two-letter equivalents first
// and always guard the call, falling back to the upper-cased raw code.

import type { MediaTrack } from '$lib/types/player';

/** ISO 639-2/B (and a few 639-2/T variants mpv can emit) -> ISO 639-1. */
const ISO_639_2_TO_1: Record<string, string> = {
	jpn: 'ja',
	eng: 'en',
	spa: 'es',
	cat: 'ca',
	fre: 'fr',
	fra: 'fr',
	ger: 'de',
	deu: 'de',
	ita: 'it',
	por: 'pt',
	kor: 'ko',
	chi: 'zh',
	zho: 'zh',
	rus: 'ru',
	dut: 'nl',
	nld: 'nl',
	pol: 'pl',
	swe: 'sv',
	nor: 'no',
	dan: 'da',
	fin: 'fi',
	tur: 'tr',
	ara: 'ar',
	hin: 'hi',
	heb: 'he',
	ell: 'el',
	gre: 'el',
	ces: 'cs',
	cze: 'cs',
	hun: 'hu',
	ron: 'ro',
	rum: 'ro',
	ukr: 'uk',
	tha: 'th',
	vie: 'vi',
	ind: 'id',
	glg: 'gl',
	eus: 'eu',
	baq: 'eu',
};

/** Codes that carry no information — treat them as "no language". */
const UNKNOWN_CODES = new Set(['und', 'undefined', 'unknown', 'mis', 'zxx', '']);

/**
 * Resolve a track language code to a name in `locale`, e.g. ('jpn', 'es') ->
 * "japonés". Returns the upper-cased code when the language can't be resolved,
 * or null when there is no usable code at all.
 */
export function languageName(code: string | null | undefined, locale = 'en'): string | null {
	if (!code) return null;
	const raw = code.trim();
	const lower = raw.toLowerCase();
	if (UNKNOWN_CODES.has(lower)) return null;

	// Codes can arrive region-qualified (`pt-BR`, `zh_Hant`); only the primary
	// subtag needs the 3 -> 2 letter mapping.
	const [primary, ...rest] = lower.split(/[-_]/);
	const tag = [ISO_639_2_TO_1[primary] ?? primary, ...rest].join('-');

	try {
		const display = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' });
		const name = display.of(tag);
		// `fallback: 'none'` yields undefined for unknown tags, but some engines
		// still echo the tag back — count that as unresolved too.
		if (name && name.toLowerCase() !== tag.toLowerCase()) {
			return name.charAt(0).toUpperCase() + name.slice(1);
		}
	} catch {
		// RangeError: structurally invalid tag. Fall through to the raw code.
	}

	return raw.toUpperCase();
}

/**
 * Build the label shown for a track in a <select>. Combines the readable
 * language with the track title, falls back to `unnamedTemplate` (an i18n
 * string containing `{n}`) and flags externally loaded tracks.
 */
export function trackLabel(track: MediaTrack, locale: string, unnamedTemplate: string): string {
	const lang = languageName(track.lang, locale);
	const title = track.title?.trim();

	const parts: string[] = [];
	if (lang) parts.push(lang);
	// Avoid "Japanese · Japanese" when the title just repeats the language.
	if (title && title.toLowerCase() !== lang?.toLowerCase()) parts.push(title);

	let label = parts.join(' · ');
	if (!label) label = unnamedTemplate.replace('{n}', String(track.id));

	if (track.forced) label += ' [forced]';
	if (track.external) label += ' [ext]';
	return label;
}
