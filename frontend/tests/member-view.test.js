// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const openCellEditor = vi.fn();
const setBusyState = vi.fn();
const setSaveState = vi.fn();
const showToast = vi.fn();
const formatError = vi.fn((error) => error.message);

let visibleMonths = ['2026-04'];
let allocationsList = [{
    theme_id: 1,
    member_id: 10,
    month: '2026-04',
    allocation_rate: 20,
    memo: '',
}];

const membersList = vi.fn(async () => ([{
    member_id: 10,
    display_name: 'Alice',
    department: 'Dev',
    capacity: 100,
}]));
const themesList = vi.fn(async () => ([{
    theme_id: 1,
    name: 'Theme A',
    color: '#00aaff',
    category: 'Delivery',
    status: 'active',
    dev_complete_month: '2026-04',
    dev_complete_months: [{ month: '2026-04', is_completed: true }],
    milestones: [
        { month: '2026-04', label: 'Release', is_completed: false },
        { month: '2026-05', label: 'Review', is_completed: true },
    ],
}]));
const memberLoads = vi.fn(async () => ({ 10: { '2026-04': 20, '2026-05': 30 } }));
const warnings = vi.fn(async () => ([]));
const allocationsApiList = vi.fn(async () => allocationsList);

vi.mock('../js/gantt/gantt-editor.js', () => ({
    openCellEditor,
}));

vi.mock('../js/ui.js', () => ({
    formatError,
    setBusyState,
    setSaveState,
    showToast,
}));

vi.mock('../js/shared-state.js', () => ({
    getPresetConfig: vi.fn(() => ({ startMonth: '2026-04', scale: 1 })),
    loadViewState: vi.fn(() => ({
        startMonth: '2026-04',
        scale: 1,
        memberSearch: '',
        preset: 'rolling-6',
    })),
    subscribeViewState: vi.fn(() => () => {}),
    updateViewState: vi.fn(),
}));

vi.mock('../js/utils/date-utils.js', () => ({
    currentMonth: vi.fn(() => '2026-04'),
    getVisibleMonths: vi.fn(() => visibleMonths),
    formatMonthHeader: vi.fn((month) => month),
    addMonths: vi.fn((month, delta = 0) => {
        const [year, value] = month.split('-').map(Number);
        const next = new Date(year, value - 1 + delta, 1);
        return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    }),
    aggregateRate: vi.fn((ratesByMonth, periodStart, scale) => {
        if (scale === 1) return ratesByMonth?.[periodStart] || 0;
        const months = [];
        let current = periodStart;
        for (let index = 0; index < scale; index += 1) {
            months.push(current);
            const [year, value] = current.split('-').map(Number);
            const next = new Date(year, value, 1);
            current = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
        }
        const rates = months.map((month) => ratesByMonth?.[month] || 0).filter((rate) => rate > 0);
        if (rates.length === 0) return 0;
        return Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length);
    }),
    shortenMonth: vi.fn((month) => month),
}));

vi.mock('../js/api.js', () => ({
    allocations: {
        memberLoads,
        warnings,
        list: allocationsApiList,
    },
    members: {
        list: membersList,
    },
    themes: {
        list: themesList,
    },
}));

function renderBaseDom() {
    document.body.innerHTML = `
        <div id="member-scale-switcher">
            <button class="scale-btn active" data-scale="1" type="button">1</button>
            <button class="scale-btn" data-scale="3" type="button">3</button>
        </div>
        <input id="member-search" type="text">
        <button id="member-prev" type="button"></button>
        <button id="member-next" type="button"></button>
        <button id="member-today" type="button"></button>
        <select id="member-period-preset"><option value="rolling-6" selected>rolling-6</option></select>
        <section id="member-load-summary"></section>
        <table>
            <thead id="member-load-thead"></thead>
            <tbody id="member-load-tbody"></tbody>
        </table>
    `;
}

describe('member-view milestones', () => {
    beforeEach(() => {
        vi.resetModules();
        renderBaseDom();
        visibleMonths = ['2026-04'];
        allocationsList = [{
            theme_id: 1,
            member_id: 10,
            month: '2026-04',
            allocation_rate: 20,
            memo: '',
        }];
        openCellEditor.mockClear();
        setBusyState.mockClear();
        setSaveState.mockClear();
        showToast.mockClear();
        membersList.mockClear();
        themesList.mockClear();
        memberLoads.mockClear();
        warnings.mockClear();
        allocationsApiList.mockClear();
    });

    it('renders theme-row milestones for matching months', async () => {
        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        const toggle = document.querySelector('.toggle-btn');
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const milestones = Array.from(document.querySelectorAll('.member-theme-cell .member-theme-milestone'));
        expect(milestones).toHaveLength(1);
        expect(milestones[0].textContent).toBe('Release');
    });

    it('renders dev-complete marker for the matching month', async () => {
        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        const toggle = document.querySelector('.toggle-btn');
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const marker = document.querySelector('.member-theme-cell .member-theme-dev-complete');
        expect(marker).not.toBeNull();
        expect(marker?.textContent).toBe('★20%');
        expect(marker?.classList.contains('completed')).toBe(true);
    });

    it('renders milestone badges for aggregated periods in the matching bucket', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04',
            scale: 3,
            memberSearch: '',
            preset: 'rolling-6',
        });
        visibleMonths = ['2026-04'];
        allocationsList = [{
            theme_id: 1,
            member_id: 10,
            month: '2026-06',
            allocation_rate: 30,
            memo: '',
        }];

        const { initMemberView } = await import('../js/member/member-view.js');

        await initMemberView();

        const toggle = document.querySelector('.toggle-btn');
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const cell = document.querySelector('.member-theme-cell');
        expect(cell?.querySelector('.member-theme-milestone')?.textContent).toBe('Release');
        expect(cell?.querySelector('.member-theme-milestone-count')?.textContent).toBe('+1');
        expect(cell?.querySelector('.member-theme-milestones')?.getAttribute('title')).toContain('Review');
        expect(cell?.querySelector('.member-theme-milestones')?.getAttribute('title')).toContain('完了: Review');
        expect(cell?.querySelector('.member-theme-dev-complete')).not.toBeNull();
    });

    it('collapses multiple milestones in one month to a lead chip plus overflow count', async () => {
        themesList.mockResolvedValue([{
            theme_id: 1,
            name: 'Theme A',
            color: '#00aaff',
            category: 'Delivery',
            status: 'active',
            milestones: [
                { month: '2026-04', label: 'Release Candidate', is_completed: false },
                { month: '2026-04', label: 'Customer Review', is_completed: true },
                { month: '2026-04', label: 'Launch', is_completed: false },
            ],
        }]);

        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        document.querySelector('.toggle-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const chip = document.querySelector('.member-theme-cell .member-theme-milestone:not(.member-theme-milestone-count)');
        const countChip = document.querySelector('.member-theme-cell .member-theme-milestone-count');
        const group = document.querySelector('.member-theme-cell .member-theme-milestones');

        expect(chip?.textContent).toBe('Release Candidate');
        expect(countChip?.textContent).toBe('+2');
        expect(group?.getAttribute('title')).toContain('Customer Review');
        expect(group?.getAttribute('title')).toContain('Launch');
    });

    it('highlights only the clicked member-load month column and toggles off on repeat click', async () => {
        visibleMonths = ['2026-04', '2026-05'];
        allocationsList = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 30, memo: '' },
        ];

        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        const aprilCell = document.querySelector('td[data-member-cell="10-2026-04"]');
        const mayCell = document.querySelector('td[data-member-cell="10-2026-05"]');

        aprilCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-member-month="2026-04"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('td[data-member-cell="10-2026-04"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('th[data-member-month="2026-05"]')?.classList.contains('month-selected')).toBe(false);

        mayCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-member-month="2026-04"]')?.classList.contains('month-selected')).toBe(false);
        expect(document.querySelector('th[data-member-month="2026-05"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('td[data-member-cell="10-2026-05"]')?.classList.contains('month-selected')).toBe(true);

        mayCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-member-month="2026-05"]')?.classList.contains('month-selected')).toBe(false);
        expect(document.querySelector('td[data-member-cell="10-2026-05"]')?.classList.contains('month-selected')).toBe(false);
    });
});
