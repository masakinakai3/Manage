// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const openCellEditor = vi.fn();
const setBusyState = vi.fn();
const setSaveState = vi.fn();
const showToast = vi.fn();
const showConfirmDialog = vi.fn();
const showPromptDialog = vi.fn();
const formatError = vi.fn((error) => error.message);

const themeList = vi.fn(async () => ([{
    theme_id: 1,
    name: 'Theme A',
    status: 'active',
    color: '#00aaff',
    category: 'Delivery',
    member_ids: [10],
}]));
const memberList = vi.fn(async () => ([{
    member_id: 10,
    display_name: 'Alice',
    department: 'Dev',
    capacity: 100,
    is_active: true,
}]));
const allocationList = vi.fn(async () => ([{
    theme_id: 1,
    member_id: 10,
    month: '2026-04',
    allocation_rate: 20,
    memo: '',
}]));
const warnings = vi.fn(async () => ([]));
const memberLoads = vi.fn(async () => ({ 10: { '2026-04': 20 } }));
const snapshotList = vi.fn(async () => ([]));

vi.mock('../js/gantt/gantt-editor.js', () => ({
    openCellEditor,
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
    loadViewState: vi.fn(() => ({ startMonth: '2026-04', scale: 1, ganttSearch: '' })),
    subscribeViewState: vi.fn(() => () => {}),
    updateViewState: vi.fn(),
}));

vi.mock('../js/utils/date-utils.js', () => ({
    addMonths: vi.fn((month) => month),
    currentMonth: vi.fn(() => '2026-04'),
    formatMonthHeader: vi.fn((month) => month),
    getVisibleMonths: vi.fn(() => ['2026-04']),
}));

vi.mock('../js/api.js', () => ({
    allocations: {
        list: allocationList,
        warnings,
        memberLoads,
        updateSingle: vi.fn(async () => ({})),
        bulkUpdate: vi.fn(async () => ({})),
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
        assignMembersBulk: vi.fn(),
    },
}));

function renderBaseDom() {
    document.body.innerHTML = `
        <div id="scale-switcher"><button class="scale-btn" data-scale="1" type="button">1</button></div>
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
        renderBaseDom();
        openCellEditor.mockClear();
        setBusyState.mockClear();
        setSaveState.mockClear();
        showToast.mockClear();
        showConfirmDialog.mockClear();
        showPromptDialog.mockClear();
        themeList.mockClear();
        memberList.mockClear();
        allocationList.mockClear();
        warnings.mockClear();
        memberLoads.mockClear();
        snapshotList.mockClear();
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
});
