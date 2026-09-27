import { describe, expect, it } from 'vitest';
import {
	RESUME_MIN_DURATION_SECONDS,
	RESUME_MIN_SECONDS,
	WATCHED_FRACTION,
	isEffectivelyWatched,
	resumePositionFor,
	shouldStorePosition,
} from './resume';

// A typical 24-minute episode.
const EPISODE = 24 * 60;

describe('shouldStorePosition', () => {
	it('stores a position in the middle of the file', () => {
		expect(shouldStorePosition(600, EPISODE)).toBe(true);
	});

	it('refuses positions under the floor (= "from the beginning")', () => {
		expect(shouldStorePosition(0, EPISODE)).toBe(false);
		expect(shouldStorePosition(0.9, EPISODE)).toBe(false);
		expect(shouldStorePosition(RESUME_MIN_SECONDS, EPISODE)).toBe(true);
	});

	it('refuses positions past the watched fraction (= "finished")', () => {
		const boundary = EPISODE * WATCHED_FRACTION;
		expect(shouldStorePosition(boundary, EPISODE)).toBe(true);
		expect(shouldStorePosition(boundary + 0.001, EPISODE)).toBe(false);
		expect(shouldStorePosition(EPISODE, EPISODE)).toBe(false);
	});

	it('refuses files too short to be worth resuming', () => {
		expect(shouldStorePosition(30, RESUME_MIN_DURATION_SECONDS - 1)).toBe(false);
		expect(shouldStorePosition(30, RESUME_MIN_DURATION_SECONDS)).toBe(true);
	});

	it('refuses anything when the duration is unknown or nonsense', () => {
		// mpv reports null/0/NaN while a file is still opening.
		expect(shouldStorePosition(600, null)).toBe(false);
		expect(shouldStorePosition(600, undefined)).toBe(false);
		expect(shouldStorePosition(600, 0)).toBe(false);
		expect(shouldStorePosition(600, NaN)).toBe(false);
		expect(shouldStorePosition(600, Infinity)).toBe(false);
		expect(shouldStorePosition(600, -EPISODE)).toBe(false);
	});

	it('refuses a missing or non-finite position', () => {
		expect(shouldStorePosition(null, EPISODE)).toBe(false);
		expect(shouldStorePosition(undefined, EPISODE)).toBe(false);
		expect(shouldStorePosition(NaN, EPISODE)).toBe(false);
	});
});

describe('isEffectivelyWatched', () => {
	it('is true only strictly past the watched fraction', () => {
		expect(isEffectivelyWatched(EPISODE * WATCHED_FRACTION, EPISODE)).toBe(false);
		expect(isEffectivelyWatched(EPISODE * WATCHED_FRACTION + 1, EPISODE)).toBe(true);
		expect(isEffectivelyWatched(EPISODE, EPISODE)).toBe(true);
	});

	it('never claims an unknown duration is watched', () => {
		expect(isEffectivelyWatched(600, null)).toBe(false);
		expect(isEffectivelyWatched(null, EPISODE)).toBe(false);
	});

	// A short clip has no stored position, but "watched" still has to work for
	// it so finishing one does not leave a stale row behind.
	it('applies to short files too, unlike shouldStorePosition', () => {
		expect(shouldStorePosition(29, 30)).toBe(false);
		expect(isEffectivelyWatched(29, 30)).toBe(true);
	});
});

describe('resumePositionFor', () => {
	it('returns the stored position when it is still inside the window', () => {
		expect(resumePositionFor(600, EPISODE)).toBe(600);
	});

	it('returns null for a missing row', () => {
		expect(resumePositionFor(null, EPISODE)).toBe(null);
		expect(resumePositionFor(undefined, undefined)).toBe(null);
	});

	it('trusts the position when the stored duration is unknown', () => {
		// Rows written before the duration column existed must still resume.
		expect(resumePositionFor(600, null)).toBe(600);
	});

	it('drops a position that no longer fits the stored duration', () => {
		// e.g. the file was replaced by a shorter cut: 20 min into a 10 min file.
		expect(resumePositionFor(1200, 600)).toBe(null);
	});

	it('drops a position past the watched fraction', () => {
		expect(resumePositionFor(EPISODE * 0.95, EPISODE)).toBe(null);
	});

	it('drops a position under the floor', () => {
		expect(resumePositionFor(0.5, EPISODE)).toBe(null);
		expect(resumePositionFor(0, EPISODE)).toBe(null);
		expect(resumePositionFor(0.5, null)).toBe(null);
	});
});
