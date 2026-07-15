// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresetConfig } from '../js/shared-state.js';

describe('shared view presets', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('provides focused quarter and 24-month observation windows', () => {
        expect(getPresetConfig('current-quarter')).toEqual({
            startMonth: '2026-07',
            scale: 1,
            visibleCount: 3,
        });
        expect(getPresetConfig('rolling-24')).toEqual({
            startMonth: '2026-06',
            scale: 1,
            visibleCount: 26,
        });
    });
});
