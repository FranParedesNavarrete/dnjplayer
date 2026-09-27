import { describe, expect, it } from 'vitest';
import { ADJUST_STEP, digitShortcut, isDigitRowKey } from './shortcuts';

describe('digitShortcut — Anime4K presets (Shift + number row)', () => {
	// The bug this module exists for: these were matched on the produced
	// character ('!', '@', '#', ')'), i.e. Shift+1/2/3/0 on a US layout only. On
	// Spanish ISO Shift+2 is '"' and Shift+0 is '=', so B, C and "off" were
	// unreachable. `code` is the physical key, so the layout is irrelevant.
	it('maps Shift + 1/2/3 to modes A/B/C', () => {
		expect(digitShortcut('Digit1', true)).toEqual({ kind: 'shader', mode: 'A' });
		expect(digitShortcut('Digit2', true)).toEqual({ kind: 'shader', mode: 'B' });
		expect(digitShortcut('Digit3', true)).toEqual({ kind: 'shader', mode: 'C' });
	});

	it('maps Shift + 0 to "off"', () => {
		expect(digitShortcut('Digit0', true)).toEqual({ kind: 'shader', mode: 'off' });
	});

	it('leaves the other shifted digits unbound', () => {
		for (const d of [4, 5, 6, 7, 8, 9]) {
			expect(digitShortcut(`Digit${d}`, true)).toBeNull();
		}
	});
});

describe('digitShortcut — image adjustments (plain number row)', () => {
	it('maps 1/2 to contrast down/up', () => {
		expect(digitShortcut('Digit1', false)).toEqual({
			kind: 'adjust',
			property: 'contrast',
			delta: -ADJUST_STEP,
		});
		expect(digitShortcut('Digit2', false)).toEqual({
			kind: 'adjust',
			property: 'contrast',
			delta: ADJUST_STEP,
		});
	});

	// Kept in the inherited order (3 brightens, 4 darkens) so existing muscle
	// memory keeps working; asserted so a future "tidy-up" can't quietly swap it.
	it('maps 3/4 to brightness up/down, in that order', () => {
		expect(digitShortcut('Digit3', false)).toEqual({
			kind: 'adjust',
			property: 'brightness',
			delta: ADJUST_STEP,
		});
		expect(digitShortcut('Digit4', false)).toEqual({
			kind: 'adjust',
			property: 'brightness',
			delta: -ADJUST_STEP,
		});
	});

	it('maps 7/8 to saturation down/up', () => {
		expect(digitShortcut('Digit7', false)).toEqual({
			kind: 'adjust',
			property: 'saturation',
			delta: -ADJUST_STEP,
		});
		expect(digitShortcut('Digit8', false)).toEqual({
			kind: 'adjust',
			property: 'saturation',
			delta: ADJUST_STEP,
		});
	});

	it('leaves 0/5/6/9 unbound', () => {
		for (const d of [0, 5, 6, 9]) {
			expect(digitShortcut(`Digit${d}`, false)).toBeNull();
		}
	});
});

describe('digitShortcut — non-digit and keypad codes', () => {
	it('ignores letters, arrows and anything that is not the number row', () => {
		for (const code of ['KeyA', 'Space', 'ArrowLeft', 'BracketLeft', 'Escape', '']) {
			expect(digitShortcut(code, false)).toBeNull();
			expect(digitShortcut(code, true)).toBeNull();
		}
	});

	// Deliberate: Shift+keypad depends on Num Lock and on the OS, and the keypad
	// was never reachable through the old character matching either.
	it('ignores the numeric keypad', () => {
		expect(digitShortcut('Numpad1', false)).toBeNull();
		expect(digitShortcut('Numpad2', true)).toBeNull();
	});

	it('is not fooled by the characters the old implementation matched', () => {
		for (const ch of ['!', '@', '#', ')', '1', '2', '"', '·', '=']) {
			expect(digitShortcut(ch, false)).toBeNull();
			expect(digitShortcut(ch, true)).toBeNull();
		}
	});
});

describe('isDigitRowKey', () => {
	it('accepts every number-row key', () => {
		for (let d = 0; d <= 9; d++) expect(isDigitRowKey(`Digit${d}`)).toBe(true);
	});

	it('rejects the keypad, letters and lookalikes', () => {
		for (const code of ['Numpad1', 'KeyA', 'Digit', 'Digit10', 'digit1', '1', '']) {
			expect(isDigitRowKey(code)).toBe(false);
		}
	});

	// The caller swallows every number-row key so an unbound digit cannot fall
	// through to the character switch, where its character on some layout could
	// collide with a letter shortcut.
	it('covers keys that have no action, so the caller can still swallow them', () => {
		expect(isDigitRowKey('Digit5')).toBe(true);
		expect(digitShortcut('Digit5', false)).toBeNull();
	});
});
