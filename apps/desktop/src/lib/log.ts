/**
 * Logging bridge: forwards messages to both browser console AND Rust terminal.
 * On macOS, WKWebView's console.log does NOT appear in `pnpm tauri dev` output,
 * so we invoke a Tauri command to print from the Rust side.
 */
import { invoke } from '@tauri-apps/api/core';

function send(level: string, ...args: unknown[]): void {
	const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');

	// Always log to browser console too (visible in Safari/Chrome DevTools)
	switch (level) {
		case 'error':
			console.error(msg);
			break;
		case 'warn':
			console.warn(msg);
			break;
		case 'debug':
			console.debug(msg);
			break;
		default:
			console.log(msg);
			break;
	}

	// Forward to Rust terminal (fire-and-forget, never block on this)
	invoke('js_log', { level, msg }).catch(() => {
		// Silently ignore — may fail during early init before Tauri is ready
	});
}

export const log = {
	info: (...args: unknown[]) => send('info', ...args),
	warn: (...args: unknown[]) => send('warn', ...args),
	error: (...args: unknown[]) => send('error', ...args),
	debug: (...args: unknown[]) => send('debug', ...args),
};
