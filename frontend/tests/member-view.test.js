// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const openCellEditor = vi.fn();
const setBusyState = vi.fn();
const setSaveState = vi.fn();
const showToast = vi.fn();
const showPromptDialog = vi.fn();
const formatError = vi.fn((error) => error.message);
const bulkUpdate = vi.fn(async () => ({}));
const historyPush = vi.fn();
const refreshGantt = vi.fn(async () => {});

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
const updateMonthlyCapacity = vi.fn(async () => ({}));
const deleteMonthlyCapacity = vi.fn(async () => ({}));

vi.mock('../js/gantt/gantt-editor.js', () => ({
    openCellEditor,
}));

vi.mock('../js/gantt/gantt-renderer.js', () => ({
    HistoryManager: {
        push: historyPush,
        stack: [],
        index: -1,
    },
    refreshGantt,
}));

vi.mock('../js/ui.js', () => ({
    formatError,
    setBusyState,
    setSaveState,
    showPromptDialog,
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
        bulkUpdate,
    },
    members: {
        list: membersList,
        updateMonthlyCapacity,
        deleteMonthlyCapacity,
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
        <select id="member-density"><option value="standard">standard</option><option value="compact">compact</option></select>
        <select id="member-sort"><option value="risk">risk</option><option value="name">name</option><option value="department">department</option></select>
        <select id="member-group"><option value="none">none</option><option value="department">department</option></select>
        <button id="member-controls-toggle" type="button" aria-expanded="true" aria-controls="member-load-controls">コントロール画面を閉じる</button>
        <div id="member-load-controls"></div>
        <button id="member-export-csv" type="button"></button>
        <select id="member-export-scope"><option value="visible">visible</option><option value="all">all</option></select>
        <button id="member-prev" type="button"></button>
        <button id="member-next" type="button"></button>
        <button id="member-today" type="button"></button>
        <select id="member-period-preset"><option value="rolling-6" selected>rolling-6</option></select>
        <section id="member-load-summary"></section>
        <div id="member-load-container"></div>
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
        showPromptDialog.mockReset();
        bulkUpdate.mockClear();
        historyPush.mockClear();
        refreshGantt.mockClear();
        membersList.mockClear();
        themesList.mockClear();
        memberLoads.mockClear();
        warnings.mockClear();
        allocationsApiList.mockClear();
        updateMonthlyCapacity.mockClear();
        deleteMonthlyCapacity.mockClear();
        membersList.mockResolvedValue([{
            member_id: 10,
            display_name: 'Alice',
            department: 'Dev',
            capacity: 100,
        }]);
        themesList.mockResolvedValue([{
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
        }]);
        memberLoads.mockResolvedValue({ 10: { '2026-04': 20, '2026-05': 30 } });
        warnings.mockResolvedValue([]);
        allocationsApiList.mockImplementation(async () => allocationsList);
        updateMonthlyCapacity.mockResolvedValue({});
        deleteMonthlyCapacity.mockResolvedValue({});
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

    it('toggles narrow-layout display controls without changing view state', async () => {
        const { initMemberView } = await import('../js/member/member-view.js');
        await initMemberView();
        const toggle = document.getElementById('member-controls-toggle');
        const controls = document.getElementById('member-load-controls');

        toggle?.click();
        expect(toggle?.getAttribute('aria-expanded')).toBe('false');
        expect(toggle?.textContent).toBe('コントロール画面を開く');
        expect(controls?.classList.contains('is-collapsed')).toBe(true);

        toggle?.click();
        expect(toggle?.getAttribute('aria-expanded')).toBe('true');
        expect(toggle?.textContent).toBe('コントロール画面を閉じる');
        expect(controls?.classList.contains('is-collapsed')).toBe(false);
    });

    it('keeps read failures out of the save-state channel', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        membersList.mockRejectedValueOnce(new Error('offline'));
        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        expect(setSaveState).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('メンバー負荷の読み込みに失敗しました: offline', 'error');
        errorSpy.mockRestore();
    });

    it('renders dev-complete marker for the matching month', async () => {
        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        const toggle = document.querySelector('.toggle-btn');
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const marker = document.querySelector('.member-theme-cell .member-theme-dev-complete');
        expect(marker).not.toBeNull();
        expect(marker?.querySelector('svg')).not.toBeNull();
        expect(marker?.textContent).toContain('20%');
        expect(marker?.getAttribute('title')).toBe('開発完了月');
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

    it('highlights only the selected month header column and toggles off on repeat click', async () => {
        visibleMonths = ['2026-04', '2026-05'];
        allocationsList = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 30, memo: '' },
        ];

        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        const aprilHeader = document.querySelector('th[data-member-month="2026-04"]');
        const mayHeader = document.querySelector('th[data-member-month="2026-05"]');

        aprilHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-member-month="2026-04"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('td[data-member-cell="10-2026-04"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('th[data-member-month="2026-05"]')?.classList.contains('month-selected')).toBe(false);

        mayHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-member-month="2026-04"]')?.classList.contains('month-selected')).toBe(false);
        expect(document.querySelector('th[data-member-month="2026-05"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('td[data-member-cell="10-2026-05"]')?.classList.contains('month-selected')).toBe(true);

        mayHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-member-month="2026-05"]')?.classList.contains('month-selected')).toBe(false);
        expect(document.querySelector('td[data-member-cell="10-2026-05"]')?.classList.contains('month-selected')).toBe(false);
    });

    it('renders decision-ready summary cards', async () => {
        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        const summary = document.getElementById('member-load-summary');
        const labels = Array.from(summary?.querySelectorAll('.summary-label') || []).map((node) => node.textContent);

        expect(summary?.querySelectorAll('.summary-card')).toHaveLength(4);
        expect(summary?.querySelectorAll('.member-load-summary-card')).toHaveLength(4);
        expect(summary?.querySelectorAll('.member-summary-action')).toHaveLength(4);
        expect(labels).toEqual(['平均キャパ利用率', '超過', '上限付近', '未割当']);
        expect(summary?.textContent).toContain('全1名');
        expect(summary?.textContent).toContain('警告セル 0件');
    });

    it('uses a monthly capacity override for overload state and shows it as editable', async () => {
        membersList.mockResolvedValue([{
            member_id: 10,
            display_name: 'Alice',
            department: 'Dev',
            capacity: 100,
            monthly_capacities: { '2026-04': 60 },
        }]);
        memberLoads.mockResolvedValue({ 10: { '2026-04': 80 } });

        const { refreshMemberView } = await import('../js/member/member-view.js');
        await refreshMemberView();

        expect(document.querySelector('.load-cell')?.classList.contains('load-critical')).toBe(true);
        expect(document.querySelector('.member-capacity-button')?.textContent).toContain('上限 60%');
        expect(document.querySelector('.member-capacity-button')?.classList.contains('is-overridden')).toBe(true);
        expect(document.querySelector('.member-detail-button')?.getAttribute('aria-label')).toContain('上限超過 20%');
    });

    it('saves a monthly capacity from the member-load cell', async () => {
        showPromptDialog.mockResolvedValueOnce('60');
        const { refreshMemberView } = await import('../js/member/member-view.js');
        await refreshMemberView();

        document.querySelector('.member-capacity-button')?.click();

        await vi.waitFor(() => {
            expect(updateMonthlyCapacity).toHaveBeenCalledWith(10, '2026-04', 60);
        });
        expect(deleteMonthlyCapacity).not.toHaveBeenCalled();
        expect(refreshGantt).toHaveBeenCalled();
        expect(setSaveState).toHaveBeenCalledWith('saved', '月別キャパシティを保存しました');
    });

    it('keeps an explicitly entered normal value as a monthly override', async () => {
        showPromptDialog.mockResolvedValueOnce('100');
        const { refreshMemberView } = await import('../js/member/member-view.js');
        await refreshMemberView();

        document.querySelector('.member-capacity-button')?.click();

        await vi.waitFor(() => {
            expect(updateMonthlyCapacity).toHaveBeenCalledWith(10, '2026-04', 100);
        });
        expect(deleteMonthlyCapacity).not.toHaveBeenCalled();
    });

    it('filters the table from summary cards and clears on repeat click', async () => {
        membersList.mockResolvedValue([
            { member_id: 10, display_name: 'Alice', department: 'Dev', capacity: 100 },
            { member_id: 20, display_name: 'Bob', department: 'Ops', capacity: 100 },
        ]);
        memberLoads.mockResolvedValue({
            10: { '2026-04': 120 },
            20: { '2026-04': 20 },
        });
        warnings.mockResolvedValue([{ member_id: 10, month: '2026-04' }]);

        const { refreshMemberView } = await import('../js/member/member-view.js');
        await refreshMemberView();

        document.querySelector('[data-member-filter="overloaded"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelectorAll('tr.member-row')).toHaveLength(1);
        expect(document.querySelector('tr.member-row')?.textContent).toContain('Alice');
        expect(document.querySelector('[data-member-filter="overloaded"]')?.getAttribute('aria-pressed')).toBe('true');

        document.querySelector('[data-member-filter="overloaded"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelectorAll('tr.member-row')).toHaveLength(2);
    });

    it('uses accessible expand and breakdown controls without restoring the removed upper detail panel', async () => {
        const { refreshMemberView } = await import('../js/member/member-view.js');
        await refreshMemberView();

        const toggle = document.querySelector('.toggle-btn');
        expect(toggle?.tagName).toBe('BUTTON');
        expect(toggle?.getAttribute('aria-expanded')).toBe('false');
        toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(toggle?.getAttribute('aria-expanded')).toBe('true');

        const summaryCell = document.querySelector('td[data-member-cell]');
        expect(summaryCell?.hasAttribute('tabindex')).toBe(false);
        expect(summaryCell?.hasAttribute('role')).toBe(false);
        const breakdownButton = summaryCell?.querySelector('.member-detail-button');
        expect(breakdownButton?.tagName).toBe('BUTTON');
        expect(breakdownButton?.getAttribute('aria-haspopup')).toBe('dialog');
        breakdownButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.member-detail-popup[role="dialog"]')).not.toBeNull();
        expect(breakdownButton?.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector('.member-load-detail-panel')).toBeNull();

        document.querySelector('.member-detail-popup-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.member-detail-popup')).toBeNull();
        expect(breakdownButton?.getAttribute('aria-expanded')).toBe('false');
    });

    it('places member expand controls beside the member column header', async () => {
        const { refreshMemberView } = await import('../js/member/member-view.js');

        await refreshMemberView();

        const firstHeader = document.querySelector('#member-load-thead th:first-child');
        const expandButton = firstHeader?.querySelector('#member-expand-all');
        const collapseButton = firstHeader?.querySelector('#member-collapse-all');

        expect(firstHeader?.querySelector('.member-header-actions')?.textContent).toContain('メンバー');
        expect(expandButton?.getAttribute('aria-label')).toBe('すべて展開');
        expect(collapseButton?.getAttribute('aria-label')).toBe('すべて折りたたみ');
        expect(expandButton?.querySelector('.ui-icon')).not.toBeNull();
        expect(collapseButton?.querySelector('.ui-icon')).not.toBeNull();

        document.querySelector('.toggle-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.theme-row')?.classList.contains('hidden')).toBe(false);

        collapseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.theme-row')?.classList.contains('hidden')).toBe(true);

        expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.theme-row')?.classList.contains('hidden')).toBe(false);
    });

    it('shows the active member search filter count and lets the user clear it', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04',
            scale: 1,
            memberSearch: 'alice',
            preset: 'rolling-6',
        });
        membersList.mockResolvedValue([
            { member_id: 10, display_name: 'Alice', department: 'Dev', capacity: 100 },
            { member_id: 20, display_name: 'Bob', department: 'Ops', capacity: 100 },
            { member_id: 30, display_name: 'Carol', department: 'QA', capacity: 100 },
        ]);
        themesList.mockResolvedValue([
            { theme_id: 1, name: 'Theme A', color: '#00aaff', milestones: [] },
            { theme_id: 2, name: 'Theme B', color: '#22c55e', milestones: [] },
        ]);
        allocationsList = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 2, member_id: 20, month: '2026-04', allocation_rate: 10, memo: '' },
        ];
        memberLoads.mockResolvedValue({
            10: { '2026-04': 20 },
            20: { '2026-04': 10 },
            30: {},
        });

        const { initMemberView } = await import('../js/member/member-view.js');

        await initMemberView();

        expect(document.querySelectorAll('tr.member-row')).toHaveLength(1);
        expect(document.getElementById('member-search-status')?.textContent).toBe('1 / 3 名を表示');
        expect(document.getElementById('member-search-clear')?.hidden).toBe(false);

        document.getElementById('member-search-clear')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.getElementById('member-search')?.value).toBe('');
        expect(sharedState.updateViewState).toHaveBeenCalledWith({ memberSearch: '' }, { source: 'member-search' });
    });

    it('passes undo-aware commit handlers into member-load cell editing', async () => {
        allocationsList = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 30, memo: '' },
        ];

        const { refreshMemberView } = await import('../js/member/member-view.js');
        await refreshMemberView();

        document.querySelector('.toggle-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.querySelector('.member-theme-cell')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(openCellEditor).toHaveBeenCalledTimes(1);
        expect(openCellEditor.mock.calls[0][7]).toMatchObject({ optimisticSave: false });
        expect(openCellEditor.mock.calls[0][7].onCommitSuccess).toEqual(expect.any(Function));
        expect(openCellEditor.mock.calls[0][7].commitChange).toEqual(expect.any(Function));
        expect(openCellEditor.mock.calls[0][7].clearChange).toEqual(expect.any(Function));
    });

    it('records member-load edits in history and persists them through bulk update', async () => {
        const { refreshMemberView } = await import('../js/member/member-view.js');
        await refreshMemberView();

        document.querySelector('.toggle-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.querySelector('.member-theme-cell')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await openCellEditor.mock.calls[0][7].commitChange(35);

        expect(historyPush).toHaveBeenCalledTimes(1);
        expect(historyPush.mock.calls[0][0]).toEqual([
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
        ]);
        expect(historyPush.mock.calls[0][1]).toEqual([
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 35, memo: '' },
        ]);
        expect(historyPush.mock.calls[0][2]).toMatchObject({ apply: expect.any(Function) });
        expect(bulkUpdate).toHaveBeenCalledWith([
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 35, memo: '' },
        ]);
        expect(refreshGantt).toHaveBeenCalledTimes(1);
    });

    it('keeps the member task rows expanded after saving manpower', async () => {
        const { refreshMemberView } = await import('../js/member/member-view.js');
        await refreshMemberView();

        document.querySelector('.toggle-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.querySelector('.member-theme-cell')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await openCellEditor.mock.calls[0][7].commitChange(35);

        const toggle = document.querySelector('.toggle-btn');
        expect(toggle?.getAttribute('aria-expanded')).toBe('true');
        expect(toggle?.classList.contains('expanded')).toBe(true);
        expect(document.querySelector('.theme-row')?.classList.contains('hidden')).toBe(false);
    });

    it('classifies load by monthly capacity utilization boundaries', async () => {
        const { getLoadClass } = await import('../js/member/member-view.js');

        expect(getLoadClass(0, 100)).toBe('load-none');
        expect(getLoadClass(69, 100)).toBe('load-low');
        expect(getLoadClass(70, 100)).toBe('load-mid');
        expect(getLoadClass(90, 100)).toBe('load-near');
        expect(getLoadClass(101, 100)).toBe('load-over');
        expect(getLoadClass(120, 100)).toBe('load-critical');
        expect(getLoadClass(60, 60)).toBe('load-near');
    });

    it('filters locally without issuing another API request', async () => {
        membersList.mockResolvedValue([
            { member_id: 10, display_name: 'Alice', department: 'Dev', capacity: 100 },
            { member_id: 20, display_name: 'Bob', department: 'Ops', capacity: 100 },
        ]);
        allocationsList = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 1, member_id: 20, month: '2026-04', allocation_rate: 10, memo: '' },
        ];
        memberLoads.mockResolvedValue({ 10: { '2026-04': 20 }, 20: { '2026-04': 10 } });
        const { initMemberView } = await import('../js/member/member-view.js');
        await initMemberView();
        const counts = [membersList, themesList, memberLoads, warnings, allocationsApiList].map((mock) => mock.mock.calls.length);

        const search = document.getElementById('member-search');
        search.value = 'Bob';
        search.dispatchEvent(new Event('input', { bubbles: true }));

        expect(document.querySelectorAll('tr.member-row')).toHaveLength(1);
        expect(document.querySelector('tr.member-row')?.textContent).toContain('Bob');
        expect([membersList, themesList, memberLoads, warnings, allocationsApiList].map((mock) => mock.mock.calls.length)).toEqual(counts);
    });

    it('filters a cached 1000-member by 24-month fixture within 150ms without API calls', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-01', scale: 1, bucketMonths: 1, rangeMonths: 24,
            visibleCount: 24, memberSearch: 'Member 999', preset: 'rolling-24',
        });
        visibleMonths = Array.from({ length: 24 }, (_, index) => {
            const month = new Date(2026, index, 1);
            return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
        });
        const fixtureMembers = Array.from({ length: 1000 }, (_, index) => ({
            member_id: index + 1,
            display_name: `Member ${String(index + 1).padStart(4, '0')}`,
            department: `Department ${index % 10}`,
            capacity: 100,
        }));
        const fixtureLoads = Object.fromEntries(fixtureMembers.map((member) => [
            member.member_id,
            Object.fromEntries(visibleMonths.map((month, monthIndex) => [month, (member.member_id + monthIndex) % 121])),
        ]));
        membersList.mockResolvedValue(fixtureMembers);
        memberLoads.mockResolvedValue(fixtureLoads);
        allocationsList = [];

        const { initMemberView } = await import('../js/member/member-view.js');
        await initMemberView();
        const counts = [membersList, themesList, memberLoads, warnings, allocationsApiList].map((mock) => mock.mock.calls.length);

        const search = document.getElementById('member-search');
        const startedAt = performance.now();
        search.value = 'Member 0500';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        const elapsedMs = performance.now() - startedAt;

        expect(document.querySelectorAll('tr.member-row')).toHaveLength(1);
        expect(document.querySelector('tr.member-row')?.textContent).toContain('Member 0500');
        expect([membersList, themesList, memberLoads, warnings, allocationsApiList].map((mock) => mock.mock.calls.length)).toEqual(counts);
        expect(elapsedMs).toBeLessThan(150);
    });

    it('renders aggregate theme cells as readonly without disabled edit buttons', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04', scale: 3, bucketMonths: 3, rangeMonths: 3,
            visibleCount: 1, memberSearch: '', preset: 'rolling-6',
        });
        visibleMonths = ['2026-04'];
        const { initMemberView } = await import('../js/member/member-view.js');
        await initMemberView();

        const themeCell = document.querySelector('.member-theme-cell');
        expect(themeCell?.classList.contains('is-readonly')).toBe(true);
        expect(themeCell?.hasAttribute('tabindex')).toBe(false);
        expect(themeCell?.hasAttribute('role')).toBe(false);
        expect(document.querySelector('.member-capacity-button')).toBeNull();
        expect(document.querySelector('.member-capacity-readonly')).not.toBeNull();
    });
});
