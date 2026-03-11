export interface ProcessingJob {
	id: string;
	library_id: string | null;
	mega_remote_path: string;
	target_resolution: string;
	shader_mode: string;
	status: 'queued' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';
	progress: number;
	output_path: string | null;
	docker_container_id: string | null;
	error_message: string | null;
	created_at: string;
	started_at: string | null;
	completed_at: string | null;
}
