import { describe, expect, it } from 'vitest';
import { isAudio, isImage, isSubtitle, isVideo, SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from './media-types';

describe('isVideo', () => {
	it('accepts every listed extension, case-insensitively', () => {
		for (const ext of VIDEO_EXTENSIONS) {
			expect(isVideo(`movie${ext}`)).toBe(true);
			expect(isVideo(`MOVIE${ext.toUpperCase()}`)).toBe(true);
		}
	});

	it('rejects non-video names', () => {
		expect(isVideo('movie.srt')).toBe(false);
		expect(isVideo('movie.mp3')).toBe(false);
		expect(isVideo('Season 1')).toBe(false);
		expect(isVideo('mkv')).toBe(false); // no dot
		expect(isVideo('')).toBe(false);
	});

	it('only looks at the final extension', () => {
		expect(isVideo('show.s01e01.mkv')).toBe(true);
		expect(isVideo('show.mkv.part')).toBe(false);
	});
});

describe('isSubtitle', () => {
	it('accepts every listed extension, case-insensitively', () => {
		for (const ext of SUBTITLE_EXTENSIONS) {
			expect(isSubtitle(`subs${ext}`)).toBe(true);
			expect(isSubtitle(`SUBS${ext.toUpperCase()}`)).toBe(true);
		}
	});

	it('rejects videos and unrelated names', () => {
		expect(isSubtitle('movie.mkv')).toBe(false);
		expect(isSubtitle('subtitles')).toBe(false);
	});
});

describe('isAudio', () => {
	it('matches common audio extensions', () => {
		expect(isAudio('track.mp3')).toBe(true);
		expect(isAudio('track.FLAC')).toBe(true);
		expect(isAudio('track.m4a')).toBe(true);
		expect(isAudio('track.m4v')).toBe(false);
		expect(isAudio('track.mp3.bak')).toBe(false);
	});
});

describe('isImage', () => {
	it('matches common image extensions', () => {
		expect(isImage('cover.jpg')).toBe(true);
		expect(isImage('cover.JPEG')).toBe(true);
		expect(isImage('cover.webp')).toBe(true);
		expect(isImage('cover.svg')).toBe(false);
		expect(isImage('cover')).toBe(false);
	});
});
