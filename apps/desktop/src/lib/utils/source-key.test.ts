import { describe, expect, it } from 'vitest';
import { parseSourceKey, toDbKey } from './source-key';

describe('toDbKey', () => {
	it('stores Mega paths bare (no scheme means Mega)', () => {
		expect(toDbKey('mega', '/Movies/a.mkv')).toBe('/Movies/a.mkv');
		expect(toDbKey('mega', '//from/user@mail.com:Shared/a.mkv')).toBe(
			'//from/user@mail.com:Shared/a.mkv'
		);
	});

	it('prefixes local paths with file:// verbatim', () => {
		expect(toDbKey('local', '/Volumes/Disk/a.mkv')).toBe('file:///Volumes/Disk/a.mkv');
	});

	it('is an opaque identifier, NOT a URI: no encoding or separator changes', () => {
		// Changing any of these would re-key every existing row (see the header
		// comment in source-key.ts).
		expect(toDbKey('local', 'C:\\Videos\\a.mkv')).toBe('file://C:\\Videos\\a.mkv');
		expect(toDbKey('local', '\\\\server\\share\\a.mkv')).toBe('file://\\\\server\\share\\a.mkv');
		expect(toDbKey('local', '/Movies/épisode 01 #1.mkv')).toBe('file:///Movies/épisode 01 #1.mkv');
	});
});

describe('parseSourceKey', () => {
	it('decodes local keys back to their raw path', () => {
		expect(parseSourceKey('file:///Volumes/Disk/a.mkv')).toEqual({
			source: 'local',
			path: '/Volumes/Disk/a.mkv',
		});
		expect(parseSourceKey('file://C:\\Videos\\a.mkv')).toEqual({
			source: 'local',
			path: 'C:\\Videos\\a.mkv',
		});
	});

	it('treats anything without the prefix as a Mega path', () => {
		expect(parseSourceKey('/Movies/a.mkv')).toEqual({ source: 'mega', path: '/Movies/a.mkv' });
		expect(parseSourceKey('//from/user@mail.com:Shared/a.mkv')).toEqual({
			source: 'mega',
			path: '//from/user@mail.com:Shared/a.mkv',
		});
		// Pre-existing rows never had a scheme; they must stay Mega.
		expect(parseSourceKey('Anime/ep01.mkv').source).toBe('mega');
	});

	it('is the inverse of toDbKey for both sources', () => {
		for (const path of ['/Movies/a.mkv', 'C:\\Videos\\a.mkv', '/a b/ü.mkv', '']) {
			expect(parseSourceKey(toDbKey('local', path))).toEqual({ source: 'local', path });
			expect(parseSourceKey(toDbKey('mega', path))).toEqual({ source: 'mega', path });
		}
	});

	it('does not confuse a Mega path that merely contains file:// later on', () => {
		expect(parseSourceKey('/notes/file://x').source).toBe('mega');
	});
});
