import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { clearNotifications, dismiss, notifications, notify } from './notifications';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	clearNotifications();
	vi.useRealTimers();
});

describe('notify', () => {
	it('errors are persistent by default; success/info are not', () => {
		notify('error', 'boom');
		notify('success', 'saved');
		notify('info', 'fyi');
		const [err, ok, info] = get(notifications);
		expect(err.persistent).toBe(true);
		expect(ok.persistent).toBe(false);
		expect(info.persistent).toBe(false);
	});

	it('honours an explicit persistent flag in both directions', () => {
		notify('info', 'stay', { persistent: true });
		notify('error', 'go away', { persistent: false, durationMs: 100 });
		const [info, err] = get(notifications);
		expect(info.persistent).toBe(true);
		expect(err.persistent).toBe(false);

		vi.advanceTimersByTime(100);
		expect(get(notifications).map((n) => n.message)).toEqual(['stay']);
	});

	it('returns a unique id and stores message, detail and kind', () => {
		const a = notify('error', 'first', { detail: 'stack' });
		const b = notify('error', 'second');
		expect(a).not.toBe(b);
		const items = get(notifications);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ id: a, kind: 'error', message: 'first', detail: 'stack' });
		expect(items[1]).toMatchObject({ id: b, kind: 'error', message: 'second', detail: undefined });
	});

	it('appends in insertion order', () => {
		notify('info', 'one');
		notify('info', 'two');
		notify('info', 'three');
		expect(get(notifications).map((n) => n.message)).toEqual(['one', 'two', 'three']);
	});
});

describe('deduplication', () => {
	it('collapses identical persistent errors into the existing one', () => {
		const first = notify('error', 'Could not play', { detail: 'mpv: failed' });
		const again = notify('error', 'Could not play', { detail: 'mpv: failed' });
		expect(again).toBe(first);
		expect(get(notifications)).toHaveLength(1);
	});

	it('treats a different detail as a different error', () => {
		notify('error', 'Could not play', { detail: 'a' });
		notify('error', 'Could not play', { detail: 'b' });
		notify('error', 'Could not play');
		expect(get(notifications)).toHaveLength(3);
	});

	it('does not deduplicate transient notifications', () => {
		notify('success', 'saved');
		notify('success', 'saved');
		expect(get(notifications)).toHaveLength(2);
	});

	it('does not merge a persistent error with an identical transient one', () => {
		notify('error', 'x', { persistent: false });
		const id = notify('error', 'x');
		expect(get(notifications)).toHaveLength(2);
		expect(get(notifications)[1].id).toBe(id);
	});
});

describe('auto-dismiss', () => {
	it('removes a transient notification after the default 2s', () => {
		notify('success', 'saved');
		vi.advanceTimersByTime(1999);
		expect(get(notifications)).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(get(notifications)).toHaveLength(0);
	});

	it('uses a custom durationMs', () => {
		notify('info', 'quick', { durationMs: 500 });
		vi.advanceTimersByTime(499);
		expect(get(notifications)).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(get(notifications)).toHaveLength(0);
	});

	it('never auto-dismisses persistent notifications', () => {
		notify('error', 'boom');
		vi.advanceTimersByTime(60_000);
		expect(get(notifications)).toHaveLength(1);
	});
});

describe('dismiss', () => {
	it('removes only the given id', () => {
		const a = notify('error', 'a');
		const b = notify('error', 'b');
		dismiss(a);
		expect(get(notifications).map((n) => n.id)).toEqual([b]);
	});

	it('cancels the pending timer of a transient notification', () => {
		const id = notify('success', 'saved');
		dismiss(id);
		expect(get(notifications)).toHaveLength(0);
		// A stale timer would try to dismiss a re-used slot; make sure nothing
		// is left pending.
		expect(vi.getTimerCount()).toBe(0);
	});

	it('is a no-op for unknown ids', () => {
		notify('error', 'a');
		expect(() => dismiss(9999)).not.toThrow();
		expect(get(notifications)).toHaveLength(1);
	});
});

describe('clearNotifications', () => {
	it('empties the queue and cancels every timer', () => {
		notify('success', 'a');
		notify('info', 'b');
		notify('error', 'c');
		clearNotifications();
		expect(get(notifications)).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});
