import { describe, expect, it } from 'vitest';
import {
	LOCAL_FILE_OPTIONS,
	REMOTE_STREAM_OPTIONS,
	isRemoteUrl,
	streamProfileFor,
} from './stream-profile';

describe('isRemoteUrl', () => {
	it('recognises the MEGAcmd WebDAV URLs we actually play', () => {
		expect(isRemoteUrl('http://127.0.0.1:4443/AbCd1234/episode.mkv')).toBe(true);
		expect(isRemoteUrl('https://127.0.0.1:4443/AbCd1234/episode.mkv')).toBe(true);
		expect(isRemoteUrl('HTTP://127.0.0.1:4443/x.mkv')).toBe(true);
	});

	it('treats local filesystem paths as local', () => {
		expect(isRemoteUrl('/Volumes/Disk/Anime/ep01.mkv')).toBe(false);
		expect(isRemoteUrl('C:\\Videos\\ep01.mkv')).toBe(false);
		// A Mega remote path is never handed to mpv, but must not look remote.
		expect(isRemoteUrl('//from/user@mail.com:Shared/ep01.mkv')).toBe(false);
	});

	it('does not mistake a path that merely contains "http" for a URL', () => {
		expect(isRemoteUrl('/Volumes/Disk/http/ep01.mkv')).toBe(false);
		expect(isRemoteUrl('/Volumes/http://weird/ep01.mkv')).toBe(false);
	});
});

describe('streamProfileFor', () => {
	it('picks the streaming profile for WebDAV and the local one otherwise', () => {
		expect(streamProfileFor('http://127.0.0.1:4443/x/a.mkv')).toBe(REMOTE_STREAM_OPTIONS);
		expect(streamProfileFor('/Volumes/Disk/a.mkv')).toBe(LOCAL_FILE_OPTIONS);
	});

	// The whole point of writing both profiles explicitly is that switching
	// sources resets every option. A key present in one map and missing from the
	// other would silently carry over from the previous file.
	it('both profiles set exactly the same keys', () => {
		expect(Object.keys(REMOTE_STREAM_OPTIONS).sort()).toEqual(
			Object.keys(LOCAL_FILE_OPTIONS).sort()
		);
	});

	it('the streaming profile is strictly more generous than the local one', () => {
		expect(REMOTE_STREAM_OPTIONS['cache']).toBe('yes');
		expect(REMOTE_STREAM_OPTIONS['demuxer-seekable-cache']).toBe('yes');
		// A shorter read timeout is what turns "frozen picture" into an error.
		expect(Number(REMOTE_STREAM_OPTIONS['network-timeout'])).toBeLessThan(
			Number(LOCAL_FILE_OPTIONS['network-timeout'])
		);
		expect(Number(REMOTE_STREAM_OPTIONS['network-timeout'])).toBeGreaterThan(0);
	});

	it('keeps the byte caps in the documented range', () => {
		// Nuvio's reference window is 150-512 MiB forward.
		expect(REMOTE_STREAM_OPTIONS['demuxer-max-bytes']).toBe('256MiB');
		expect(REMOTE_STREAM_OPTIONS['demuxer-max-back-bytes']).toBe('128MiB');
	});
});
