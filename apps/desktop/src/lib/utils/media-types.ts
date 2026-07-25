// Pure file-name based media type predicates.
//
// These only look at the file extension, so they work identically for Mega
// remote entries and for local filesystem entries.

export const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.webm', '.mov', '.flv', '.wmv', '.m4v', '.ts'];

export const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt', '.sub'];

export function isVideo(name: string): boolean {
	const lower = name.toLowerCase();
	return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isAudio(name: string): boolean {
	return /\.(mp3|flac|ogg|wav|aac|m4a)$/i.test(name);
}

export function isImage(name: string): boolean {
	return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
}

export function isSubtitle(name: string): boolean {
	const lower = name.toLowerCase();
	return SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
