import { describe, expect, it } from 'vitest';
import { computeBufferedSeconds, computeIsLoading } from './buffering';

describe('computeBufferedSeconds', () => {
	it('prefers the absolute cache time, relative to the playhead', () => {
		// 120s cached, playing at 100s -> 20s ahead.
		expect(computeBufferedSeconds(120, 5, 100)).toBe(20);
	});

	it('falls back to the relative cache duration when there is no cache time', () => {
		expect(computeBufferedSeconds(null, 18, 100)).toBe(18);
		expect(computeBufferedSeconds(0, 18, 100)).toBe(18);
		expect(computeBufferedSeconds(-1, 18, 100)).toBe(18);
		expect(computeBufferedSeconds(NaN, 18, 100)).toBe(18);
	});

	it('tolerates the cache time trailing the playhead just after a seek', () => {
		// Within the 5s slack: clamped to 0 rather than going negative.
		expect(computeBufferedSeconds(98, 30, 100)).toBe(0);
	});

	it('ignores a cache time far behind the playhead and uses the duration', () => {
		// Past the slack: the absolute value is stale, the relative one is not.
		expect(computeBufferedSeconds(10, 30, 100)).toBe(30);
	});

	it('returns 0 when nothing is known', () => {
		expect(computeBufferedSeconds(null, null, null)).toBe(0);
		expect(computeBufferedSeconds(undefined, undefined, undefined)).toBe(0);
		expect(computeBufferedSeconds(null, 0, 100)).toBe(0);
	});

	it('treats a missing position as 0, so the value stays absolute-ish at load', () => {
		expect(computeBufferedSeconds(30, null, null)).toBe(30);
	});
});

describe('computeIsLoading', () => {
	const playing = {
		duration: 1440,
		coreIdle: false,
		paused: false,
		eofReached: false,
		pausedForCache: false,
	};

	it('is false while frames are actually being produced', () => {
		expect(computeIsLoading(playing)).toBe(false);
	});

	it('is true until the file is ready (no duration yet)', () => {
		expect(computeIsLoading({ ...playing, duration: null })).toBe(true);
		expect(computeIsLoading({ ...playing, duration: 0 })).toBe(true);
		expect(computeIsLoading({ ...playing, duration: NaN })).toBe(true);
	});

	it('is true when mpv says it is waiting on the cache, even while paused', () => {
		expect(computeIsLoading({ ...playing, pausedForCache: true })).toBe(true);
		expect(computeIsLoading({ ...playing, paused: true, pausedForCache: true })).toBe(true);
	});

	it('is true when mpv is idle although playback was requested', () => {
		expect(computeIsLoading({ ...playing, coreIdle: true })).toBe(true);
	});

	it('is false when idle because the user paused', () => {
		expect(computeIsLoading({ ...playing, coreIdle: true, paused: true })).toBe(false);
	});

	it('is false when idle at EOF (keep-open=yes parks mpv there unpaused)', () => {
		expect(computeIsLoading({ ...playing, coreIdle: true, eofReached: true })).toBe(false);
	});
});
