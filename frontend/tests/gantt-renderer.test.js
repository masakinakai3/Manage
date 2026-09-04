// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const openCellEditor = vi.fn();
const closeCellEditor = vi.fn();
const isCellEditorOpen = vi.fn(() => false);
const setBusyState = vi.fn();
const setSaveState = vi.fn();
const showToast = vi.fn();
const showConfirmDialog = vi.fn();
const showPromptDialog = vi.fn();
const formatError = vi.fn((error) => error.message);
const toPng = vi.fn(async () => 'data:image/png;base64,abc');
const bulkUpdate = vi.fn(async (rows) => {
    rows.forEach((row) => {
        const index = allocationRows.findIndex((item) => item.theme_id === row.theme_id
            && item.member_id === row.member_id
            && item.month === row.month);
        const nextRate = Number.parseInt(row.allocation_rate || '0', 10) || 0;
        const nextMemo = row.memo ?? allocationRows[index]?.memo ?? '';
        if (nextRate <= 0) {
            if (index >= 0) allocationRows.splice(index, 1);
            return;
        }
        if (index >= 0) {
            allocationRows[index] = { ...allocationRows[index], ...row, allocation_rate: nextRate, memo: nextMemo };
        } else {
            allocationRows.push({ ...row, allocation_rate: nextRate, memo: nextMemo });
        }
    });
    return {};
});
const updateSingle = vi.fn(async () => ({}));
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
    plan_certainty: 'confirmed',
    dev_rank: 'S',
    color: '#00aaff',
    category: 'Delivery',
    milestones: [
        { id: 1, month: '2026-05', label: 'Release', position: 0, is_completed: false },
        { id: 2, month: '2026-04', label: 'Review', position: 1, is_completed: true },
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
const openThemeEditListener = vi.fn();
const updateViewState = vi.fn();

vi.mock('../js/gantt/gantt-editor.js', () => ({
    closeCellEditor,
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
        ganttStatus: ['all'],
        ganttPriority: 'all',
        groupBy: 'none',
    })),
    subscribeViewState: vi.fn(() => () => {}),
    updateViewState,
}));

vi.mock('../js/utils/date-utils.js', () => ({
    addMonths: vi.fn((month, delta = 0) => {
        const [year, monthNumber] = month.split('-').map(Number);
        const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }),
    currentMonth: vi.fn(() => '2026-04'),
    formatMonthHeader: vi.fn((month) => month),
    getVisibleMonths: vi.fn(() => visibleMonths),
}));

vi.mock('../js/api.js', () => ({
    allocations: {
        list: allocationList,
        warnings,
        memberLoads,
        updateSingle,
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

vi.mock('html-to-image', () => ({
    toPng,
}));

function renderBaseDom() {
    document.body.innerHTML = `
        <button class="nav-item" data-view="insights" type="button">insights</button>
        <div id="scale-switcher">
            <button class="scale-btn" data-scale="1" type="button">1</button>
            <button class="scale-btn" data-scale="3" type="button">3</button>
        </div>
        <div id="view-gantt" class="view active"></div>
        <div id="gantt-controls-body">
            <div class="gantt-export-controls">
                <button id="gantt-export-csv" type="button"></button>
                <button id="gantt-export-image" type="button">画像出力</button>
            </div>
        </div>
        <div class="gantt-floating-actions">
            <label class="gantt-period-control" for="shared-period-preset">
                <span>表示範囲</span>
                <select id="shared-period-preset">
                    <option value="rolling-6" selected>rolling-6</option>
                    <option value="rolling-12">rolling-12</option>
                </select>
            </label>
            <button id="gantt-expand-all" type="button"></button>
            <button id="gantt-collapse-all" type="button"></button>
        </div>
        <select id="gantt-theme-filter"><option value="">all</option></select>
        <select id="gantt-category-filter"><option value="">all categories</option></select>
        <select id="gantt-owner-filter"><option value="">all members</option></select>
        <select id="gantt-show-other-members" disabled><option value="all">all members</option><option value="selected">selected member</option></select>
        <details id="gantt-status-filter">
            <summary><span data-gantt-status-label>all statuses</span></summary>
            <div role="group">
                <label><input type="checkbox" value="open">open</label>
                <label><input type="checkbox" value="planning">planning</label>
                <label><input type="checkbox" value="active">active</label>
                <label><input type="checkbox" value="stop">stop</label>
                <label><input type="checkbox" value="completed">completed</label>
                <label><input type="checkbox" value="cancelled">cancelled</label>
                <button type="button" data-gantt-status-clear>clear</button>
            </div>
        </details>
        <select id="gantt-priority-filter"><option value="all">all priorities</option><option value="1">p1</option></select>
        <select id="gantt-group-by"><option value="none" selected>none</option></select>
        <button id="gantt-filter-reset" type="button"></button>
        <div id="gantt-active-filters" hidden></div>
        <div class="gantt-control-row-primary">
            <div class="month-nav">
                <button id="gantt-prev" type="button"></button>
                <button id="gantt-next" type="button"></button>
                <button id="gantt-today" type="button"></button>
            </div>
        </div>
        <button id="snapshot-save-btn" type="button"></button>
        <select id="snapshot-select"></select>
        <div id="gantt-summary"></div>
        <div id="aggregate-by-category"></div>
        <div id="aggregate-by-status"></div>
        <div id="aggregate-by-department"></div>
        <div id="snapshot-diff-summary"></div>
        <div id="gantt-mobile-theme-list" hidden></div>
        <table id="gantt-table">
            <thead id="gantt-thead"></thead>
            <tbody id="gantt-tbody"></tbody>
        </table>
        <aside id="gantt-detail-panel" class="detail-empty-state">
            <div id="detail-empty"></div>
            <form id="detail-form" hidden>
                <div id="detail-target"></div>
                <input id="detail-rate">
                <textarea id="detail-memo"></textarea>
                <input id="detail-bulk-rate">
                <select id="detail-bulk-scope"><option value="selected">selected</option><option value="following">following</option><option value="visible">visible</option></select>
                <div id="detail-bulk-summary"></div>
                <div id="detail-message"></div>
            </form>
            <button id="detail-save" type="button"></button>
            <button id="detail-prev" type="button"></button>
            <button id="detail-next" type="button"></button>
            <button id="detail-preview-bulk" type="button"></button>
        </aside>
        <div id="modal-overlay" hidden>
            <div id="modal-title"></div>
            <div id="modal-body"></div>
            <div id="modal-footer"></div>
            <button id="modal-close" type="button"></button>
        </div>
        <div id="cell-editor" hidden>
            <input id="cell-editor-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off">
            <button id="cell-editor-save" type="button">save</button>
            <button id="cell-editor-cancel" type="button">cancel</button>
            <button id="cell-editor-clear" type="button">clear</button>
        </div>
    `;
    document.removeEventListener('open-theme-edit', openThemeEditListener);
    document.addEventListener('open-theme-edit', openThemeEditListener);
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('gantt-renderer regressions', () => {
    beforeEach(() => {
        vi.resetModules();
        renderBaseDom();
        closeCellEditor.mockClear();
        openCellEditor.mockClear();
        isCellEditorOpen.mockClear();
        isCellEditorOpen.mockReturnValue(false);
        setBusyState.mockClear();
        setSaveState.mockClear();
        showToast.mockClear();
        showConfirmDialog.mockClear();
        showPromptDialog.mockClear();
        bulkUpdate.mockClear();
        updateSingle.mockClear();
        themeList.mockClear();
        memberList.mockClear();
        allocationList.mockClear();
        warnings.mockClear();
        memberLoads.mockClear();
        snapshotList.mockClear();
        themeUpdate.mockClear();
        updateViewState.mockClear();
        toPng.mockClear();
        toPng.mockResolvedValue('data:image/png;base64,abc');
        openThemeEditListener.mockClear();
        visibleMonths = ['2026-04'];
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            writable: true,
            value: 1024,
        });
        allocationRows = [{
            theme_id: 1,
            member_id: 10,
            month: '2026-04',
            allocation_rate: 20,
            memo: '',
        }];
        localStorage.clear();
    });

    it('keeps only the latest 50 history entries', async () => {
        const { HistoryManager } = await import('../js/gantt/gantt-renderer.js');

        HistoryManager.stack = [];
        HistoryManager.index = -1;
        HistoryManager.isApplyingHistory = false;

        for (let i = 0; i < 55; i += 1) {
            HistoryManager.push([{ month: `undo-${i}` }], [{ month: `redo-${i}` }]);
        }

        expect(HistoryManager.stack).toHaveLength(50);
        expect(HistoryManager.index).toBe(49);
        expect(HistoryManager.stack[0].redo[0].month).toBe('redo-5');
        expect(HistoryManager.stack.at(-1).redo[0].month).toBe('redo-54');
    });

    it('ignores concurrent undo calls while one history action is already running', async () => {
        const deferred = createDeferred();
        bulkUpdate.mockImplementationOnce(() => deferred.promise);

        const { initGantt, HistoryManager } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cell = document.querySelector('.gantt-cell[data-theme]');
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        document.getElementById('detail-rate').value = '60';
        document.getElementById('detail-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        bulkUpdate.mockClear();

        const firstUndo = HistoryManager.undo();
        const secondUndo = HistoryManager.undo();

        expect(HistoryManager.isApplyingHistory).toBe(true);
        expect(bulkUpdate).toHaveBeenCalledTimes(1);

        deferred.resolve({});
        await firstUndo;
        await secondUndo;

        expect(HistoryManager.isApplyingHistory).toBe(false);
        expect(bulkUpdate).toHaveBeenCalledTimes(1);
    });

    it('opens the inline editor on single click', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const cell = document.querySelector('.gantt-cell[data-theme]');
        expect(cell).not.toBeNull();

        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(openCellEditor).toHaveBeenCalledTimes(1);
        expect(openCellEditor.mock.calls[0][0]).toBe(cell);
        expect(document.getElementById('gantt-detail-panel')?.classList.contains('detail-editor-suppressed')).toBe(true);
    });

    it('uses the in-flow detail editor instead of a competing inline editor at compact widths', async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: vi.fn(() => ({ matches: true })),
        });
        try {
            const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');
            await refreshGantt();

            const cell = document.querySelector('.gantt-cell[data-theme]');
            cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(openCellEditor).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(document.getElementById('detail-rate'));
            expect(document.getElementById('gantt-detail-panel')?.classList.contains('detail-empty-state')).toBe(false);
        } finally {
            if (originalDescriptor) Object.defineProperty(window, 'matchMedia', originalDescriptor);
            else delete window.matchMedia;
        }
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

        expect(openCellEditor.mock.calls.length).toBeGreaterThanOrEqual(1);
        const latestCall = openCellEditor.mock.calls.at(-1);
        expect(latestCall[0]).toBe(cells[1]);
        expect(latestCall[7]).toMatchObject({ initialValue: '7', selectOnOpen: false });
        expect(latestCall[7]).toMatchObject({ optimisticSave: false });
        expect(latestCall[7].onCommitSuccess).toEqual(expect.any(Function));
        expect(latestCall[7].commitChange).toEqual(expect.any(Function));
        expect(latestCall[7].clearChange).toEqual(expect.any(Function));
    });

    it('shifts the visible period by one month when arrow navigation crosses either horizontal edge', async () => {
        visibleMonths = ['2026-04', '2026-05', '2026-06'];

        const { initGantt, refreshGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const leftCell = document.querySelector('.gantt-cell[data-theme][data-month="2026-04"]');
        leftCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        updateViewState.mockClear();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

        expect(updateViewState).toHaveBeenCalledWith({ startMonth: '2026-03' });
        visibleMonths = ['2026-03', '2026-04', '2026-05'];
        await refreshGantt();
        expect(document.activeElement?.dataset.month).toBe('2026-03');

        visibleMonths = ['2026-04', '2026-05', '2026-06'];
        await refreshGantt();
        const rightCell = document.querySelector('.gantt-cell[data-theme][data-month="2026-06"]');
        rightCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        updateViewState.mockClear();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(updateViewState).toHaveBeenCalledWith({ startMonth: '2026-05' });
        visibleMonths = ['2026-05', '2026-06', '2026-07'];
        await refreshGantt();
        expect(document.activeElement?.dataset.month).toBe('2026-07');
    });

    it('shifts the visible period when inline-editor navigation crosses a horizontal edge', async () => {
        visibleMonths = ['2026-04', '2026-05', '2026-06'];

        const { initGantt, refreshGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const rightCell = document.querySelector('.gantt-cell[data-theme][data-month="2026-06"]');
        rightCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const navigate = openCellEditor.mock.calls.at(-1)[6];
        updateViewState.mockClear();

        navigate('ArrowRight', false, null);

        expect(updateViewState).toHaveBeenCalledWith({ startMonth: '2026-05' });
        visibleMonths = ['2026-05', '2026-06', '2026-07'];
        await refreshGantt();
        expect(openCellEditor.mock.calls.at(-1)[0]?.dataset.month).toBe('2026-07');
    });

    it('keeps the moved-to inline editor usable after saving with keyboard navigation', async () => {
        visibleMonths = ['2026-04', '2026-05', '2026-06'];
        allocationRows = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 30, memo: '' },
        ];

        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cells = Array.from(document.querySelectorAll('.gantt-cell[data-theme]'));
        cells[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const callsBeforeMove = allocationList.mock.calls.length;
        const navigate = openCellEditor.mock.calls.at(-1)[6];

        navigate('ArrowRight', true, 55);
        await Promise.resolve();

        const latestCall = openCellEditor.mock.calls.at(-1);
        expect(latestCall[0]).toBe(cells[1]);
        expect(bulkUpdate).toHaveBeenCalledWith([
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 55, memo: '' },
        ]);
        expect(allocationList).toHaveBeenCalledTimes(callsBeforeMove);
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

    it('bulk-updates only the selected month and following visible months', async () => {
        visibleMonths = ['2026-04', '2026-05', '2026-06'];
        allocationRows = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 10, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 20, memo: '' },
        ];
        showConfirmDialog.mockResolvedValue(true);
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        document.querySelector('.gantt-cell[data-theme][data-month="2026-05"]')?.click();
        document.getElementById('detail-bulk-rate').value = '40';
        document.getElementById('detail-bulk-scope').value = 'following';
        document.getElementById('detail-preview-bulk').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(showConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
            title: '一括更新の確認（2件）',
            message: expect.stringContaining('2026-05: 20% → 40%'),
        }));
        expect(bulkUpdate).toHaveBeenCalledWith([
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 40, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-06', allocation_rate: 40, memo: '' },
        ]);
    });

    it('adds single-cell edits to undo history from the detail panel', async () => {
        const { initGantt, HistoryManager } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cell = document.querySelector('.gantt-cell[data-theme]');
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        document.getElementById('detail-rate').value = '60';
        document.getElementById('detail-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(updateSingle).not.toHaveBeenCalled();
        expect(bulkUpdate).toHaveBeenCalledWith([
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 60, memo: '' },
        ]);

        bulkUpdate.mockClear();
        await HistoryManager.undo();

        expect(bulkUpdate).toHaveBeenCalledWith([
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
        ]);
    });

    it('closes the inline editor before rerendering an undo change', async () => {
        const { initGantt, HistoryManager } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cell = document.querySelector('.gantt-cell[data-theme]');
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        document.getElementById('detail-rate').value = '60';
        document.getElementById('detail-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        closeCellEditor.mockClear();
        await HistoryManager.undo();

        expect(closeCellEditor).toHaveBeenCalled();
    });

    it('blurs the focused detail input before rerendering an undo change', async () => {
        const { initGantt, HistoryManager } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cell = document.querySelector('.gantt-cell[data-theme]');
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const detailRate = document.getElementById('detail-rate');
        detailRate.focus();
        document.getElementById('detail-rate').value = '60';
        document.getElementById('detail-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        await HistoryManager.undo();

        expect(document.activeElement).not.toBe(detailRate);
    });

    it('ignores stale refresh results that return after a newer undo refresh', async () => {
        const firstAllocations = createDeferred();
        const secondAllocations = createDeferred();

        allocationList
            .mockImplementationOnce(() => firstAllocations.promise)
            .mockImplementationOnce(() => secondAllocations.promise);

        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        const firstRefresh = refreshGantt();
        const secondRefresh = refreshGantt();

        secondAllocations.resolve([{
            theme_id: 1,
            member_id: 10,
            month: '2026-04',
            allocation_rate: 20,
            memo: '',
        }]);
        await secondRefresh;

        firstAllocations.resolve([{
            theme_id: 1,
            member_id: 10,
            month: '2026-04',
            allocation_rate: 60,
            memo: '',
        }]);
        await firstRefresh;

        const cell = document.querySelector('.gantt-cell[data-theme="1"][data-member="10"][data-month="2026-04"]');
        expect(cell?.dataset.rate).toBe('20');
    });

    it('handles Ctrl+Z from the detail memo field after a saved change', async () => {
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cell = document.querySelector('.gantt-cell[data-theme]');
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const detailRate = document.getElementById('detail-rate');
        const detailMemo = document.getElementById('detail-memo');
        detailRate.value = '60';
        document.getElementById('detail-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        bulkUpdate.mockClear();
        detailMemo.focus();
        detailMemo.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z',
            ctrlKey: true,
            bubbles: true,
        }));
        await Promise.resolve();
        await Promise.resolve();

        expect(bulkUpdate).toHaveBeenCalledWith([
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
        ]);
    });

    it('handles Ctrl+Z from the detail rate input after a saved change', async () => {
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const cell = document.querySelector('.gantt-cell[data-theme]');
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const detailRate = document.getElementById('detail-rate');
        detailRate.value = '60';
        document.getElementById('detail-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        bulkUpdate.mockClear();
        detailRate.focus();
        detailRate.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'z',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        }));
        await Promise.resolve();
        await Promise.resolve();

        expect(bulkUpdate).toHaveBeenCalledWith([
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
        ]);
    });

    it('renders theme summary allocations with percent suffix', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const summaryCell = document.querySelector('.gantt-row-summary .gantt-cell');
        expect(summaryCell?.textContent).toContain('20%');
    });

    it('distinguishes an explicitly saved zero allocation from an empty cell', async () => {
        visibleMonths = ['2026-04', '2026-05'];
        allocationRows = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 0, memo: '' },
        ];
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const zeroCell = document.querySelector('.gantt-cell[data-theme][data-month="2026-04"]');
        const emptyCell = document.querySelector('.gantt-cell[data-theme][data-month="2026-05"]');
        expect(zeroCell?.textContent).toContain('0%');
        expect(zeroCell?.classList.contains('cell-explicit-zero')).toBe(true);
        expect(emptyCell?.textContent).toBe('-');
        expect(emptyCell?.classList.contains('cell-unset')).toBe(true);
        expect(emptyCell?.classList.contains('cell-explicit-zero')).toBe(false);
    });

    it('uses a critical visual tier for allocations above 150 percent', async () => {
        allocationRows = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 160, memo: '' },
        ];
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const cell = document.querySelector('.gantt-cell[data-theme][data-month="2026-04"]');
        expect(cell?.classList.contains('rate-over-critical')).toBe(true);
    });

    it('returns to insights and clears the scenario preview', async () => {
        const { refreshGantt, showScenarioPreview } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();
        showScenarioPreview({
            scenarioLabel: 'A',
            title: '[A] Scenario A',
            startMonth: '2026-04',
            previewThemeName: '[A] Preview Theme',
            assignments: [{
                month: '2026-04',
                memberId: 10,
                displayName: 'Alice',
                department: 'Dev',
                rate: 30,
            }],
            shiftSuggestions: [],
        });

        const insightsNav = document.querySelector('.nav-item[data-view="insights"]');
        const navClick = vi.fn();
        insightsNav?.addEventListener('click', navClick);

        const returnButton = document.querySelector('[data-scenario-return-toolbar="true"]');
        expect(returnButton).not.toBeNull();
        expect(document.querySelector('.gantt-row-scenario .theme-priority-badge')?.textContent).toBe('A');
        expect(document.querySelector('.scenario-preview-card .summary-value')?.textContent).toContain('[A]');

        returnButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(navClick).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-scenario-return-toolbar="true"]')).toBeNull();
    });

    it('switches scenario previews from the toolbar dropdown', async () => {
        const { refreshGantt, showScenarioPreview } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();
        showScenarioPreview({
            previews: [
                {
                    scenarioLabel: 'A',
                    title: '[A] Scenario A',
                    startMonth: '2026-04',
                    previewThemeName: '[A] Preview Theme',
                    assignments: [{
                        month: '2026-04',
                        memberId: 10,
                        displayName: 'Alice',
                        department: 'Dev',
                        rate: 30,
                    }],
                    shiftSuggestions: [],
                },
                {
                    scenarioLabel: 'B',
                    title: '[B] Scenario B',
                    startMonth: '2026-04',
                    previewThemeName: '[B] Backup Theme',
                    assignments: [{
                        month: '2026-04',
                        memberId: 11,
                        displayName: 'Bob',
                        department: 'QA',
                        rate: 40,
                    }],
                    shiftSuggestions: [],
                },
            ],
            selectedIndex: 0,
        });

        const select = document.querySelector('[data-scenario-select-toolbar="true"]');
        expect(select).not.toBeNull();
        expect(select?.value).toBe('0');
        expect(document.querySelector('.scenario-preview-card .summary-value')?.textContent).toContain('[A]');
        expect(document.querySelector('.gantt-row-scenario .theme-priority-badge')?.textContent).toBe('A');

        select.value = '1';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        await vi.waitFor(() => {
            expect(document.querySelector('.scenario-preview-card .summary-value')?.textContent).toContain('[B]');
            expect(document.querySelector('.gantt-row-scenario .theme-priority-badge')?.textContent).toBe('B');
            expect(document.querySelector('.gantt-row-scenario .theme-name-text')?.textContent).toContain('[B]');
        });
    });

    it('builds gantt-shaped Excel export data', async () => {
        const { refreshGantt, getGanttGridExportDataset } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const dataset = getGanttGridExportDataset();
        expect(dataset.headers).toEqual(['テーマ / メンバー', '2026-04']);
        expect(dataset.header_labels).toEqual(['テーマ / メンバー', '2026-04']);
        expect(dataset.rows).toEqual([
            {
                type: 'summary',
                label: 'Theme A / ランク S / 進行中',
                color: '#00aaff',
                values: [{
                    text: '20%\nReview',
                    rate: 20,
                    is_current: true,
                    has_special_text: true,
                }],
            },
            {
                type: 'member',
                label: 'Alice (Dev / 上限 100%)',
                values: [{
                    text: '20%',
                    rate: 20,
                    is_current: true,
                    has_warning: false,
                    has_special_text: false,
                }],
            },
        ]);
    });

    it('builds gantt-shaped CSV content from the visible grid', async () => {
        const { refreshGantt, buildGanttGridCsvContent } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        expect(buildGanttGridCsvContent()).toBe([
            'テーマ / メンバー,2026-04',
            'Theme A / ランク S / 進行中,"20%\nReview"',
            'Alice (Dev / 上限 100%),20%',
        ].join('\r\n'));
    });

    it('keeps the period selector visible and low-use exports inside the collapsible controls', () => {
        const source = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
        const page = new DOMParser().parseFromString(source, 'text/html');
        const toolbar = page.querySelector('.gantt-floating-actions');
        const controls = page.getElementById('gantt-controls-body');
        const expandButton = toolbar?.querySelector('#gantt-expand-all');
        const collapseButton = toolbar?.querySelector('#gantt-collapse-all');

        expect(toolbar?.querySelector('#shared-period-preset')).not.toBeNull();
        expect(toolbar?.querySelector('option[value="first-half"]')?.textContent).toBe('上期（3月～8月）');
        expect(toolbar?.querySelector('option[value="second-half"]')?.textContent).toBe('下期（9月～2月）');
        expect(page.querySelector('#member-period-preset option[value="first-half"]')?.textContent).toBe('上期（3月～8月）');
        expect(page.querySelector('#member-period-preset option[value="second-half"]')?.textContent).toBe('下期（9月～2月）');
        expect(expandButton?.getAttribute('aria-label')).toBe('すべて展開');
        expect(collapseButton?.getAttribute('aria-label')).toBe('すべて折りたたみ');
        expect(expandButton?.querySelector('.ui-icon')).not.toBeNull();
        expect(collapseButton?.querySelector('.ui-icon')).not.toBeNull();
        expect(toolbar?.querySelector('#gantt-export-csv')).toBeNull();
        expect(toolbar?.querySelector('#gantt-export-image')).toBeNull();
        expect(controls?.querySelector('#shared-period-preset')).toBeNull();
        expect(controls?.querySelector('#gantt-export-csv')).not.toBeNull();
        expect(controls?.querySelector('#gantt-export-image')).not.toBeNull();
    });

    it('keeps the CSV export button in the collapsible gantt controls', async () => {
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');

        await initGantt();

        const controls = document.getElementById('gantt-controls-body');
        const button = controls?.querySelector('#gantt-export-csv');

        expect(button).not.toBeNull();
    });

    it('honors collapse-all when it is pressed before gantt data finishes loading', async () => {
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');

        const initialization = initGantt();
        document.getElementById('gantt-collapse-all')?.click();
        await initialization;

        expect(document.querySelectorAll('.gantt-row-member')).toHaveLength(1);
        expect(document.querySelectorAll('.gantt-row-member.hidden-row')).toHaveLength(1);
        expect(document.querySelector('.theme-toggle')?.getAttribute('aria-expanded')).toBe('false');

        document.getElementById('gantt-expand-all')?.click();
        expect(document.querySelectorAll('.gantt-row-member.hidden-row')).toHaveLength(0);
        expect(document.querySelector('.theme-toggle')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('keeps bulk expand and collapse interactive after a local rerender', async () => {
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');

        await initGantt();
        document.querySelector('.theme-toggle')?.click();

        const toolbar = document.querySelector('.gantt-floating-actions');
        const expandButton = document.getElementById('gantt-expand-all');
        const collapseButton = document.getElementById('gantt-collapse-all');

        expect(toolbar?.classList.contains('pointer-shield')).toBe(true);
        expect(expandButton?.getAttribute('data-interactive-surface')).toBe('true');
        expect(collapseButton?.getAttribute('data-interactive-surface')).toBe('true');

        collapseButton?.click();
        expect(document.querySelectorAll('.gantt-row-member.hidden-row')).toHaveLength(1);
        expect(document.querySelector('.theme-toggle')?.getAttribute('aria-expanded')).toBe('false');

        expandButton?.click();
        expect(document.querySelectorAll('.gantt-row-member.hidden-row')).toHaveLength(0);
        expect(document.querySelector('.theme-toggle')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('exports the visible gantt table as a PNG image', async () => {
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');

        await initGantt();
        document.getElementById('gantt-export-image')?.click();

        await vi.waitFor(() => {
            expect(toPng).toHaveBeenCalled();
            expect(clickSpy).toHaveBeenCalled();
        });
        expect(toPng.mock.calls[0][0]).toBe(document.getElementById('gantt-table'));
        expect(toPng.mock.calls[0][1]).toMatchObject({
            backgroundColor: '#ffffff',
            cacheBust: true,
        });
        expect(showToast).toHaveBeenCalledWith('ガントチャート画像を書き出しました。', 'success');

        clickSpy.mockRestore();
    });

    it('keeps planning controls in their static DOM locations across gantt refreshes', async () => {
        const { initGantt, refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await initGantt();
        await refreshGantt();

        const toolbar = document.querySelector('.gantt-floating-actions');
        const controls = document.getElementById('gantt-controls-body');
        expect(document.getElementById('gantt-inline-period-controls')).toBeNull();
        expect(document.getElementById('gantt-table-actions')).toBeNull();
        expect(document.getElementById('gantt-table-tools')).toBeNull();
        expect(document.getElementById('scale-switcher')?.parentElement).toBe(document.body);
        expect(toolbar?.contains(document.getElementById('shared-period-preset'))).toBe(true);
        expect(controls?.contains(document.getElementById('gantt-export-csv'))).toBe(true);
        expect(controls?.contains(document.getElementById('gantt-export-image'))).toBe(true);
    });

    it('keeps the label column fixed while visible months consume the remaining width', async () => {
        visibleMonths = ['2026-04', '2026-05', '2026-06'];
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const table = document.getElementById('gantt-table');
        const columns = table?.querySelector('colgroup.gantt-columns');
        expect(table?.style.getPropertyValue('--gantt-visible-month-count')).toBe('3');
        expect(columns?.querySelectorAll('col')).toHaveLength(2);
        expect(columns?.querySelector('.gantt-label-column')).not.toBeNull();
        expect(columns?.querySelector('.gantt-month-column')?.getAttribute('span')).toBe('3');

        visibleMonths = ['2026-04'];
        await refreshGantt();

        expect(table?.style.getPropertyValue('--gantt-visible-month-count')).toBe('1');
        expect(columns?.querySelector('.gantt-month-column')?.getAttribute('span')).toBe('1');
        expect(table?.querySelectorAll('colgroup.gantt-columns')).toHaveLength(1);
    });

    it('reserves theme-name space instead of letting hidden row actions consume it', () => {
        const css = readFileSync(resolve(process.cwd(), 'css/gantt.css'), 'utf8');
        const responsiveActions = css.slice(css.indexOf('@media (min-width: 721px)'));

        expect(css).toContain('--gantt-label-column-width: 420px;');
        expect(css).toContain('--gantt-label-column-width: 360px;');
        expect(css).toContain('--gantt-label-column-width: 240px;');
        expect(css).toMatch(/\.theme-toggle\s*\{[^}]*flex:\s*1 1 auto;/s);
        expect(css).toMatch(/\.theme-name-text\s*\{[^}]*flex:\s*1 1 auto;/s);
        expect(responsiveActions).toMatch(/\.theme-label-actions\s*\{[^}]*position:\s*absolute;/s);
        expect(responsiveActions).toMatch(/\.theme-label-actions\s*\{[^}]*pointer-events:\s*none;/s);
    });

    it('keeps rank, priority, development status, and plan certainty visible in the theme label metadata', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const metadata = document.querySelector('.gantt-row-summary .theme-label-meta');
        expect(metadata?.querySelector('.theme-dev-rank-badge')?.textContent).toBe('ランク S');
        expect(metadata?.querySelector('.theme-priority-badge')?.textContent).toBe('P0');
        expect(metadata?.querySelector('.theme-status-select')?.value).toBe('active');
        expect(metadata?.querySelector('.theme-plan-certainty-select')?.value).toBe('confirmed');
        expect(metadata?.querySelector('.theme-plan-certainty-select')?.textContent).toContain('確');
        expect(metadata?.querySelector('.theme-milestone-btn')).toBeNull();
        expect(metadata?.querySelector('.theme-assign-btn')).toBeNull();
    });

    it('saves plan certainty from the control beside the development status', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const select = document.querySelector('.theme-plan-certainty-select');
        select.value = 'tentative';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(themeUpdate).toHaveBeenCalledWith(1, { plan_certainty: 'tentative' });
        expect(setSaveState).toHaveBeenCalledWith('saved', '計画確度を保存しました');
    });

    it('handles the static bucket control without taking ownership of the shared preset', async () => {
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        const { updateViewState } = await import('../js/shared-state.js');

        await initGantt();

        document.querySelector('#scale-switcher .scale-btn[data-scale="3"]')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(updateViewState).toHaveBeenCalledWith({ bucketMonths: 3 }, { source: 'gantt-period' });

        updateViewState.mockClear();
        const preset = document.getElementById('shared-period-preset');
        preset.value = 'rolling-12';
        preset.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

        expect(updateViewState).not.toHaveBeenCalled();
    });

    it('renders milestone markers on the matching theme month', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const milestones = Array.from(document.querySelectorAll('.gantt-row-summary .gantt-milestone-chip'));
        expect(milestones).toHaveLength(1);
        expect(milestones.map((item) => item.textContent)).toEqual(['Review']);
        expect(milestones[0]?.getAttribute('title')).toContain('Theme A');
    });

    it('highlights only the clicked month column', async () => {
        visibleMonths = ['2026-04', '2026-05'];
        allocationRows = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 1, member_id: 10, month: '2026-05', allocation_rate: 30, memo: '' },
        ];

        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const aprilCell = document.querySelector('.gantt-cell[data-theme][data-month="2026-04"]');
        const mayCell = document.querySelector('.gantt-cell[data-theme][data-month="2026-05"]');

        aprilCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-gantt-month="2026-04"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('td[data-gantt-month="2026-04"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('th[data-gantt-month="2026-05"]')?.classList.contains('month-selected')).toBe(false);

        mayCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-gantt-month="2026-04"]')?.classList.contains('month-selected')).toBe(false);
        expect(document.querySelector('th[data-gantt-month="2026-05"]')?.classList.contains('month-selected')).toBe(true);
        expect(document.querySelector('td[data-gantt-month="2026-05"]')?.classList.contains('month-selected')).toBe(true);

        mayCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('th[data-gantt-month="2026-05"]')?.classList.contains('month-selected')).toBe(false);
        expect(document.querySelector('td[data-gantt-month="2026-05"]')?.classList.contains('month-selected')).toBe(false);
    });

    it('adds a summary tooltip with member breakdown', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const summaryCell = document.querySelector('.gantt-row-summary .gantt-cell');
        expect(summaryCell?.getAttribute('title')).toContain('Alice: 20%');
    });

    it('opens the milestone editor when a summary cell is clicked', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const summaryCell = document.querySelector('.gantt-row-summary .gantt-summary-cell');
        summaryCell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.getElementById('modal-overlay')?.hidden).toBe(false);
        expect(document.getElementById('modal-title')?.textContent).not.toBe('');
    });

    it('creates and syncs multi-filter controls for gantt search', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04',
            scale: 1,
            ganttSearch: 'alice',
            ganttCategory: 'Delivery',
            ganttOwner: 'alice',
            ganttShowOtherMembers: false,
            ganttStatus: ['planning', 'active'],
            ganttPriority: '1',
            groupBy: 'status',
        });

        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        expect(document.getElementById('gantt-category-filter')).not.toBeNull();
        expect(document.getElementById('gantt-owner-filter')).not.toBeNull();
        expect([...document.querySelectorAll('#gantt-status-filter input:checked')].map((input) => input.value)).toEqual(['planning', 'active']);
        expect(document.querySelector('[data-gantt-status-label]')?.textContent).toBe('ステータス: 2件選択');
        expect(document.getElementById('gantt-priority-filter')?.value).toBe('1');
        expect(document.getElementById('gantt-owner-filter')?.value).toBe('Alice');
        expect(document.getElementById('gantt-show-other-members')?.value).toBe('selected');
        expect(document.getElementById('gantt-show-other-members')?.disabled).toBe(false);

        document.querySelector('#gantt-status-filter input[value="planning"]').checked = false;
        document.querySelector('#gantt-status-filter input[value="completed"]').checked = true;
        document.querySelector('#gantt-status-filter input[value="completed"]').dispatchEvent(new Event('change', { bubbles: true }));

        expect(sharedState.updateViewState).toHaveBeenCalledWith({ ganttStatus: ['active', 'completed'] }, { source: 'gantt-filter' });

        document.getElementById('gantt-show-other-members').value = 'all';
        document.getElementById('gantt-show-other-members').dispatchEvent(new Event('change', { bubbles: true }));
        expect(sharedState.updateViewState).toHaveBeenCalledWith({ ganttShowOtherMembers: true }, { source: 'gantt-filter' });
    });

    it('can hide other member rows while keeping matching projects and project totals visible', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04',
            scale: 1,
            ganttSearch: '',
            ganttCategory: '',
            ganttOwner: 'alice',
            ganttShowOtherMembers: false,
            ganttStatus: ['all'],
            ganttPriority: 'all',
            groupBy: 'none',
        });
        themeList.mockResolvedValueOnce([{
            theme_id: 1,
            name: 'Shared Project',
            status: 'active',
            plan_certainty: 'tentative',
            dev_rank: 'M',
            color: '#00aaff',
            category: 'Delivery',
            milestones: [],
            member_ids: [10, 20],
        }]);
        memberList.mockResolvedValueOnce([
            { member_id: 10, display_name: 'Alice', department: 'Dev', capacity: 100, is_active: true },
            { member_id: 20, display_name: 'Bob', department: 'QA', capacity: 100, is_active: true },
        ]);
        allocationRows = [
            { theme_id: 1, member_id: 10, month: '2026-04', allocation_rate: 20, memo: '' },
            { theme_id: 1, member_id: 20, month: '2026-04', allocation_rate: 30, memo: '' },
        ];

        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        expect(document.querySelector('.gantt-row-summary .theme-name-text')?.textContent).toBe('Shared Project');
        expect(document.querySelector('.gantt-row-summary .gantt-summary-cell')?.textContent).toContain('50%');
        expect([...document.querySelectorAll('.gantt-row-member .member-name')].map((element) => element.textContent)).toEqual(['Alice']);
        expect(document.getElementById('gantt-active-filters')?.textContent).toContain('担当者行: 選択した人のみ');
    });

    it('shows themes matching any selected status', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04',
            scale: 1,
            ganttSearch: '',
            ganttCategory: '',
            ganttOwner: '',
            ganttStatus: ['planning', 'active'],
            ganttPriority: 'all',
            groupBy: 'none',
        });
        themeList.mockResolvedValueOnce([
            { theme_id: 1, name: 'Planning Theme', status: 'planning', color: '#00aaff', category: 'Delivery', milestones: [], member_ids: [] },
            { theme_id: 2, name: 'Active Theme', status: 'active', color: '#00aaff', category: 'Delivery', milestones: [], member_ids: [] },
            { theme_id: 3, name: 'Completed Theme', status: 'completed', color: '#00aaff', category: 'Delivery', milestones: [], member_ids: [] },
        ]);

        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        const visibleThemes = [...document.querySelectorAll('.gantt-row-summary .theme-name-text')]
            .map((element) => element.textContent);
        expect(visibleThemes).toEqual(['Planning Theme', 'Active Theme']);
        expect(document.getElementById('gantt-active-filters')?.textContent).toContain('ステータス: 計画中');
        expect(document.getElementById('gantt-active-filters')?.textContent).toContain('ステータス: 進行中');
    });

    it('renders a P0 badge for zero-priority themes', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const badge = document.querySelector('.theme-priority-badge');
        expect(badge?.textContent).toBe('P0');
    });

    it('renders the development rank badge on the gantt summary row', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const badge = document.querySelector('.theme-dev-rank-badge');
        expect(badge?.textContent).toBe('ランク S');
    });

    it('greys out completed theme rows', async () => {
        themeList.mockResolvedValueOnce([{
            theme_id: 1,
            name: 'Theme A',
            status: 'completed',
            dev_rank: 'S',
            color: '#00aaff',
            category: 'Delivery',
            milestones: [],
            member_ids: [10],
        }]);

        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        expect(document.querySelector('.gantt-row-summary')?.classList.contains('theme-row-completed')).toBe(true);
        expect(document.querySelector('.gantt-row-member')?.classList.contains('theme-row-completed')).toBe(true);
        expect(document.querySelector('.gantt-row-summary')?.classList.contains('theme-row-inactive')).toBe(true);
        expect(document.querySelector('.gantt-row-member')?.classList.contains('theme-row-inactive')).toBe(true);
    });

    it('greys out cancelled theme rows as inactive', async () => {
        themeList.mockResolvedValueOnce([{
            theme_id: 1,
            name: 'Theme A',
            status: 'cancelled',
            dev_rank: 'S',
            color: '#00aaff',
            category: 'Delivery',
            milestones: [],
            member_ids: [10],
        }]);

        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');
        await refreshGantt();

        expect(document.querySelector('.gantt-row-summary')?.classList.contains('theme-row-cancelled')).toBe(true);
        expect(document.querySelector('.gantt-row-summary')?.classList.contains('theme-row-inactive')).toBe(true);
        expect(document.querySelector('.gantt-row-member')?.classList.contains('theme-row-inactive')).toBe(true);
    });

    it('creates and removes the mobile theme navigator when the viewport crosses the breakpoint', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04',
            scale: 1,
            ganttSearch: '',
            ganttCategory: '',
            ganttOwner: '',
            ganttStatus: 'all',
            ganttPriority: 'all',
            groupBy: 'none',
        });
        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();
        const mobileList = document.getElementById('gantt-mobile-theme-list');

        expect(mobileList?.hidden).toBe(true);
        expect(mobileList?.children).toHaveLength(0);

        window.innerWidth = 390;
        window.dispatchEvent(new Event('resize'));
        expect(mobileList?.hidden).toBe(false);
        expect(mobileList?.querySelectorAll('[data-mobile-theme-id]')).toHaveLength(1);

        window.innerWidth = 1024;
        window.dispatchEvent(new Event('resize'));
        expect(mobileList?.hidden).toBe(true);
        expect(mobileList?.children).toHaveLength(0);
    });

    it('supports grouping by development rank', async () => {
        const sharedState = await import('../js/shared-state.js');
        sharedState.loadViewState.mockReturnValue({
            startMonth: '2026-04',
            scale: 1,
            ganttSearch: '',
            ganttCategory: '',
            ganttOwner: '',
            ganttStatus: 'all',
            ganttPriority: 'all',
            groupBy: 'dev-rank',
        });

        const { initGantt } = await import('../js/gantt/gantt-renderer.js');
        await initGantt();

        expect(document.querySelector('.gantt-row-group')?.textContent).toContain('Rank S');
    });

    it('opens and saves milestone edits from the gantt screen', async () => {
        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');

        await refreshGantt();

        const button = document.querySelector('.theme-milestone-btn');
        expect(button).not.toBeNull();
        expect(button?.getAttribute('title')).toBe('マイルストーン');
        expect(button?.getAttribute('aria-label')).toContain('Theme A');

        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.getElementById('modal-overlay')?.hidden).toBe(false);
        const rows = document.querySelectorAll('.theme-milestone-row');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.theme-milestone-month')?.value).toBe('2026-04');
        expect(rows[0].querySelector('.theme-milestone-completed')?.checked).toBe(true);
        expect(rows[1].querySelector('.theme-milestone-month')?.value).toBe('2026-05');

        rows[0].querySelector('.theme-milestone-month').value = '2026-05';
        rows[0].querySelector('.theme-milestone-label').value = 'Launch';
        document.getElementById('modal-save-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await Promise.resolve();

        expect(themeUpdate).toHaveBeenCalledWith(1, {
            dev_complete_months: [],
            milestones: [
                { month: '2026-05', label: 'Launch', is_completed: true },
                { month: '2026-05', label: 'Release', is_completed: false },
            ],
        });
    });

    it('saves multiple development-complete months from the gantt editor', async () => {
        themeList.mockResolvedValueOnce([{
            theme_id: 1,
            name: 'Theme A',
            status: 'active',
            dev_rank: 'S',
            color: '#00aaff',
            category: 'Delivery',
            dev_complete_months: [
                { month: '2026-04', is_completed: false },
                { month: '2026-06', is_completed: true },
            ],
            milestones: [],
            member_ids: [10],
        }]);

        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');
        await refreshGantt();

        document.querySelector('.theme-milestone-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const rows = document.querySelectorAll('.theme-dev-complete-row');
        expect(rows).toHaveLength(2);
        rows[1].querySelector('.theme-dev-complete-month').value = '2026-05';
        rows[1].querySelector('.theme-dev-complete-completed').checked = true;

        document.getElementById('modal-save-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();

        expect(themeUpdate).toHaveBeenCalledWith(1, expect.objectContaining({
            dev_complete_months: [
                { month: '2026-04', is_completed: false },
                { month: '2026-05', is_completed: true },
            ],
        }));
    });

    it('greys out completed development-complete markers', async () => {
        themeList.mockResolvedValueOnce([{
            theme_id: 1,
            name: 'Theme A',
            status: 'active',
            dev_rank: 'S',
            color: '#00aaff',
            category: 'Delivery',
            dev_complete_months: [{ month: '2026-04', is_completed: true }],
            milestones: [],
            member_ids: [10],
        }]);

        const { refreshGantt } = await import('../js/gantt/gantt-renderer.js');
        await refreshGantt();

        const marker = document.querySelector('.gantt-star-label');
        expect(marker?.classList.contains('completed')).toBe(true);
    });
});
