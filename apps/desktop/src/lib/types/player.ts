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

export interface PlaylistItem {
	megaPath: string;
	name: string;
}
