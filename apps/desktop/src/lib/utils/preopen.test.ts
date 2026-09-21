import { describe, expect, it } from 'vitest';
import { PREOPEN_LEAD_SECONDS, shouldPreopenNext, type PreopenInput } from './preopen';

// A typical 24-minute episode, mid-queue, everything from the same source.
const EPISODE = 24 * 60;

function input(overrides: Partial<PreopenInput> = {}): PreopenInput {
	return {
		position: EPISODE - 10,
		duration: EPISODE,
		index: 0,
		length: 3,
		sameStreamProfile: true,
		alreadyArmed: false,
		...overrides,
	};
}

describe('shouldPreopenNext', () => {
	it('pre-opens once the playhead is inside the lead window', () => {
		expect(shouldPreopenNext(input())).toBe(true);
	});

	it('does nothing early in the file', () => {
		expect(shouldPreopenNext(input({ position: 60 }))).toBe(false);
	});

	it('fires exactly at the lead boundary and not one second before', () => {
		const at = EPISODE - PREOPEN_LEAD_SECONDS;
		expect(shouldPreopenNext(input({ position: at }))).toBe(true);
		expect(shouldPreopenNext(input({ position: at - 1 }))).toBe(false);
	});

	it('honours an explicit lead override', () => {
		expect(shouldPreopenNext(input({ position: EPISODE - 20, lead: 10 }))).toBe(false);
		expect(shouldPreopenNext(input({ position: EPISODE - 20, lead: 30 }))).toBe(true);
	});

	it('refuses once the item is already armed', () => {
		// alreadyArmed is the caller's "preopened.index === index + 1" check; without
		// it the time-pos observer would append the same entry once a second.
		expect(shouldPreopenNext(input({ alreadyArmed: true }))).toBe(false);
	});

	// The profile gate: appending a Mega stream while the local-file profile is in
	// force would open its demuxer with the cache OFF, which is worse than the
	// cold start this whole mechanism exists to avoid.
	it('refuses across a demuxer-profile change (mixed local/remote queue)', () => {
		expect(shouldPreopenNext(input({ sameStreamProfile: false }))).toBe(false);
	});

	it('refuses on the last item of the queue', () => {
		expect(shouldPreopenNext(input({ index: 2, length: 3 }))).toBe(false);
	});

	it('refuses on a single-item queue', () => {
		expect(shouldPreopenNext(input({ index: 0, length: 1 }))).toBe(false);
	});

	it('refuses on an empty queue or a negative index', () => {
		expect(shouldPreopenNext(input({ index: 0, length: 0 }))).toBe(false);
		expect(shouldPreopenNext(input({ index: -1, length: 3 }))).toBe(false);
	});

	// Every unknown is a "no": a wrong pre-open wastes a demuxer and freezes a
	// WebDAV URL early, a missed one only costs the cold start we have today.
	it('refuses while the position or duration is unknown', () => {
		expect(shouldPreopenNext(input({ position: null }))).toBe(false);
		expect(shouldPreopenNext(input({ duration: null }))).toBe(false);
	});

	it('refuses on non-finite or nonsensical values', () => {
		expect(shouldPreopenNext(input({ position: NaN }))).toBe(false);
		expect(shouldPreopenNext(input({ duration: Infinity }))).toBe(false);
		expect(shouldPreopenNext(input({ duration: 0 }))).toBe(false);
		expect(shouldPreopenNext(input({ duration: -5 }))).toBe(false);
	});

	it('refuses at or past the end, where it would arrive too late anyway', () => {
		expect(shouldPreopenNext(input({ position: EPISODE }))).toBe(false);
		expect(shouldPreopenNext(input({ position: EPISODE + 2 }))).toBe(false);
	});

	// A clip shorter than the lead is inside the window from its first frame.
	// That is intentional (mpv prefetches as soon as a next entry exists), so the
	// only requirement is that it says yes rather than never firing.
	it('pre-opens straight away for a clip shorter than the lead', () => {
		expect(shouldPreopenNext(input({ position: 1, duration: 20 }))).toBe(true);
	});
});
