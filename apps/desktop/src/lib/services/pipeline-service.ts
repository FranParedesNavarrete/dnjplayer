import { invoke } from '@tauri-apps/api/core';
import type { ProcessingJob } from '$lib/types/pipeline';

export async function submitJob(
	megaRemotePath: string,
	targetResolution: string,
	shaderMode: string
): Promise<string> {
	return invoke('submit_job', { megaRemotePath, targetResolution, shaderMode });
}

export async function getJobs(): Promise<ProcessingJob[]> {
	return invoke('get_jobs');
}

export async function cancelJob(jobId: string): Promise<void> {
	return invoke('cancel_job', { jobId });
}
