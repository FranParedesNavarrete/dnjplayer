import { describe, expect, it } from 'vitest';
import { asFlag, asOptionalString, parseTrackId, parseTrackList } from './track-list';

describe('asFlag', () => {
	it('accepts real booleans', () => {
		expect(asFlag(true)).toBe(true);
		expect(asFlag(false)).toBe(false);
	});

	// mpv's string form, which is what arrives for several properties.
	it('accepts mpv\'s string booleans', () => {
		expect(asFlag('yes')).toBe(true);
		expect(asFlag('true')).toBe(true);
		expect(asFlag('1')).toBe(true);
		expect(asFlag('no')).toBe(false);
		expect(asFlag('false')).toBe(false);
		expect(asFlag('0')).toBe(false);
	});

	it('treats any non-zero number as true', () => {
		expect(asFlag(1)).toBe(true);
		expect(asFlag(-1)).toBe(true);
		expect(asFlag(0)).toBe(false);
	});

	it('defaults to false for absent or unexpected values', () => {
		expect(asFlag(null)).toBe(false);
		expect(asFlag(undefined)).toBe(false);
		expect(asFlag({})).toBe(false);
		expect(asFlag('YES')).toBe(false); // mpv only ever sends lowercase
	});
});

describe('asOptionalString', () => {
	it('returns trimmed non-empty strings', () => {
		expect(asOptionalString('  Japanese ')).toBe('Japanese');
	});

	// mpv both omits absent fields and sends "" for some of them.
	it('returns undefined for empty, blank and non-string values', () => {
		expect(asOptionalString('')).toBeUndefined();
		expect(asOptionalString('   ')).toBeUndefined();
		expect(asOptionalString(null)).toBeUndefined();
		expect(asOptionalString(undefined)).toBeUndefined();
		expect(asOptionalString(3)).toBeUndefined();
	});
});

describe('parseTrackId', () => {
	it('parses numeric ids, as numbers or as numeric strings', () => {
		expect(parseTrackId(2)).toBe(2);
		expect(parseTrackId('2')).toBe(2);
	});

	// The reason aid/sid are observed as 'string' and not 'int64'.
	it('maps mpv\'s "no" (stream disabled) to the literal "no"', () => {
		expect(parseTrackId('no')).toBe('no');
		expect(parseTrackId('false')).toBe('no');
		expect(parseTrackId(false)).toBe('no');
	});

	it('maps "auto" and empty (not yet selected) to null', () => {
		expect(parseTrackId('auto')).toBeNull();
		expect(parseTrackId('')).toBeNull();
	});

	it('returns null for absent or unparseable values', () => {
		expect(parseTrackId(null)).toBeNull();
		expect(parseTrackId(undefined)).toBeNull();
		expect(parseTrackId('banana')).toBeNull();
		expect(parseTrackId(NaN)).toBeNull();
		expect(parseTrackId({})).toBeNull();
	});
});

describe('parseTrackList', () => {
	it('parses a realistic dual-audio episode', () => {
		const tracks = parseTrackList([
			{ id: 1, type: 'video', codec: 'hevc' },
			{ id: 2, type: 'audio', lang: 'jpn', title: 'Japanese', selected: true, default: true },
			{ id: 3, type: 'audio', lang: 'eng', title: 'English' },
			{ id: 4, type: 'sub', lang: 'spa', title: 'Castellano', forced: false },
		]);
		expect(tracks).toHaveLength(4);
		expect(tracks[1]).toEqual({
			id: 2,
			type: 'audio',
			title: 'Japanese',
			lang: 'jpn',
			codec: undefined,
			selected: true,
			external: false,
			default: true,
			forced: false,
		});
	});

	it('accepts a JSON string payload as well as decoded JSON', () => {
		const raw = JSON.stringify([{ id: 1, type: 'audio' }]);
		expect(parseTrackList(raw)).toHaveLength(1);
	});

	it('returns [] for anything that is not a track array', () => {
		expect(parseTrackList(null)).toEqual([]);
		expect(parseTrackList(undefined)).toEqual([]);
		expect(parseTrackList({})).toEqual([]);
		expect(parseTrackList('not json')).toEqual([]);
		expect(parseTrackList('{"a":1}')).toEqual([]);
		expect(parseTrackList([])).toEqual([]);
	});

	// The defensiveness that matters: a junk entry must be dropped, not turned
	// into a track the UI can select and then write a bogus aid for.
	it('drops entries with an unusable id or an unknown type', () => {
		const tracks = parseTrackList([
			{ id: 'nope', type: 'audio' },
			{ type: 'audio' },
			{ id: 1, type: 'attachment' },
			{ id: 2 },
			null,
			'string',
			42,
			{ id: 3, type: 'sub' },
		]);
		expect(tracks).toEqual([
			{
				id: 3,
				type: 'sub',
				title: undefined,
				lang: undefined,
				codec: undefined,
				selected: false,
				external: false,
				default: false,
				forced: false,
			},
		]);
	});

	it('accepts numeric-string ids', () => {
		expect(parseTrackList([{ id: '7', type: 'sub' }])[0].id).toBe(7);
	});

	// mpv marks sideloaded subtitles either way depending on how they got there.
	it('treats external-filename alone as external', () => {
		const [a, b, c] = parseTrackList([
			{ id: 1, type: 'sub', external: true },
			{ id: 2, type: 'sub', 'external-filename': '/tmp/ep1.es.srt' },
			{ id: 3, type: 'sub' },
		]);
		expect(a.external).toBe(true);
		expect(b.external).toBe(true);
		expect(c.external).toBe(false);
	});

	it('reads mpv\'s string booleans on track flags', () => {
		const [t] = parseTrackList([
			{ id: 1, type: 'audio', selected: 'yes', default: 'no', forced: 'yes' },
		]);
		expect(t.selected).toBe(true);
		expect(t.default).toBe(false);
		expect(t.forced).toBe(true);
	});
});
