// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresetConfig, loadViewState, migrateViewState, subscribeViewState, updateViewState } from '../js/shared-state.js';

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
            rangeMonths: 3,
            bucketMonths: 1,
            scale: 1,
            visibleCount: 3,
        });
        expect(getPresetConfig('rolling-24')).toEqual({
            startMonth: '2026-06',
            rangeMonths: 26,
            bucketMonths: 1,
            scale: 1,
            visibleCount: 26,
        });
    });

    it('migrates v1 state without expanding the real period', () => {
        expect(migrateViewState({ scale: 3, visibleCount: 8 })).toMatchObject({
            stateVersion: 2,
            rangeMonths: 24,
            bucketMonths: 3,
            scale: 3,
            visibleCount: 8,
        });
    });

    it('keeps range and bucket independent and reports changed keys', () => {
        localStorage.clear();
        const handler = vi.fn();
        const unsubscribe = subscribeViewState(handler);

        updateViewState({ bucketMonths: 3 }, { source: 'test' });

        expect(loadViewState()).toMatchObject({ rangeMonths: 8, bucketMonths: 3, scale: 3, visibleCount: 3 });
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ rangeMonths: 8, bucketMonths: 3 }),
            expect.objectContaining({ changedKeys: expect.arrayContaining(['bucketMonths', 'scale', 'visibleCount']), source: 'test' }),
        );
        unsubscribe();
    });
});
