import { describe, expect, it } from 'vitest';

import { THEME_COLORS } from '../js/theme-colors.js';

describe('THEME_COLORS', () => {
    it('provides 32 unique six-digit hex colors', () => {
        expect(THEME_COLORS).toHaveLength(32);
        expect(new Set(THEME_COLORS)).toHaveLength(32);
        THEME_COLORS.forEach((color) => expect(color).toMatch(/^#[0-9a-f]{6}$/i));
    });

    it('keeps the existing default color first', () => {
        expect(THEME_COLORS[0]).toBe('#6366f1');
    });
});
