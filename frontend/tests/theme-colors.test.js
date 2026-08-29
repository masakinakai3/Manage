import { describe, expect, it } from 'vitest';

import { THEME_COLORS, normalizeThemeColor, summarizeThemeColorUsage } from '../js/theme-colors.js';

describe('THEME_COLORS', () => {
    it('provides 32 unique six-digit hex colors', () => {
        expect(THEME_COLORS).toHaveLength(32);
        expect(new Set(THEME_COLORS)).toHaveLength(32);
        THEME_COLORS.forEach((color) => expect(color).toMatch(/^#[0-9a-f]{6}$/i));
    });

    it('keeps the existing default color first', () => {
        expect(THEME_COLORS[0]).toBe('#6366f1');
    });

    it('normalizes valid colors for selection matching', () => {
        expect(normalizeThemeColor(' #6366F1 ')).toBe('#6366f1');
        expect(normalizeThemeColor('invalid')).toBe(THEME_COLORS[0]);
    });

    it('counts every theme using the same color, including case variants', () => {
        const usage = summarizeThemeColorUsage([
            { name: 'テーマA', color: '#6366f1' },
            { name: 'テーマB', color: '#6366F1' },
            { name: 'テーマC', color: '#8b5cf6' },
            { name: '無効色', color: 'invalid' },
        ]);

        expect(usage['#6366f1']).toEqual(['テーマA', 'テーマB']);
        expect(usage['#8b5cf6']).toEqual(['テーマC']);
        expect(Object.values(usage).flat()).not.toContain('無効色');
    });
});
