import { describe, expect, it } from 'vitest';
import { filterAndSortThemes, getThemeCategoryTone, summarizeThemeStatuses } from '../js/theme-list-utils.js';

const themes = [
    { name: 'Core Renewal', category: 'Platform', status: 'active', priority: 9, member_count: 2 },
    { name: 'Data Cleanup', category: 'Ops', status: 'planning', priority: 6, member_count: 3 },
    { name: 'Legacy Theme', category: '', status: 'done', priority: 0, member_count: 1 },
];

const filters = {
    search: '',
    status: '',
    category: '',
    sort: 'name-asc',
    statusLabels: { active: '進行中', planning: '計画中', done: '完了' },
};

describe('theme list filtering and summaries', () => {
    it('combines search, category and status filters without mutating the source list', () => {
        const sourceOrder = themes.map((theme) => theme.name);
        const result = filterAndSortThemes(themes, {
            ...filters,
            search: 'core',
            status: 'active',
            category: 'Platform',
        });

        expect(result.map((theme) => theme.name)).toEqual(['Core Renewal']);
        expect(themes.map((theme) => theme.name)).toEqual(sourceOrder);
    });

    it('treats legacy done themes as completed and sorts by priority', () => {
        const completed = filterAndSortThemes(themes, { ...filters, status: 'completed' });
        const priorityOrder = filterAndSortThemes(themes, { ...filters, sort: 'priority-desc' });

        expect(completed.map((theme) => theme.name)).toEqual(['Legacy Theme']);
        expect(priorityOrder.map((theme) => theme.name)).toEqual(['Core Renewal', 'Data Cleanup', 'Legacy Theme']);
        expect(summarizeThemeStatuses(themes)).toEqual({ active: 1, planning: 1, completed: 1 });
    });

    it('sorts by category, then theme name, with uncategorized themes last', () => {
        const categoryOrder = filterAndSortThemes([
            ...themes,
            { name: 'API Renewal', category: 'Platform', status: 'active' },
        ], { ...filters, sort: 'category-asc' });

        expect(categoryOrder.map((theme) => theme.name)).toEqual([
            'Data Cleanup',
            'API Renewal',
            'Core Renewal',
            'Legacy Theme',
        ]);
    });

    it('assigns a stable category tone including themes without a category', () => {
        expect(getThemeCategoryTone('Platform')).toBe(getThemeCategoryTone('Platform'));
        expect(getThemeCategoryTone('')).toBe(getThemeCategoryTone(null));
        expect(getThemeCategoryTone('Platform')).toBeGreaterThanOrEqual(1);
        expect(getThemeCategoryTone('Platform')).toBeLessThanOrEqual(6);
    });

    it('filters and sorts a 1000-row management fixture within the UI budget', () => {
        const largeFixture = Array.from({ length: 1000 }, (_, index) => ({
            name: `テーマ ${String(index).padStart(4, '0')}`,
            category: index % 3 === 0 ? '基盤' : '製品',
            status: index % 4 === 0 ? 'completed' : 'active',
            priority: index % 10,
            member_count: index % 12,
        }));
        const startedAt = performance.now();
        const result = filterAndSortThemes(largeFixture, { ...filters, search: 'テーマ', sort: 'category-asc' });
        const elapsed = performance.now() - startedAt;

        expect(result).toHaveLength(1000);
        expect(elapsed).toBeLessThan(250);
    });
});
