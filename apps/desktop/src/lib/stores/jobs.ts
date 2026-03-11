import { writable, derived } from 'svelte/store';
import type { ProcessingJob } from '$lib/types/pipeline';

export const jobs = writable<ProcessingJob[]>([]);

export const activeJobCount = derived(
	jobs,
	($jobs) => $jobs.filter((j) => j.status === 'processing').length
);

export const queuedJobCount = derived(
	jobs,
	($jobs) => $jobs.filter((j) => j.status === 'queued').length
);
