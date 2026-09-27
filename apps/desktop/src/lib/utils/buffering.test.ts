import { describe, expect, it } from 'vitest';
import {
	computeBufferedSeconds,
	computeIsLoading,
	stepSpinner,
	IDLE_SPINNER,
	SPINNER_GRACE_MS,
} from './buffering';

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

describe('stepSpinner', () => {
	const T = { graceMs: 300, minVisibleMs: 400 };

	it('stays hidden while nothing is busy', () => {
		const step = stepSpinner(IDLE_SPINNER, false, 1000, T);
		expect(step.state.visible).toBe(false);
		expect(step.recheckInMs).toBeNull();
	});

	it('does NOT show immediately on the rising edge, and asks to be re-checked', () => {
		const step = stepSpinner(IDLE_SPINNER, true, 1000, T);
		expect(step.state.visible).toBe(false);
		expect(step.state.busySince).toBe(1000);
		expect(step.recheckInMs).toBe(300);
	});

	it('shrinks the re-check as the grace window elapses', () => {
		const a = stepSpinner(IDLE_SPINNER, true, 1000, T);
		const b = stepSpinner(a.state, true, 1120, T);
		expect(b.state.visible).toBe(false);
		expect(b.recheckInMs).toBe(180);
	});

	it('shows once busy has persisted for the grace delay', () => {
		const a = stepSpinner(IDLE_SPINNER, true, 1000, T);
		const b = stepSpinner(a.state, true, 1300, T);
		expect(b.state.visible).toBe(true);
		expect(b.state.shownAt).toBe(1300);
		expect(b.recheckInMs).toBeNull();
	});

	// The reason the grace delay exists: a WebDAV top-up blip must not strobe.
	it('swallows a stall shorter than the grace delay entirely', () => {
		const a = stepSpinner(IDLE_SPINNER, true, 1000, T);
		const b = stepSpinner(a.state, true, 1100, T);
		const c = stepSpinner(b.state, false, 1150, T);
		expect(b.state.visible).toBe(false);
		expect(c.state.visible).toBe(false);
		expect(c.state).toEqual(IDLE_SPINNER);
		expect(c.recheckInMs).toBeNull();
	});

	it('restarts the grace window after an abandoned stall', () => {
		const a = stepSpinner(IDLE_SPINNER, true, 1000, T);
		const cleared = stepSpinner(a.state, false, 1100, T);
		const again = stepSpinner(cleared.state, true, 1200, T);
		// Not 1000: the earlier partial wait must not count towards this one, or
		// two short unrelated blips would add up into a visible flash.
		expect(again.state.busySince).toBe(1200);
		expect(again.state.visible).toBe(false);
	});

	it('holds the spinner for the minimum visible time after busy clears', () => {
		const shown = stepSpinner(
			{ visible: true, busySince: 1000, shownAt: 1300 },
			false,
			1400,
			T
		);
		expect(shown.state.visible).toBe(true);
		expect(shown.recheckInMs).toBe(300);
	});

	it('hides once the minimum visible time has passed', () => {
		const step = stepSpinner({ visible: true, busySince: 1000, shownAt: 1300 }, false, 1700, T);
		expect(step.state).toEqual(IDLE_SPINNER);
		expect(step.recheckInMs).toBeNull();
	});

	it('keeps an already visible spinner up with no new grace period', () => {
		const step = stepSpinner({ visible: true, busySince: null, shownAt: 1300 }, true, 5000, T);
		expect(step.state.visible).toBe(true);
		// The original shownAt survives, so the minimum-visible clock is not reset
		// by every re-stall.
		expect(step.state.shownAt).toBe(1300);
		expect(step.recheckInMs).toBeNull();
	});

	it('uses the real defaults when no timings are passed', () => {
		const a = stepSpinner(IDLE_SPINNER, true, 0);
		expect(a.recheckInMs).toBe(SPINNER_GRACE_MS);
		expect(stepSpinner(a.state, true, SPINNER_GRACE_MS - 1).state.visible).toBe(false);
		expect(stepSpinner(a.state, true, SPINNER_GRACE_MS).state.visible).toBe(true);
	});
});
