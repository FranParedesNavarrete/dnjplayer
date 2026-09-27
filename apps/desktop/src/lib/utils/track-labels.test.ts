import { describe, expect, it } from 'vitest';
import type { MediaTrack } from '$lib/types/player';
import { languageName, trackLabel } from './track-labels';

// These rely on Node's full-ICU build (the default since Node 13), which is
// what CI and every developer machine run.
describe('languageName', () => {
	it('maps ISO 639-2 codes to readable English names', () => {
		expect(languageName('jpn')).toBe('Japanese');
		expect(languageName('eng')).toBe('English');
		expect(languageName('spa')).toBe('Spanish');
	});

	it('localises the name and capitalises it', () => {
		// Intl returns lower-case "japonés" in Spanish; the UI wants "Japonés".
		expect(languageName('jpn', 'es')).toBe('Japonés');
		expect(languageName('eng', 'es')).toBe('Inglés');
	});

	it('accepts two-letter and region-qualified codes', () => {
		expect(languageName('ja')).toBe('Japanese');
		expect(languageName('pt-BR')).toBe('Brazilian Portuguese');
		expect(languageName('por_BR')).toBe('Brazilian Portuguese');
	});

	it('returns null for "no language" codes and empty input', () => {
		expect(languageName('und')).toBeNull();
		expect(languageName('UND')).toBeNull();
		expect(languageName('mis')).toBeNull();
		expect(languageName('zxx')).toBeNull();
		expect(languageName('')).toBeNull();
		expect(languageName(null)).toBeNull();
		expect(languageName(undefined)).toBeNull();
	});

	it('falls back to the upper-cased raw code when unresolvable', () => {
		// Well-formed but unknown tag -> Intl yields undefined (fallback: none).
		expect(languageName('qqq')).toBe('QQQ');
		// Structurally invalid tag -> Intl throws RangeError; must not propagate.
		expect(languageName('xx!')).toBe('XX!');
		expect(languageName('1234567890')).toBe('1234567890');
	});

	it('trims surrounding whitespace', () => {
		expect(languageName('  jpn ')).toBe('Japanese');
	});
});

function track(overrides: Partial<MediaTrack> = {}): MediaTrack {
	return {
		id: 2,
		type: 'audio',
		selected: false,
		external: false,
		default: false,
		forced: false,
		...overrides,
	};
}

const UNNAMED = 'Track {n}';

describe('trackLabel', () => {
	it('uses the language alone when there is no title', () => {
		expect(trackLabel(track({ lang: 'jpn' }), 'en', UNNAMED)).toBe('Japanese');
	});

	it('joins language and title with a middle dot', () => {
		expect(trackLabel(track({ lang: 'eng', title: 'Commentary' }), 'en', UNNAMED)).toBe(
			'English · Commentary'
		);
	});

	it('uses only the title when there is no language', () => {
		expect(trackLabel(track({ title: 'Signs & Songs' }), 'en', UNNAMED)).toBe('Signs & Songs');
		expect(trackLabel(track({ lang: 'und', title: 'Signs' }), 'en', UNNAMED)).toBe('Signs');
	});

	it('does not repeat a title that equals the language', () => {
		expect(trackLabel(track({ lang: 'jpn', title: 'japanese' }), 'en', UNNAMED)).toBe('Japanese');
	});

	it('trims blank titles', () => {
		expect(trackLabel(track({ lang: 'spa', title: '   ' }), 'en', UNNAMED)).toBe('Spanish');
	});

	it('falls back to the numbered template when nothing is known', () => {
		expect(trackLabel(track({ id: 3 }), 'en', UNNAMED)).toBe('Track 3');
		expect(trackLabel(track({ id: 3, lang: 'und' }), 'en', 'Pista {n}')).toBe('Pista 3');
	});

	it('flags forced and external tracks, in that order', () => {
		expect(trackLabel(track({ lang: 'eng', forced: true }), 'en', UNNAMED)).toBe('English [forced]');
		expect(trackLabel(track({ lang: 'eng', external: true }), 'en', UNNAMED)).toBe('English [ext]');
		expect(trackLabel(track({ lang: 'eng', forced: true, external: true }), 'en', UNNAMED)).toBe(
			'English [forced] [ext]'
		);
		expect(trackLabel(track({ id: 1, external: true }), 'en', UNNAMED)).toBe('Track 1 [ext]');
	});

	it('localises the language part', () => {
		expect(trackLabel(track({ lang: 'jpn', title: 'Stereo' }), 'es', UNNAMED)).toBe('Japonés · Stereo');
	});
});
