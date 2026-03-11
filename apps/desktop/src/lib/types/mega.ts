export interface MegaEntry {
	name: string;
	path: string;
	size: string;
	entry_type: 'file' | 'folder';
}

export interface MegaUser {
	email: string;
	name: string;
}

export interface MegaStatus {
	installed: boolean;
	server_running: boolean;
	logged_in: boolean;
	email: string | null;
}

export interface MegaShare {
	name: string;
	path: string;
	owner: string;
	access: string;
}
