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

	it('caps the remote readahead by TIME, with bytes as the memory ceiling', () => {
		// This ordering is the point of the profile, not an accident of the
		// numbers. Measured 2026-09-27: 256 MiB IS 4.6 minutes at the bitrate of
		// the user's content, so a byte cap silently decides how many MINUTES of
		// protection there are, and it decides differently for every file. The
		// time value is the promise; the byte value only stops a high-bitrate
		// file turning that promise into gigabytes of RAM.
		expect(Number(REMOTE_STREAM_OPTIONS['cache-secs'])).toBe(1200);
		expect(REMOTE_STREAM_OPTIONS['demuxer-max-bytes']).toBe('2GiB');
		// The ceiling must be able to hold the promised minutes for ordinary
		// 1080p (~1 MB/s), or it would bind first and the time value would be
		// decorative — which is exactly the bug this profile was changed to fix.
		const perSecond = 1.05 * 1024 * 1024; // generous 1080p anime bitrate
		expect(2 * 1024 * 1024 * 1024).toBeGreaterThan(
			Number(REMOTE_STREAM_OPTIONS['cache-secs']) * perSecond
		);
	});

	it('spends less on the backward cache than on the forward one', () => {
		// A back-seek inside the cached range is a convenience; a mid-playback
		// stall is the failure this profile exists to prevent. The queue
		// pre-open can also have two demuxers alive at once, so the backward
		// cache is the one that gives way.
		expect(REMOTE_STREAM_OPTIONS['demuxer-max-back-bytes']).toBe('64MiB');
	});

	it('waits for a real cushion before resuming from a stall', () => {
		// mpv's default is 1 second, which turns one supply outage into a burst
		// of five or six visible stalls as playback resumes and immediately runs
		// dry again. Local files keep the default: one that runs dry has a real
		// problem and waiting will not fix it.
		expect(Number(REMOTE_STREAM_OPTIONS['cache-pause-wait'])).toBeGreaterThanOrEqual(15);
		expect(Number(LOCAL_FILE_OPTIONS['cache-pause-wait'])).toBe(1);
	});
});
