export interface VideoAdjustments {
	brightness: number;
	contrast: number;
	saturation: number;
	gamma: number;
	hue: number;
}

export interface LibraryItem {
	id: string;
	title: string;
	mega_remote_path: string;
	local_cached_path: string | null;
	duration_seconds: number | null;
	source_resolution: string | null;
	processed_resolution: string | null;
	playback_position: number;
	added_at: string;
	video_adjustments_json: string | null;
}

export type ShaderMode = 'A' | 'B' | 'C' | 'off';
export type ShaderVariant = 'S' | 'M' | 'L' | 'VL' | 'UL';

/** Where a playable item lives: the Mega cloud drive or the local filesystem. */
export type MediaSource = 'mega' | 'local';

/**
 * A single audio/video/subtitle stream as reported by mpv's `track-list`.
 * Mirrors the subset of mpv fields the UI needs; `id` is mpv's 1-based track id
 * and is what gets written back to the `aid`/`sid` properties.
 */
export interface MediaTrack {
	id: number; // mpv track id, base 1
	type: 'video' | 'audio' | 'sub';
	title?: string;
	lang?: string;
	codec?: string;
	selected: boolean;
	external: boolean;
	default: boolean;
	forced: boolean;
}

export interface PlaylistItem {
	source: MediaSource;
	/**
	 * For `mega`: the remote Mega path (e.g. `/Movies/a.mkv`).
	 * For `local`: the absolute filesystem path (e.g. `/Volumes/Disk/a.mkv`,
	 * `C:\Videos\a.mkv`).
	 */
	path: string;
	name: string;
}
