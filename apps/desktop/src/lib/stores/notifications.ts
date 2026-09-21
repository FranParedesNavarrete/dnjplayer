import { writable, type Readable } from 'svelte/store';

/**
 * App-wide notifications ("toasts").
 *
 * Single queue consumed by the ToastHost in the layout. Two kinds of lifetime:
 * - transient (success/info): auto-dismiss after `durationMs`, default 2s. The
 *   visual reference is nero's "top pill" toast, which is explicitly meant for
 *   quick, low-risk confirmations.
 * - persistent (errors by default): stay until the user dismisses them. Errors
 *   must never auto-dismiss — a load failure the user didn't get to read is the
 *   same as no message at all.
 *
 * Framework-free on purpose: services (player-service, mega-service) call
 * notify() directly without needing a component context.
 */
export type NotificationKind = 'success' | 'info' | 'error';

export interface AppNotification {
	id: number;
	kind: NotificationKind;
	/** Short, user-facing, already translated. */
	message: string;
	/** Optional technical detail (mpv error string, MEGAcmd stderr...). */
	detail?: string;
	persistent: boolean;
	durationMs: number;
	createdAt: number;
}

export interface NotifyOptions {
	detail?: string;
	/** Defaults to true for 'error', false otherwise. */
	persistent?: boolean;
	/** Only used when not persistent. */
	durationMs?: number;
}

const DEFAULT_DURATION_MS = 2000;

const queue = writable<AppNotification[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

export const notifications: Readable<AppNotification[]> = { subscribe: queue.subscribe };

/** Push a notification. Returns its id so callers can dismiss it early. */
export function notify(kind: NotificationKind, message: string, options: NotifyOptions = {}): number {
	const persistent = options.persistent ?? kind === 'error';
	const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;

	// Collapse identical persistent errors: a retry loop must not stack ten
	// copies of "could not play this video".
	let existingId: number | null = null;
	if (persistent) {
		queue.update((items) => {
			const dup = items.find(
				(n) => n.persistent && n.kind === kind && n.message === message && n.detail === options.detail
			);
			if (dup) existingId = dup.id;
			return items;
		});
		if (existingId !== null) return existingId;
	}

	const id = nextId++;
	const item: AppNotification = {
		id,
		kind,
		message,
		detail: options.detail,
		persistent,
		durationMs,
		createdAt: Date.now(),
	};
	queue.update((items) => [...items, item]);

	if (!persistent) {
		timers.set(id, setTimeout(() => dismiss(id), durationMs));
	}
	return id;
}

export function dismiss(id: number): void {
	const timer = timers.get(id);
	if (timer) {
		clearTimeout(timer);
		timers.delete(id);
	}
	queue.update((items) => items.filter((n) => n.id !== id));
}

export function clearNotifications(): void {
	for (const timer of timers.values()) clearTimeout(timer);
	timers.clear();
	queue.set([]);
}
