<script lang="ts">
	import { currentTime, duration } from '$lib/stores/player';
	import { seekAbsolute } from '$lib/services/player-service';
	import { pokeUiActivity } from '$lib/stores/player-ui';
	import { t } from '$lib/i18n';

	let {
		// ABSOLUTE timeline position, in seconds, up to which media is buffered —
		// i.e. where the faint "loaded" segment ends. Fed from the `bufferedUntil`
		// store, which derives it from mpv's `demuxer-cache-time`. Null (or 0)
		// while nothing is known, and the layer then simply doesn't render, so it
		// can never lie about progress.
		bufferedSeconds = null,
		// Bound by the overlay: a drag in progress must cancel the auto-hide timer.
		scrubbing = $bindable(false),
	}: { bufferedSeconds?: number | null; scrubbing?: boolean } = $props();

	let trackEl = $state<HTMLDivElement | null>(null);

	// Local scrub position. While dragging we deliberately do NOT seek: the old
	// bar fired an absolute seek from `oninput`, i.e. one HTTP range request per
	// pixel, which over the MEGAcmd WebDAV server is a request storm that leaves
	// mpv re-buffering for seconds after the drag ends. We commit once, on release.
	let scrubFraction = $state(0);
	// Fraction under the pointer while merely hovering, for the time tooltip.
	let hoverFraction = $state<number | null>(null);

	const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

	let dur = $derived($duration ?? 0);
	let liveFraction = $derived(dur > 0 && $currentTime != null ? clamp($currentTime / dur) : 0);
	let fraction = $derived(scrubbing ? scrubFraction : liveFraction);
	let displayedSeconds = $derived(fraction * dur);
	let remainingSeconds = $derived(Math.max(dur - displayedSeconds, 0));
	let bufferedFraction = $derived(
		bufferedSeconds != null && dur > 0 ? clamp(bufferedSeconds / dur) : 0,
	);
	let hoverSeconds = $derived(hoverFraction != null ? hoverFraction * dur : null);

	function formatTime(seconds: number | null): string {
		if (seconds == null || !isFinite(seconds)) return '--:--';
		const total = Math.max(Math.floor(seconds), 0);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
		return h > 0
			? `${h}:${mm}:${String(s).padStart(2, '0')}`
			: `${mm}:${String(s).padStart(2, '0')}`;
	}

	function fractionFromEvent(e: PointerEvent): number {
		if (!trackEl) return 0;
		const rect = trackEl.getBoundingClientRect();
		if (rect.width <= 0) return 0;
		return clamp((e.clientX - rect.left) / rect.width);
	}

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0 || dur <= 0) return;
		// Pointer capture keeps the drag alive when the cursor leaves the (thin)
		// bar, which happens constantly with a 4 px track.
		trackEl?.setPointerCapture(e.pointerId);
		scrubbing = true;
		scrubFraction = fractionFromEvent(e);
		pokeUiActivity();
		e.preventDefault();
	}

	function handlePointerMove(e: PointerEvent) {
		hoverFraction = fractionFromEvent(e);
		if (!scrubbing) return;
		scrubFraction = hoverFraction;
		pokeUiActivity();
	}

	function handlePointerUp(e: PointerEvent) {
		if (!scrubbing) return;
		scrubbing = false;
		if (trackEl?.hasPointerCapture(e.pointerId)) trackEl.releasePointerCapture(e.pointerId);
		commit(fractionFromEvent(e));
	}

	function handlePointerCancel() {
		// Drag aborted (window lost focus, gesture cancelled): drop the local
		// position and snap back to mpv's truth without seeking anywhere.
		scrubbing = false;
	}

	function commit(next: number) {
		if (dur <= 0) return;
		scrubFraction = clamp(next);
		seekAbsolute(scrubFraction * dur);
		pokeUiActivity();
	}

	// Keyboard support for the bar itself. It stops propagation for the keys it
	// handles so the overlay's global shortcut handler doesn't seek a second time.
	function handleKeydown(e: KeyboardEvent) {
		if (dur <= 0) return;
		const step = e.shiftKey ? 1 : 5;
		let target: number | null = null;
		if (e.key === 'ArrowLeft') target = (fraction * dur - step) / dur;
		else if (e.key === 'ArrowRight') target = (fraction * dur + step) / dur;
		else if (e.key === 'Home') target = 0;
		else if (e.key === 'End') target = 1;
		if (target == null) return;
		e.preventDefault();
		e.stopPropagation();
		commit(target);
	}
</script>

<div class="seek-row">
	<span class="time-label">{formatTime(displayedSeconds)}</span>

	<div
		class="seek-track"
		class:scrubbing
		bind:this={trackEl}
		role="slider"
		tabindex="0"
		aria-label={$t['player.seek']}
		aria-valuemin={0}
		aria-valuemax={Math.max(Math.floor(dur), 0)}
		aria-valuenow={Math.floor(displayedSeconds)}
		aria-valuetext={formatTime(displayedSeconds)}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onpointerleave={() => (hoverFraction = null)}
		onkeydown={handleKeydown}
	>
		<div class="seek-rail">
			<!-- "Loaded up to here": a faint segment running from the start of the
			     file to the end of mpv's demuxer cache, so the part past the
			     playhead reads as "already downloaded". Painted BEFORE .seek-played
			     so the progress bar covers the stretch behind the playhead and only
			     the lead is visible. Renders only once a buffer extent is known. -->
			{#if bufferedFraction > 0}
				<div class="seek-buffered" style="width: {bufferedFraction * 100}%"></div>
			{/if}
			<div class="seek-played" style="width: {fraction * 100}%"></div>
			<div class="seek-thumb" style="left: {fraction * 100}%"></div>
		</div>

		{#if hoverSeconds != null && dur > 0}
			<div class="seek-tooltip" style="left: {(hoverFraction ?? 0) * 100}%">
				{formatTime(hoverSeconds)}
			</div>
		{/if}
	</div>

	<span class="time-label">-{formatTime(remainingSeconds)}</span>
</div>

<style>
	.seek-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
	}

	.time-label {
		color: var(--ov-text-dim);
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		min-width: 56px;
		text-align: center;
		user-select: none;
	}

	/* The hit area is deliberately much taller than the visible rail: a 4 px
	   target is unusable, and on macOS this element now really does receive the
	   mouse over the video. */
	.seek-track {
		position: relative;
		flex: 1;
		height: 18px;
		display: flex;
		align-items: center;
		cursor: pointer;
		touch-action: none;
		outline: none;
	}

	.seek-rail {
		position: relative;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: var(--ov-rail);
		transition: height 0.12s ease;
	}

	.seek-track:hover .seek-rail,
	.seek-track:focus-visible .seek-rail,
	.seek-track.scrubbing .seek-rail {
		height: 6px;
	}

	.seek-buffered,
	.seek-played {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		border-radius: inherit;
	}

	.seek-buffered {
		background: var(--ov-rail-buffered);
	}

	.seek-played {
		background: var(--accent);
	}

	.seek-thumb {
		position: absolute;
		top: 50%;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: var(--accent);
		transform: translate(-50%, -50%) scale(0);
		transition: transform 0.12s ease;
	}

	.seek-track:hover .seek-thumb,
	.seek-track:focus-visible .seek-thumb,
	.seek-track.scrubbing .seek-thumb {
		transform: translate(-50%, -50%) scale(1);
	}

	.seek-tooltip {
		position: absolute;
		bottom: 22px;
		transform: translateX(-50%);
		padding: 2px 6px;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.8);
		color: #fff;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		white-space: nowrap;
	}
</style>
