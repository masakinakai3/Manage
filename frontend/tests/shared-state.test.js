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

    it('provides March-based first-half and second-half windows', () => {
        expect(getPresetConfig('first-half')).toEqual({
            startMonth: '2026-03',
            rangeMonths: 6,
            bucketMonths: 1,
            scale: 1,
            visibleCount: 6,
        });
        expect(getPresetConfig('second-half')).toEqual({
            startMonth: '2026-09',
            rangeMonths: 6,
            bucketMonths: 1,
            scale: 1,
            visibleCount: 6,
        });
    });

    it('keeps January and February in the half-year cycle that began the previous March', () => {
        vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));

        expect(getPresetConfig('first-half').startMonth).toBe('2025-03');
        expect(getPresetConfig('second-half').startMonth).toBe('2025-09');
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

    it('migrates a legacy single gantt status to the multi-select representation', () => {
        expect(migrateViewState({ ganttStatus: 'active' })).toMatchObject({
            ganttStatus: ['active'],
        });
        expect(migrateViewState({ ganttStatus: ['planning', 'active'] })).toMatchObject({
            ganttStatus: ['planning', 'active'],
        });
    });
});
