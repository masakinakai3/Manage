import { describe, expect, it } from 'vitest';
import { filterAndSortThemes, summarizeThemeStatuses } from '../js/theme-list-utils.js';

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
});
