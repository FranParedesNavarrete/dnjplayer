// Digit keyboard shortcuts, resolved from the PHYSICAL key.
//
// The overlay used to match these on the produced CHARACTER: `case '!'`,
// `case '@'`, `case '#'`, `case ')'` for the Anime4K modes, i.e. Shift+1/2/3/0
// — but only on a US layout. On "Spanish - ISO", which is what this app's user
// actually types on, Shift+2 is `"`, Shift+3 is `·` and Shift+0 is `=`, so
// modes B and C and the "off" switch were simply unreachable. (The pattern
// predates the overlay: the deleted PlayerControls.svelte had it too.)
//
// `KeyboardEvent.code` names the key by its position on the board, not by what
// the active layout prints on it, so `Digit2` is the second key of the number
// row on every layout. Combined with `event.shiftKey` it gives the intent
// "Shift plus the 2 key" independently of locale, which is what the shortcut
// always meant.
//
// All the digit shortcuts go through here, shifted or not, rather than only the
// broken ones: mixing "these digits by character, those by key" is precisely
// the kind of split that let the bug hide for two years.
//
// Only the number ROW is bound (`Digit0`..`Digit9`). The keypad (`Numpad2`) is
// left out on purpose — it was never reachable before either (Shift+keypad
// depends on Num Lock and on the OS), so binding it now would be a new feature
// smuggled in as a bug fix.

import type { ShaderMode } from '$lib/types/player';

/** A video adjustment nudged by a fixed step. */
export interface AdjustAction {
	kind: 'adjust';
	/** mpv property name, which is also the store name in stores/player.ts. */
	property: 'contrast' | 'brightness' | 'saturation';
	/** Signed step to add to the current value. */
	delta: number;
}

/** An Anime4K preset switch. */
export interface ShaderAction {
	kind: 'shader';
	mode: ShaderMode;
}

export type DigitAction = AdjustAction | ShaderAction;

/** Step used by every image adjustment shortcut. */
export const ADJUST_STEP = 5;

// Unshifted number row: image adjustments (the pairs are "down, up").
const PLAIN: Record<string, AdjustAction> = {
	Digit1: { kind: 'adjust', property: 'contrast', delta: -ADJUST_STEP },
	Digit2: { kind: 'adjust', property: 'contrast', delta: ADJUST_STEP },
	// Note the order: 3 brightens and 4 darkens. Inherited from the previous
	// bar's bindings and kept so existing muscle memory still works.
	Digit3: { kind: 'adjust', property: 'brightness', delta: ADJUST_STEP },
	Digit4: { kind: 'adjust', property: 'brightness', delta: -ADJUST_STEP },
	Digit7: { kind: 'adjust', property: 'saturation', delta: -ADJUST_STEP },
	Digit8: { kind: 'adjust', property: 'saturation', delta: ADJUST_STEP },
};

// Shifted number row: Anime4K presets.
const SHIFTED: Record<string, ShaderAction> = {
	Digit1: { kind: 'shader', mode: 'A' },
	Digit2: { kind: 'shader', mode: 'B' },
	Digit3: { kind: 'shader', mode: 'C' },
	Digit0: { kind: 'shader', mode: 'off' },
};

/**
 * Resolve a number-row key press to the action it should trigger, or null if
 * that combination is not bound.
 *
 * @param code   `KeyboardEvent.code` — layout independent, e.g. `'Digit2'`
 * @param shift  `KeyboardEvent.shiftKey`
 */
export function digitShortcut(code: string, shift: boolean): DigitAction | null {
	return (shift ? SHIFTED[code] : PLAIN[code]) ?? null;
}

/**
 * Whether `code` is a number-row key at all.
 *
 * The caller needs this to tell "a digit that is bound" from "a digit that is
 * not": an unbound digit (Shift+5) must be swallowed as a handled-but-inert
 * key rather than falling through to the character-based switch, where on some
 * layout its character could collide with an unrelated letter shortcut.
 */
export function isDigitRowKey(code: string): boolean {
	return /^Digit[0-9]$/.test(code);
}
