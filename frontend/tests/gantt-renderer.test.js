// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const openCellEditor = vi.fn();
const isCellEditorOpen = vi.fn(() => false);
const setBusyState = vi.fn();
const setSaveState = vi.fn();
const showToast = vi.fn();
const showConfirmDialog = vi.fn();
const showPromptDialog = vi.fn();
const formatError = vi.fn((error) => error.message);
const bulkUpdate = vi.fn(async () => ({}));
let visibleMonths = ['2026-04'];
let allocationRows = [{
    theme_id: 1,
    member_id: 10,
    month: '2026-04',
    allocation_rate: 20,
    memo: '',
}];

const themeList = vi.fn(async () => ([{
    theme_id: 1,
    name: 'Theme A',
    status: 'active',
    color: '#00aaff',
    category: 'Delivery',
    milestones: [
        { id: 1, month: '2026-04', label: 'Release', position: 0 },
        { id: 2, month: '2026-04', label: 'Review', position: 1 },
    ],
    member_ids: [10],
}]));
const memberList = vi.fn(async () => ([{
    member_id: 10,
    display_name: 'Alice',
    department: 'Dev',
    capacity: 100,
    is_active: true,
}]));
const allocationList = vi.fn(async () => allocationRows);
const warnings = vi.fn(async () => ([]));
const memberLoads = vi.fn(async () => ({ 10: { '2026-04': 20 } }));
const snapshotList = vi.fn(async () => ([]));
const themeUpdate = vi.fn(async () => ({}));

vi.mock('../js/gantt/gantt-editor.js', () => ({
    openCellEditor,
    isCellEditorOpen,
}));

vi.mock('../js/ui.js', () => ({
    formatError,
    setBusyState,
    setSaveState,
    showConfirmDialog,
    showPromptDialog,
    showToast,
}));

vi.mock('../js/shared-state.js', () => ({
    getPresetConfig: vi.fn(() => ({ startMonth: '2026-04', scale: 1 })),
    loadViewState: vi.fn(() => ({
        startMonth: '2026-04',
        scale: 1,
        ganttSearch: '',
        ganttCategory: '',
        ganttOwner: '',
        ganttStatus: 'all',
        ganttPriority: 'all',
        groupBy: 'none',
    })),
    subscribeViewState: vi.fn(() => () => {}),
    updateViewState: vi.fn(),
}));

vi.mock('../js/utils/date-utils.js', () => ({
    addMonths: vi.fn((month) => month),
    currentMonth: vi.fn(() => '2026-04'),
    formatMonthHeader: vi.fn((month) => month),
    getVisibleMonths: vi.fn(() => visibleMonths),
}));

vi.mock('../js/api.js', () => ({
    allocations: {
        list: allocationList,
        warnings,
        memberLoads,
        updateSingle: vi.fn(async () => ({})),
        bulkUpdate,
    },
    members: {
        list: memberList,
    },
    snapshots: {
        list: snapshotList,
        get: vi.fn(),
        create: vi.fn(),
    },
    themes: {
        list: themeList,
        update: themeUpdate,
        assignMembersBulk: vi.fn(),
    },
}));

function renderBaseDom() {
    document.body.innerHTML = `
        <div id="scale-switcher"><button class="scale-btn" data-scale="1" type="button">1</button></div>
        <div id="view-gantt" class="view active"></div>
        <input id="gantt-search">
        <select id="gantt-group-by"><option value="none" selected>none</option></select>
        <button id="gantt-prev" type="button"></button>
        <button id="gantt-next" type="button"></button>
        <button id="gantt-today" type="button"></button>
        <select id="shared-period-preset"><option value="rolling-6" selected>rolling-6</option></select>
        <button id="gantt-expand-all" type="button"></button>
        <button id="gantt-collapse-all" type="button"></button>
        <button id="gantt-export-csv" type="button"></button>
        <button id="gantt-export-xlsx" type="button"></button>
        <button id="snapshot-save-btn" type="button"></button>
        <select id="snapshot-select"></select>
        <div id="gantt-summary"></div>
        <div id="aggregate-by-category"></div>
        <div id="aggregate-by-status"></div>
        <div id="aggregate-by-department"></div>
        <div id="snapshot-diff-summary"></div>
        <table>
            <thead id="gantt-thead"></thead>
            <tbody id="gantt-tbody"></tbody>
        </table>
        <div id="detail-empty"></div>
        <form id="detail-form" hidden>
            <div id="detail-target"></div>
            <input id="detail-rate">
            <textarea id="detail-memo"></textarea>
            <input id="detail-bulk-rate">
            <div id="detail-message"></div>
        </form>
        <button id="detail-save" type="button"></button>
        <button id="detail-prev" type="button"></button>
        <button id="detail-next" type="button"></button>
        <button id="detail-preview-bulk" type="button"></button>
        <div id="modal-overlay" hidden>
            <div id="modal-title"></div>
            <div id="modal-body"></div>
            <div id="modal-footer"></div>
            <button id="modal-close" type="button"></button>
        </div>
        <div id="cell-editor" hidden>
            <input id="cell-editor-input" type="number">
            <button id="cell-editor-save" type="button">save</button>
            <button id="cell-editor-cancel" type="button">cancel</button>
            <button id="cell-editor-clear" type="button">clear</button>
        </div>
    `;
}

describe('gantt-renderer regressions', () => {
    beforeEach(() => {
        vi.resetModules();
        renderBaseDom();
        openCellEditor.mockClear();
        isCellEditorOpen.mockClear();
        isCellEditorOpen.mockReturnValue(false);
        setBusyState.mockClear();
        setSaveState.mockClear();
        showToast.mockClear();
        showConfirmDialog.mockClear();
        showPromptDialog.mockClear();
        bulkUpdate.mockClear();
        themeList.mockClear();
        memberList.mockClear();
        allocationList.mockClear();
        warnings.mockClear();
        memberLoads.mockClear();
        snapshotList.mockClear();
        themeUpdate.mockClear();
        visibleMonths = ['2026-04'];
        allocationRows = [{
            theme_id: 1,
            member_id: 10,
            month: '2026-04',
            allocation_rate: 20,
            memo: '',
        }];
        localStorage.clear();
    });

    it('opens the inline editor on single click', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const cell = document.querySelector('.gantt-cell[data-theme]');
        expect(cell).not.toBeNull();

        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(openCellEditor).toHaveBeenCalledTimes(1);
        expect(openCellEditor.mock.calls[0][0]).toBe(cell);
    });

    it('moves the active cell with arrow keys and starts direct numeric entry', async () => {
        visibleMonths = ['2026-04', '2026-05', '2026-06'];
        allocationRows = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 30, memo: '' },
        ];

        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cells = Array.from(document.querySelectorAll('.gantt-cell[data-theme]'));
        cells[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        openCellEditor.mockClear();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(document.activeElement).toBe(cells[1]);
        expect(document.getElementById('detail-target')?.textContent).toContain('2026-05');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '7', bubbles: true }));

        expect(openCellEditor).toHaveBeenCalledTimes(1);
        expect(openCellEditor.mock.calls[0][0]).toBe(cells[1]);
        expect(openCellEditor.mock.calls[0][7]).toEqual({ initialValue: '7', selectOnOpen: false });
    });

    it('copies and pastes a month range with bulk update', async () => {
        visibleMonths = ['2026-04', '2026-05', '2026-06'];
        allocationRows = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 10, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 20, memo: '' },
        ];

        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cells = Array.from(document.querySelectorAll('.gantt-cell[data-theme]'));
        cells[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));

        const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: { getData: () => '' },
        });
        document.dispatchEvent(pasteEvent);
        await Promise.resolve();

        expect(bulkUpdate).toHaveBeenCalledWith([
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 10 },
            { theme_id: 1, member_id: 10, month: '2026-06', allocation_rate: 20 },
        ]);
    });

    it('renders theme summary allocations with percent suffix', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const summaryCell = document.querySelector('.gantt-row-summary .gantt-cell');
        expect(summaryCell?.textContent).toContain('20%');
    });

    it('builds gantt-shaped Excel export data', async () => {
        const { refreshGantt, getGanttGridExportDataset } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const dataset = getGanttGridExportDataset();
        expect(dataset.headers).toEqual(['Theme / Member', '2026-04']);
        expect(dataset.rows).toEqual([
            { type: 'summary', label: 'Theme A', color: '#00aaff', values: ['20%'] },
            { type: 'member', label: 'Alice (Dev)', values: ['20%'] },
        ]);
    });

    it('renders milestone markers on the matching theme month', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const milestones = Array.from(document.querySelectorAll('.gantt-row-summary .gantt-milestone-chip'));
        expect(milestones).toHaveLength(2);
        expect(milestones.map((item) => item.textContent)).toEqual(['Release', 'Review']);
    });

    it('creates and syncs multi-filter controls for gantt search', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04',
            scale: 1,
            ganttSearch: 'alice',
            ganttCategory: 'Delivery',
            ganttOwner: 'alice',
            ganttStatus: 'open',
            ganttPriority: '1',
            groupBy: 'status',
        });

        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        expect(document.getElementById('gantt-category-filter')).not.toBeNull();
        expect(document.getElementById('gantt-owner-filter')).not.toBeNull();
        expect(document.getElementById('gantt-status-filter')?.value).toBe('open');
        expect(document.getElementById('gantt-priority-filter')?.value).toBe('1');
        expect(document.getElementById('gantt-owner-filter')?.value).toBe('alice');

        document.getElementById('gantt-status-filter').value = 'completed';
        document.getElementById('gantt-status-filter').dispatchEvent(new Event('change', { bubbles: true }));

        expect(sharedState.updateViewState).toHaveBeenCalledWith({ ganttStatus: 'completed' });
    });

    it('opens and saves milestone edits from the gantt screen', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const button = document.querySelector('.theme-milestone-btn');
        expect(button).not.toBeNull();

        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.getElementById('modal-overlay')?.hidden).toBe(false);
        const rows = document.querySelectorAll('.theme-milestone-row');
        expect(rows).toHaveLength(2);

        rows[0].querySelector('.theme-milestone-month').value = '2026-05';
        rows[0].querySelector('.theme-milestone-label').value = 'Launch';
        document.getElementById('modal-save-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await Promise.resolve();

        expect(themeUpdate).toHaveBeenCalledWith(1, {
            dev_complete_month: null,
            milestones: [
                { month: '2026-05', label: 'Launch', is_completed: false },
                { month: '2026-04', label: 'Review', is_completed: false },
            ],
        });
    });
});
