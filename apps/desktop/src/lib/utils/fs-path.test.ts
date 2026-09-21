import { describe, expect, it } from 'vitest';
import { baseName, parentPath } from './fs-path';

describe('parentPath', () => {
	describe('POSIX', () => {
		it('returns null at the root', () => {
			expect(parentPath('/')).toBeNull();
			expect(parentPath('//')).toBeNull();
		});

		it('returns "/" for a first-level folder', () => {
			expect(parentPath('/a')).toBe('/');
			expect(parentPath('/a/')).toBe('/');
		});

		it('strips the last segment', () => {
			expect(parentPath('/Volumes/Disk/Movies')).toBe('/Volumes/Disk');
			expect(parentPath('/Volumes/Disk/Movies/')).toBe('/Volumes/Disk');
		});

		it('tolerates duplicated separators', () => {
			expect(parentPath('/a//b///')).toBe('/a/');
		});

		it('returns null for an empty string', () => {
			expect(parentPath('')).toBeNull();
		});

		it('returns null for a single relative segment', () => {
			expect(parentPath('Movies')).toBeNull();
		});
	});

	describe('Windows drives', () => {
		it('treats the drive root as a root', () => {
			expect(parentPath('C:\\')).toBeNull();
			expect(parentPath('C:/')).toBeNull();
			expect(parentPath('c:\\')).toBeNull();
		});

		it('never returns the drive-relative form "C:"', () => {
			// `C:` alone is drive-RELATIVE (the drive's current dir), so the
			// parent of a first-level folder must be `C:\`.
			expect(parentPath('C:\\a')).toBe('C:\\');
			expect(parentPath('C:\\a\\')).toBe('C:\\');
			expect(parentPath('C:/a')).toBe('C:\\');
		});

		it('climbs one level and keeps the original separators', () => {
			expect(parentPath('C:\\Videos\\Anime')).toBe('C:\\Videos');
			expect(parentPath('C:/Videos/Anime')).toBe('C:/Videos');
		});

		it('handles mixed separators', () => {
			expect(parentPath('C:\\Videos/Anime\\S1')).toBe('C:\\Videos/Anime');
		});

		it('is not a Windows path when a bare "C:" is given', () => {
			// Not a valid root, and `isWindowsPath` requires a separator after
			// the colon, so it falls through to the POSIX branch: a single
			// relative segment with no separator -> nowhere to go.
			expect(parentPath('C:')).toBeNull();
		});
	});

	describe('UNC shares', () => {
		it('treats \\\\server\\share as a root', () => {
			expect(parentPath('\\\\server\\share')).toBeNull();
			expect(parentPath('\\\\server\\share\\')).toBeNull();
		});

		it('returns the share root for a first-level folder', () => {
			expect(parentPath('\\\\server\\share\\a')).toBe('\\\\server\\share');
		});

		it('climbs deeper paths one level', () => {
			expect(parentPath('\\\\server\\share\\a\\b')).toBe('\\\\server\\share\\a');
		});

		it('returns null when only the server is present', () => {
			expect(parentPath('\\\\server')).toBeNull();
		});
	});
});

describe('baseName', () => {
	it('returns the last segment', () => {
		expect(baseName('/Volumes/Disk/Movies')).toBe('Movies');
		expect(baseName('/Volumes/Disk/Movies/')).toBe('Movies');
		expect(baseName('C:\\Videos\\Anime')).toBe('Anime');
		expect(baseName('C:/Videos/Anime/')).toBe('Anime');
		expect(baseName('\\\\server\\share\\a')).toBe('a');
	});

	it('handles mixed and duplicated separators', () => {
		expect(baseName('C:\\Videos//Anime\\\\S1')).toBe('S1');
	});

	it('falls back to the whole path for roots', () => {
		expect(baseName('/')).toBe('/');
		expect(baseName('C:\\')).toBe('C:');
		expect(baseName('\\\\server\\share')).toBe('share');
	});

	it('returns an empty string for an empty path', () => {
		expect(baseName('')).toBe('');
	});
});
