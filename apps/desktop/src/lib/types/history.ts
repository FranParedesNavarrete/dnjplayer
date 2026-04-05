export interface HistoryEntry {
	mega_path: string;
	filename: string;
	watched_at: string;
	play_count: number;
}

export interface FavoriteEntry {
	mega_path: string;
	filename: string;
	entry_type: 'file' | 'folder';
	favorited_at: string;
}
