// Cross-platform path helpers for the LOCAL filesystem browser.
//
// The frontend never knows which OS it runs on, and the paths it receives come
// verbatim from Rust: `/Volumes/Disk/Movies` on macOS/Linux, `C:\Videos` or
// `\\server\share\Videos` on Windows. So the separator is derived from the
// shape of the path itself instead of being assumed.

/** `C:\...`, `C:/...` or a UNC path (`\\server\share`). */
function isWindowsPath(path: string): boolean {
	return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/** `C:` / `c:` — a bare drive designator, which is NOT a valid root on its own. */
function isDriveDesignator(segment: string): boolean {
	return /^[a-zA-Z]:$/.test(segment);
}

/** Drop trailing separators so `/a/b/` and `/a/b` behave the same. */
function stripTrailingSeparators(path: string): string {
	return path.replace(/[\\/]+$/, '');
}

/**
 * The folder containing `path`, or `null` when `path` is already a root and
 * there is nowhere left to go up to.
 *
 * Roots that return `null`:
 * - POSIX: `/`
 * - Windows drives: `C:\` (also `C:/`)
 * - Windows UNC shares: `\\server\share`
 *
 * Note the Windows subtlety: the parent of `C:\Videos` must be `C:\`, never a
 * bare `C:` — that form is drive-RELATIVE (the drive's current directory), not
 * the drive root, and would resolve to the wrong folder.
 */
export function parentPath(path: string): string | null {
	const trimmed = stripTrailingSeparators(path);

	if (isWindowsPath(path)) {
		// `C:\` was trimmed down to `C:` -> we were at the drive root.
		if (isDriveDesignator(trimmed)) return null;

		if (path.startsWith('\\\\')) {
			// UNC: `\\server\share\a\b`. The first two segments (server + share)
			// form the root and cannot be climbed past.
			const segments = trimmed.slice(2).split(/[\\/]+/).filter(Boolean);
			if (segments.length <= 2) return null;
			return `\\\\${segments.slice(0, -1).join('\\')}`;
		}

		const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
		if (cut < 0) return null; // relative path with a single segment
		const parent = trimmed.slice(0, cut);
		return isDriveDesignator(parent) ? `${parent}\\` : parent;
	}

	if (trimmed === '') return null; // `/` (or an empty string)
	const cut = trimmed.lastIndexOf('/');
	if (cut < 0) return null; // relative path with a single segment
	return cut === 0 ? '/' : trimmed.slice(0, cut);
}

/**
 * Last component of a path, used as the default label for a saved folder.
 * Falls back to the whole path for roots that have no component (`/`, `C:\`).
 */
export function baseName(path: string): string {
	const trimmed = stripTrailingSeparators(path);
	const segments = trimmed.split(/[\\/]+/).filter(Boolean);
	return segments[segments.length - 1] ?? (trimmed || path);
}
