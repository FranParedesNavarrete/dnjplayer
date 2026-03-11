export interface VideoAdjustments {
	brightness: number;
	contrast: number;
	saturation: number;
	gamma: number;
	hue: number;
	deband: boolean;
	deinterlace: boolean;
}

export interface VideoProfile {
	id: string;
	name: string;
	brightness: number;
	contrast: number;
	saturation: number;
	gamma: number;
	hue: number;
	deband: boolean;
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
