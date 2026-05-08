import { allocations, members as membersApi, snapshots as snapshotsApi, themes as themesApi } from '../api.js';
import { getPresetConfig, loadViewState, subscribeViewState, updateViewState } from '../shared-state.js';
import { getShortcutKey, shouldIgnoreShortcut } from '../shortcut-utils.js';
import { addMonths, currentMonth, formatMonthHeader, getVisibleMonths } from '../utils/date-utils.js';
import { formatError, setBusyState, setSaveState, showConfirmDialog, showPromptDialog, showToast } from '../ui.js';
import { closeCellEditor, isCellEditorOpen, openCellEditor } from './gantt-editor.js';
import { initGanttDnD } from './gantt-dnd.js';

const STATUS_LABELS = { planning: 'Planning', active: 'Active', stop: 'STOP', completed: 'Completed', cancelled: 'Cancelled' };
const DEV_RANK_LABELS = { '': '-', S: 'S', M: 'M', L: 'L' };
const SCENARIO_RETURN_LABEL = '\u30A4\u30F3\u30B5\u30A4\u30C8\u306B\u623B\u308B';
const SCENARIO_CLEAR_LABEL = '\u89E3\u9664';

export const HistoryManager = {
    limit: 50,
    stack: [],
    index: -1,
    isApplyingHistory: false,
    push(undo, redo, options = {}) {
        this.stack = this.stack.slice(0, this.index + 1);
        this.stack.push({ undo, redo, apply: options.apply || null });
        if (this.stack.length > this.limit) {
            const overflow = this.stack.length - this.limit;
            this.stack.splice(0, overflow);
        }
        this.index = this.stack.length - 1;
    },
    async perform(data) {
        applyHistoryRowsOptimistically(data);
        try {
            await allocations.bulkUpdate(data);
            await refreshGantt();
        } catch (error) {
            await refreshGantt();
            throw error;
        }
    },
    async undo() {
        if (this.isApplyingHistory || this.index < 0) return;
        this.isApplyingHistory = true;
        try {
            const action = this.stack[this.index--];
            await (action.apply || this.perform.bind(this))(action.undo);
        } finally {
            this.isApplyingHistory = false;
        }
    },
    async redo() {
        if (this.isApplyingHistory || this.index >= this.stack.length - 1) return;
        this.isApplyingHistory = true;
        try {
            const action = this.stack[++this.index];
            await (action.apply || this.perform.bind(this))(action.redo);
        } finally {
            this.isApplyingHistory = false;
        }
    },
};

function buildAllocationSnapshot(themeId, memberId, month) {
    const current = allAllocations.find((item) => item.theme_id === themeId && item.member_id === memberId && item.month === month);
    return {
        theme_id: themeId,
        member_id: memberId,
        month,
        allocation_rate: current?.allocation_rate || 0,
        memo: current?.memo || '',
    };
}

async function commitSingleCellChange(themeId, memberId, month, allocationRate, memo, { optimisticButton = null, successMessage = '', previousSnapshot = null } = {}) {
    const nextRate = Math.max(0, Math.min(100, Number.parseInt(allocationRate || '0', 10) || 0));
    const nextMemo = String(memo || '');
    const undo = previousSnapshot
        ? {
            theme_id: themeId,
            member_id: memberId,
            month,
            allocation_rate: Math.max(0, Math.min(100, Number.parseInt(previousSnapshot.allocation_rate || '0', 10) || 0)),
            memo: String(previousSnapshot.memo || ''),
        }
        : buildAllocationSnapshot(themeId, memberId, month);
    const redo = {
        theme_id: themeId,
        member_id: memberId,
        month,
        allocation_rate: nextRate,
        memo: nextMemo,
    };

    if (undo.allocation_rate === redo.allocation_rate && undo.memo === redo.memo) {
        return false;
    }

    if (optimisticButton) {
        applyCellValue(optimisticButton, nextRate, nextMemo);
    }

    HistoryManager.push([undo], [redo]);

    try {
        await HistoryManager.perform([redo]);
        if (successMessage) setSaveState('saved', successMessage);
        return true;
    } catch (error) {
        if (HistoryManager.index >= 0) {
            HistoryManager.stack.splice(HistoryManager.index, 1);
            HistoryManager.index -= 1;
        }
        throw error;
    }
}

let allThemes = [];
let allMembers = [];
let allAllocations = [];
let warnings = [];
let memberLoads = {};
let snapshotAllocations = [];
let startMonth = addMonths(currentMonth(), -1);
let scale = 1;
let visibleCount = 14;
let searchQuery = '';
let categoryFilter = '';
let ownerFilter = '';
let statusFilter = 'all';
let priorityFilter = 'all';
let groupBy = 'none';
let selectedMonth = null;
let collapsedThemes = new Set();
let selectedCell = null;
let selectionAnchor = null;
let selectedRange = null;
let copiedRange = null;
let ganttKeyboardBound = false;
let scenarioPreviewState = null;
let scenarioPreviewContext = null;
let ganttRefreshRequestId = 0;

export function showScenarioPreview(preview) {
    scenarioPreviewState = normalizeScenarioPreviewState(preview);
    rerenderGanttView();
}

export function clearScenarioPreview() {
    if (!scenarioPreviewState) return;
    scenarioPreviewState = null;
    rerenderGanttView();
}

function normalizeScenarioPreviewState(preview) {
    if (!preview) return null;
    const previews = (Array.isArray(preview.previews) ? preview.previews : [preview]).filter(Boolean);
    if (!previews.length) return null;
    const rawIndex = Number.parseInt(String(preview.selectedIndex ?? 0), 10);
    const selectedIndex = Number.isFinite(rawIndex) ? Math.min(Math.max(rawIndex, 0), previews.length - 1) : 0;
    return { previews, selectedIndex };
}

function getActiveScenarioPreview() {
    if (!scenarioPreviewState?.previews?.length) return null;
    return scenarioPreviewState.previews[scenarioPreviewState.selectedIndex] || scenarioPreviewState.previews[0] || null;
}

function getScenarioPreviewOptionLabel(preview, index) {
    const label = preview?.scenarioLabel || String(index + 1);
    const title = String(preview?.title || '').trim();
    if (!title) return label;
    return title.startsWith(`[${label}]`) ? title : `[${label}] ${title}`;
}

function selectScenarioPreview(index, { syncViewState = false } = {}) {
    if (!scenarioPreviewState?.previews?.length) return;
    const normalizedIndex = Math.min(Math.max(index, 0), scenarioPreviewState.previews.length - 1);
    if (scenarioPreviewState.selectedIndex === normalizedIndex && !syncViewState) {
        rerenderGanttView();
        return;
    }

    scenarioPreviewState = {
        ...scenarioPreviewState,
        selectedIndex: normalizedIndex,
    };

    const activePreview = getActiveScenarioPreview();
    rerenderGanttView();

    if (syncViewState && activePreview?.startMonth) {
        updateViewState({
            startMonth: activePreview.startMonth,
            scale: 1,
        });
    }
}

function returnToInsightsFromScenarioPreview() {
    clearScenarioPreview();
    document.querySelector('.nav-item[data-view="insights"]')?.click();
}

function ensureToolbar() {
    const toolbar = document.querySelector('.gantt-floating-actions');
    if (!toolbar) return null;
    toolbar.classList.add('pointer-shield');
    return toolbar;
}

function markInteractiveSurface(element) {
    if (!element) return null;
    element.setAttribute('data-interactive-surface', 'true');
    return element;
}

function ensureToolbarSlot(id, className, { prepend = false } = {}) {
    const toolbar = ensureToolbar();
    if (!toolbar) return null;

    let slot = document.getElementById(id);
    if (!slot) {
        slot = document.createElement('div');
        slot.id = id;
        slot.className = className;
        prepend ? toolbar.prepend(slot) : toolbar.appendChild(slot);
    }

    return markInteractiveSurface(slot);
}

function moveControlsToToolbarSlot(slot, controls) {
    if (!slot) return;
    controls.filter(Boolean).forEach((control) => {
        markInteractiveSurface(control);
        if (control.parentElement !== slot) {
            slot.append(control);
        }
    });
}

function renderScenarioToolbarActions() {
    const container = ensureToolbarSlot('gantt-scenario-actions', 'gantt-scenario-actions', { prepend: true });
    if (!container) return;
    if (!scenarioPreviewState) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }
    container.hidden = false;

    const options = scenarioPreviewState.previews.map((preview, index) => `
        <option value="${index}" ${index === scenarioPreviewState.selectedIndex ? 'selected' : ''}>${escapeHtml(getScenarioPreviewOptionLabel(preview, index))}</option>
    `).join('');

    container.innerHTML = `
        ${scenarioPreviewState.previews.length > 1 ? `
            <label class="gantt-scenario-select">
                <span>提案</span>
                <select data-scenario-select-toolbar="true">${options}</select>
            </label>
        ` : ''}
        <button class="btn btn-primary btn-sm" type="button" data-scenario-return-toolbar="true">${SCENARIO_RETURN_LABEL}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-scenario-clear-toolbar="true">${SCENARIO_CLEAR_LABEL}</button>
    `;
    container.querySelector('[data-scenario-select-toolbar="true"]')?.addEventListener('change', (event) => {
        const nextIndex = Number.parseInt(event.target.value, 10);
        selectScenarioPreview(Number.isFinite(nextIndex) ? nextIndex : 0, { syncViewState: true });
    });
    container.querySelector('[data-scenario-return-toolbar="true"]')?.addEventListener('click', () => returnToInsightsFromScenarioPreview());
    container.querySelector('[data-scenario-clear-toolbar="true"]')?.addEventListener('click', () => clearScenarioPreview());
}

export async function initGantt() {
    const state = loadViewState();
    startMonth = state.startMonth;
    scale = state.scale;
    visibleCount = state.visibleCount || getPresetConfig(state.preset || 'rolling-6').visibleCount;
    searchQuery = state.ganttSearch || '';
    categoryFilter = state.ganttCategory || '';
    ownerFilter = state.ganttOwner || '';
    statusFilter = state.ganttStatus || 'all';
    priorityFilter = state.ganttPriority || 'all';
    groupBy = state.groupBy || 'none';
    bindControls();
    await loadSnapshots();
    subscribeViewState((next) => {
        startMonth = next.startMonth;
        scale = next.scale;
        visibleCount = next.visibleCount || getPresetConfig(next.preset || 'rolling-6').visibleCount;
        searchQuery = next.ganttSearch || '';
        categoryFilter = next.ganttCategory || '';
        ownerFilter = next.ganttOwner || '';
        statusFilter = next.ganttStatus || 'all';
        priorityFilter = next.ganttPriority || 'all';
        groupBy = next.groupBy || 'none';
        syncFilterInputs();
        syncPeriodControls();
        refreshGantt();
    });
    hydrateCollapsed();
    initGanttDnD({ performMove: performDragAndDropMove });
    await refreshGantt();
}

function ensureInlinePeriodControls() {
    const toolbar = ensureToolbar();
    const scaleSwitcher = document.getElementById('scale-switcher');
    const presetSelect = document.getElementById('shared-period-preset');
    const monthNav = document.getElementById('gantt-prev')?.closest('.month-nav') || document.querySelector('.gantt-control-row-primary .month-nav');
    if (!toolbar || !scaleSwitcher || !presetSelect || !monthNav) return;

    const tableActions = ensureToolbarSlot('gantt-table-actions', 'gantt-table-actions', { prepend: true });
    ['gantt-expand-all', 'gantt-collapse-all', 'gantt-export-csv'].forEach((id) => {
        const action = document.getElementById(id);
        moveControlsToToolbarSlot(tableActions, [action]);
    });

    const inlineControls = ensureToolbarSlot('gantt-inline-period-controls', 'gantt-inline-period-controls');
    moveControlsToToolbarSlot(inlineControls, [scaleSwitcher, presetSelect, monthNav]);
    syncPeriodControls();
}

function syncPeriodControls() {
    const state = loadViewState();
    const presetSelect = document.getElementById('shared-period-preset');
    if (presetSelect && presetSelect.value !== state.preset) {
        presetSelect.value = state.preset;
    }
    syncScaleButtons();
}

export async function refreshGantt() {
    const requestId = ++ganttRefreshRequestId;
    ensureInlinePeriodControls();
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const from = months[0];
    const to = months[months.length - 1];
    const toEnd = scale > 1 ? addMonths(to, scale - 1) : to;
    try {
        setBusyState(true, 'ガントを読み込んでいます...');
        [allThemes, allMembers, allAllocations, warnings, memberLoads] = await Promise.all([
            themesApi.list(),
            membersApi.list(),
            allocations.list({ from, to: toEnd }),
            allocations.warnings(from, toEnd),
            allocations.memberLoads(from, toEnd),
        ]);
        if (requestId !== ganttRefreshRequestId) return;
        renderSnapshotSummaryCards(months);
        renderTable(months);
        renderDetailPanelV2();
    } catch (error) {
        if (requestId !== ganttRefreshRequestId) return;
        setSaveState('error', 'ガントの読み込みに失敗しました');
        showToast(`ガントの読み込みに失敗しました: ${formatError(error)}`, 'error');
    } finally {
        if (requestId !== ganttRefreshRequestId) return;
        setBusyState(false);
    }
}

function rerenderGanttView() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    renderSnapshotSummaryCards(months);
    renderTable(months);
    renderDetailPanelV2();
    renderScenarioToolbarActions();
}

function buildScenarioPreviewContext() {
    const scenarioPreview = getActiveScenarioPreview();
    if (!scenarioPreview) return null;

    const assignmentByKey = new Map();
    const assignmentTotalsByMonth = new Map();
    const membersById = new Map();
    const shiftOutByKey = new Map();
    const shiftInByKey = new Map();
    const shiftOutByThemeMonth = new Map();
    const shiftInByThemeMonth = new Map();

    (scenarioPreview.assignments || []).forEach((assignment) => {
        const memberKey = `${assignment.memberId}|${assignment.month}`;
        assignmentByKey.set(memberKey, (assignmentByKey.get(memberKey) || 0) + assignment.rate);
        assignmentTotalsByMonth.set(assignment.month, (assignmentTotalsByMonth.get(assignment.month) || 0) + assignment.rate);
        if (!membersById.has(assignment.memberId)) {
            membersById.set(assignment.memberId, {
                memberId: assignment.memberId,
                displayName: assignment.displayName,
                department: assignment.department || '',
            });
        }
    });

    (scenarioPreview.shiftSuggestions || []).forEach((item) => {
        const outKey = `${item.themeId}|${item.memberId}|${item.fromMonth}`;
        const inKey = `${item.themeId}|${item.memberId}|${item.toMonth}`;
        const outThemeKey = `${item.themeId}|${item.fromMonth}`;
        const inThemeKey = `${item.themeId}|${item.toMonth}`;
        shiftOutByKey.set(outKey, (shiftOutByKey.get(outKey) || 0) + item.rate);
        shiftInByKey.set(inKey, (shiftInByKey.get(inKey) || 0) + item.rate);
        shiftOutByThemeMonth.set(outThemeKey, (shiftOutByThemeMonth.get(outThemeKey) || 0) + item.rate);
        shiftInByThemeMonth.set(inThemeKey, (shiftInByThemeMonth.get(inThemeKey) || 0) + item.rate);
    });

    return {
        scenarioLabel: scenarioPreview.scenarioLabel || '提案',
        title: scenarioPreview.title || '提案プレビュー',
        startMonth: scenarioPreview.startMonth || '',
        previewThemeName: scenarioPreview.previewThemeName || '提案案件',
        assignmentByKey,
        assignmentTotalsByMonth,
        previewMembers: [...membersById.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, 'ja')),
        shiftOutByKey,
        shiftInByKey,
        shiftOutByThemeMonth,
        shiftInByThemeMonth,
        assignmentCount: (scenarioPreview.assignments || []).length,
        shiftCount: (scenarioPreview.shiftSuggestions || []).length,
    };
}

function renderScenarioPreviewSummaryCell(month, current) {
    const total = scenarioPreviewContext?.assignmentTotalsByMonth.get(month) || 0;
    return `<td class="${month === current ? 'month-current' : ''}" data-gantt-month="${month}"><div class="gantt-cell gantt-summary-cell scenario-preview-cell ${rateClass(total)}">${formatRateValue(total)}${total ? '<span class="scenario-preview-tag">提案</span>' : ''}</div></td>`;
}

function renderScenarioPreviewMemberCell(member, month, current) {
    const rate = scenarioPreviewContext?.assignmentByKey.get(`${member.memberId}|${month}`) || 0;
    return `<td class="${month === current ? 'month-current' : ''}" data-gantt-month="${month}"><div class="gantt-cell scenario-preview-cell ${rateClass(rate)}">${formatRateValue(rate)}${rate ? '<span class="scenario-preview-tag">追加</span>' : ''}</div></td>`;
}

function renderScenarioPreviewRows(months, current) {
    if (!scenarioPreviewContext) return [];
    const rows = [];
    rows.push(`
        <tr class="gantt-row-summary gantt-row-scenario">
            <td>
                <div class="theme-label-cell">
                    <div class="scenario-preview-label">
                        <span class="theme-color-bar scenario-preview-bar"></span>
                        <span class="theme-name-text">${escapeHtml(scenarioPreviewContext.previewThemeName)}</span>
                    </div>
                    <div class="theme-label-actions">
                        <span class="theme-priority-badge">${escapeHtml(scenarioPreviewContext.scenarioLabel || '提案')}</span>
                    </div>
                </div>
            </td>
            ${months.map((month) => renderScenarioPreviewSummaryCell(month, current)).join('')}
        </tr>
    `);

    scenarioPreviewContext.previewMembers.forEach((member) => {
        rows.push(`
            <tr class="gantt-row-member gantt-row-scenario">
                <td><div class="member-label-cell"><span>${escapeHtml(member.displayName)}</span><span class="member-capacity">${escapeHtml(member.department || '未設定')} / 提案割当</span></div></td>
                ${months.map((month) => renderScenarioPreviewMemberCell(member, month, current)).join('')}
            </tr>
        `);
    });
    return rows;
}

function scenarioMemberPreviewChip(themeId, memberId, month) {
    if (!scenarioPreviewContext) return '';
    const shiftOut = scenarioPreviewContext.shiftOutByKey.get(`${themeId}|${memberId}|${month}`) || 0;
    const shiftIn = scenarioPreviewContext.shiftInByKey.get(`${themeId}|${memberId}|${month}`) || 0;
    const chips = [];
    if (shiftOut > 0) chips.push(`<span class="scenario-chip scenario-chip-shift-out">-${shiftOut}</span>`);
    if (shiftIn > 0) chips.push(`<span class="scenario-chip scenario-chip-shift-in">+${shiftIn}</span>`);
    return chips.join('');
}

function scenarioThemePreviewChip(themeId, month) {
    if (!scenarioPreviewContext) return '';
    const shiftOut = scenarioPreviewContext.shiftOutByThemeMonth.get(`${themeId}|${month}`) || 0;
    const shiftIn = scenarioPreviewContext.shiftInByThemeMonth.get(`${themeId}|${month}`) || 0;
    const chips = [];
    if (shiftOut > 0) chips.push(`<span class="scenario-chip scenario-chip-shift-out">-${shiftOut}</span>`);
    if (shiftIn > 0) chips.push(`<span class="scenario-chip scenario-chip-shift-in">+${shiftIn}</span>`);
    return chips.join('');
}

function focusScenarioPreview() {
    const previewRow = document.querySelector('.gantt-row-scenario');
    if (!previewRow) return;
    previewRow.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

function bindControls() {
    ensureGanttFilterControls();
    document.addEventListener('click', (event) => {
        const scaleButton = event.target.closest('#scale-switcher .scale-btn');
        if (!scaleButton) return;
        const nextScale = Number.parseInt(scaleButton.dataset.scale, 10);
        if (Number.isFinite(nextScale)) updateViewState({ scale: nextScale });
    });
    document.addEventListener('change', (event) => {
        if (event.target.id !== 'shared-period-preset') return;
        const preset = event.target.value || 'rolling-6';
        updateViewState({ preset, ...getPresetConfig(preset) });
    });
    document.getElementById('gantt-theme-filter')?.addEventListener('change', (event) => updateViewState({ ganttSearch: event.target.value }));
    document.getElementById('gantt-category-filter')?.addEventListener('change', (event) => updateViewState({ ganttCategory: event.target.value }));
    document.getElementById('gantt-owner-filter')?.addEventListener('change', (event) => updateViewState({ ganttOwner: event.target.value.trim().toLowerCase() }));
    document.getElementById('gantt-status-filter')?.addEventListener('change', (event) => updateViewState({ ganttStatus: event.target.value }));
    document.getElementById('gantt-priority-filter')?.addEventListener('change', (event) => updateViewState({ ganttPriority: event.target.value }));
    document.getElementById('gantt-group-by')?.addEventListener('change', (event) => updateViewState({ groupBy: event.target.value }));
    document.getElementById('gantt-filter-reset')?.addEventListener('click', () => updateViewState({
        ganttSearch: '',
        ganttCategory: '',
        ganttOwner: '',
        ganttStatus: 'all',
        ganttPriority: 'all',
    }));
    document.getElementById('gantt-prev')?.addEventListener('click', () => updateViewState({ startMonth: addMonths(startMonth, -scale * 3) }));
    document.getElementById('gantt-next')?.addEventListener('click', () => updateViewState({ startMonth: addMonths(startMonth, scale * 3) }));
    document.getElementById('gantt-today')?.addEventListener('click', () => {
        const preset = document.getElementById('shared-period-preset').value || 'rolling-6';
        updateViewState({ preset, ...getPresetConfig(preset) });
    });
    document.getElementById('gantt-expand-all')?.addEventListener('click', () => { collapsedThemes.clear(); persistCollapsed(); rerenderGanttView(); });
    document.getElementById('gantt-collapse-all')?.addEventListener('click', () => { allThemes.forEach((theme) => collapsedThemes.add(theme.theme_id)); persistCollapsed(); rerenderGanttView(); });
    document.getElementById('gantt-export-csv')?.addEventListener('click', exportCsv);
    document.getElementById('snapshot-save-btn')?.addEventListener('click', saveSnapshot);
    document.getElementById('snapshot-select')?.addEventListener('change', loadSelectedSnapshot);
    document.getElementById('detail-save')?.addEventListener('click', saveSelectedCellWithHistory);
    bindHistoryInputs();
    document.getElementById('detail-prev')?.addEventListener('click', () => moveSelection(-1));
    document.getElementById('detail-next')?.addEventListener('click', () => moveSelection(1));
    document.getElementById('detail-next-empty')?.addEventListener('click', () => jumpToMatchingCell((button) => Number.parseInt(button.dataset.rate || '0', 10) === 0));
    document.getElementById('detail-next-warning')?.addEventListener('click', () => jumpToMatchingCell((button) => button.classList.contains('rate-over')));
    document.getElementById('detail-preview-bulk')?.addEventListener('click', previewBulkUpdate);
    bindKeyboardInteractions();
}

let historyInputsBound = false;

function bindHistoryInputs() {
    if (historyInputsBound) return;
    historyInputsBound = true;

    ['detail-rate', 'detail-bulk-rate'].forEach((id) => {
        document.getElementById(id)?.addEventListener('keydown', (event) => {
            const key = getShortcutKey(event);
            const isUndo = key === 'z' && !event.shiftKey;
            const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
            if (!(event.ctrlKey || event.metaKey) || (!isUndo && !isRedo)) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (isRedo) {
                void HistoryManager.redo();
            } else {
                void HistoryManager.undo();
            }
        });
    });
}

function ensureGanttFilterControls() {
    const search = document.getElementById('gantt-theme-filter');
    const groupByInput = document.getElementById('gantt-group-by');
    const controls = search?.parentElement;
    if (!search || !groupByInput || !controls) return;

    controls.classList.add('gantt-filter-bar');
    search.classList.add('gantt-filter-search');
    return;

    groupByInput.insertAdjacentHTML('beforebegin', `
        <select id="gantt-category-filter" class="view-select">
            <option value="">カテゴリ: すべて</option>
        </select>
        <input type="text" id="gantt-owner-filter" class="view-input" list="gantt-owner-suggestions" placeholder="担当者名で絞り込み" autocomplete="off">
        <datalist id="gantt-owner-suggestions"></datalist>
        <select id="gantt-status-filter" class="view-select">
            <option value="all">ステータス: すべて</option>
            <option value="open">ステータス: 未完了のみ</option>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
        </select>
        <select id="gantt-priority-filter" class="view-select">
            <option value="all">優先度: すべて</option>
            <option value="0">優先度: P0以上</option>
            <option value="1">優先度: P1以上</option>
            <option value="2">優先度: P2以上</option>
            <option value="3">優先度: P3以上</option>
        </select>
    `);
    controls.insertAdjacentHTML('beforeend', '<button id="gantt-filter-reset" class="btn btn-ghost btn-sm" type="button">絞り込み解除</button>');
}

async function saveSnapshot() {
    const name = await showPromptDialog({
        title: '比較スナップショットを保存',
        message: '比較に使う現在の状態へ名前を付けて保存します。',
        defaultValue: `比較 ${new Date().toLocaleString('ja-JP')}`,
        confirmText: '保存',
        cancelText: 'キャンセル',
    });
    if (!name) return;
    await snapshotsApi.create({ name, data: allAllocations });
    await loadSnapshots();
    showToast('比較スナップショットを保存しました。', 'success');
}

async function loadSnapshots() {
    const select = document.getElementById('snapshot-select');
    if (!select) return;
    select.innerHTML = '<option value="">スナップショット比較なし</option>';
    select.innerHTML = '<option value="">比較スナップショット</option>';
    const snapshots = await snapshotsApi.list().catch(() => []);
    snapshots.forEach((snapshot) => select.insertAdjacentHTML('beforeend', `<option value="${snapshot.id}">${snapshot.name}</option>`));
}

async function loadSelectedSnapshot(event) {
    if (!event.target.value) {
        snapshotAllocations = [];
        refreshGantt();
        return;
    }
    const snapshot = await snapshotsApi.get(event.target.value);
    snapshotAllocations = JSON.parse(snapshot.data || '[]');
    refreshGantt();
}

function renderSummary() {
    const target = document.getElementById('gantt-summary');
    if (!target) return;
    const assigned = new Set(allAllocations.map((item) => item.member_id)).size;
    const average = allMembers.length === 0 ? 0 : Math.round(allMembers.reduce((sum, member) => {
        const loads = Object.values(memberLoads[member.member_id] || {});
        return sum + (loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0);
    }, 0) / allMembers.length);
    target.innerHTML = `
        <article class="summary-card"><div class="summary-label">テーマ数</div><div class="summary-value">${allThemes.length}</div><div class="summary-subtext">進行中 ${allThemes.filter((t) => t.status === 'active').length} 件</div></article>
        <article class="summary-card"><div class="summary-label">平均メンバー負荷</div><div class="summary-value">${average}%</div><div class="summary-subtext">全メンバー平均</div></article>
        <article class="summary-card"><div class="summary-label">警告セル</div><div class="summary-value">${warnings.length}</div><div class="summary-subtext">過負荷メンバー ${new Set(warnings.map((w) => w.member_id)).size} 名</div></article>
        <article class="summary-card"><div class="summary-label">割当中メンバー</div><div class="summary-value">${assigned}</div><div class="summary-subtext">テーマに割当済み</div></article>`;
}

function renderAggregates() {
    if (!document.getElementById('aggregate-by-category')) return;
    renderAggregate('aggregate-by-category', countBy(allThemes, (theme) => theme.category || 'Uncategorized'), ' items');
    renderAggregate('aggregate-by-status', countBy(allThemes, (theme) => STATUS_LABELS[theme.status] || theme.status), '件');
    const departmentLoads = new Map();
    allMembers.forEach((member) => {
        const label = member.department || 'No Department';
        const loads = Object.values(memberLoads[member.member_id] || {});
        const avg = loads.length ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length) : 0;
        const bucket = departmentLoads.get(label) || { total: 0, count: 0 };
        bucket.total += avg;
        bucket.count += 1;
        departmentLoads.set(label, bucket);
    });
    renderAggregate('aggregate-by-department', new Map([...departmentLoads.entries()].map(([label, bucket]) => [label, `${Math.round(bucket.total / bucket.count)}%`])));
}

function renderAggregate(targetId, values, suffix = '') {
    const target = document.getElementById(targetId);
    if (!target) return;

    const entries = Array.from(values.entries());
    if (entries.length === 0) {
        target.innerHTML = '<div class="summary-subtext">データがありません。</div>';
        return;
    }

    target.innerHTML = entries
        .sort((left, right) => {
            const leftValue = parseFloat(String(left[1]).replace('%', '')) || 0;
            const rightValue = parseFloat(String(right[1]).replace('%', '')) || 0;
            return rightValue - leftValue;
        })
        .map(([label, value]) => `
            <div class="aggregate-row">
                <span>${label}</span>
                <strong>${typeof value === 'number' ? `${value}${suffix}` : value}</strong>
            </div>
        `)
        .join('');
}

function renderSnapshotSummary(months) {
    const target = document.getElementById('snapshot-diff-summary');
    if (!target) return;
    if (snapshotAllocations.length === 0) { target.innerHTML = ''; return; }
    let changed = 0;
    const themes = new Set();
    const members = new Set();
    months.forEach((month) => allAllocations.filter((item) => item.month === month).forEach((item) => {
        const oldRate = lookupRate(snapshotAllocations, item.theme_id, item.member_id, month);
        if (oldRate !== item.allocation_rate) { changed += 1; themes.add(item.theme_id); members.add(item.member_id); }
    }));
    target.innerHTML = `<article class="summary-card"><div class="summary-label">差分セル</div><div class="summary-value">${changed}</div><div class="summary-subtext">表示中のみ集計</div></article><article class="summary-card"><div class="summary-label">差分テーマ</div><div class="summary-value">${themes.size}</div><div class="summary-subtext">テーマ単位</div></article><article class="summary-card"><div class="summary-label">差分メンバー</div><div class="summary-value">${members.size}</div><div class="summary-subtext">メンバー単位</div></article>`;
}



function decorateThemeSummaryRows() {
    document.querySelectorAll('.gantt-row-summary').forEach((row) => {
        const themeId = Number.parseInt(row.dataset.themeId || '', 10);
        const theme = allThemes.find((item) => item.theme_id === themeId);
        const labelCell = row.querySelector('.theme-label-cell');
        if (!theme || !labelCell) return;

        const devRank = getDevRankLabel(theme.dev_rank);
        const existingBadge = labelCell.querySelector('.theme-dev-rank-badge');
        if (!existingBadge) {
            const priorityBadge = labelCell.querySelector('.theme-priority-badge');
            const markup = `<span class="theme-dev-rank-badge" title="開発ランク ${devRank}">${devRank}</span>`;
            if (priorityBadge) {
                priorityBadge.insertAdjacentHTML('beforebegin', markup);
            } else {
                labelCell.insertAdjacentHTML('beforeend', markup);
            }
        } else {
            existingBadge.textContent = devRank;
            existingBadge.setAttribute('title', `開発ランク ${devRank}`);
        }

        row.querySelectorAll('td:not(:first-child) .gantt-cell').forEach((cell) => {
            const hasSummaryValue = cell.querySelector('.gantt-summary-value, .gantt-star-label');
            if (hasSummaryValue) return;

            const textNode = Array.from(cell.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (!textNode) return;

            const wrapper = document.createElement('span');
            wrapper.className = 'gantt-summary-value';
            wrapper.textContent = textNode.textContent.trim();
            cell.replaceChild(wrapper, textNode);
        });
    });
}

function bindRows() {
    document.querySelectorAll('[data-gantt-month]').forEach((element) => element.addEventListener('click', () => {
        const month = element.dataset.ganttMonth || null;
        setSelectedMonth(selectedMonth === month ? null : month);
    }));
    document.querySelectorAll('.theme-toggle').forEach((button) => button.addEventListener('click', () => { const id = Number.parseInt(button.dataset.themeId, 10); collapsedThemes.has(id) ? collapsedThemes.delete(id) : collapsedThemes.add(id); persistCollapsed(); rerenderGanttView(); }));
    document.querySelectorAll('.theme-milestone-btn').forEach((button) => button.addEventListener('click', () => showMilestoneModal(Number.parseInt(button.dataset.themeId, 10))));
    document.querySelectorAll('.gantt-summary-cell[data-theme-id]').forEach((cell) => cell.addEventListener('click', () => {
        showMilestoneModal(Number.parseInt(cell.dataset.themeId, 10));
    }));
    document.querySelectorAll('.gantt-milestone-chip[data-theme-id]').forEach((chip) => chip.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('open-theme-edit', {
            detail: { themeId: Number.parseInt(chip.dataset.themeId, 10) },
        }));
    }));
    document.querySelectorAll('.theme-assign-btn').forEach((button) => button.addEventListener('click', () => showAssignMemberModal(Number.parseInt(button.dataset.themeId, 10))));
    document.querySelectorAll('.theme-status-select').forEach((select) => select.addEventListener('change', async (event) => {
        const themeId = Number.parseInt(event.target.dataset.themeId, 10);
        const status = event.target.value;
        const theme = allThemes.find((item) => item.theme_id === themeId);
        if (!theme || theme.status === status) return;

        event.target.disabled = true;
        try {
            setSaveState('saving', 'テーマステータスを保存しています...');
            await themesApi.update(themeId, { status });
            theme.status = status;
            setSaveState('saved', 'テーマステータスを保存しました');
            showToast('テーマのステータスを更新しました。', 'success');
            await refreshGantt();
        } catch (error) {
            event.target.value = theme.status;
            setSaveState('error', 'テーマステータスの更新に失敗しました');
            showToast(`テーマステータスの更新に失敗しました: ${formatError(error)}`, 'error');
        } finally {
            event.target.disabled = false;
        }
    }));
    document.querySelectorAll('.gantt-cell[data-theme]').forEach((button) => button.addEventListener('click', (event) => {
        selectCellButton(button, { extend: event.shiftKey });
        openEditorForButton(button);
    }));
    syncSelectionStyles();
    syncSelectedMonthStyles();
}

function themeStatusSelect(theme) {
    const options = Object.entries(STATUS_LABELS)
        .map(([value, label]) => `<option value="${value}" ${theme.status === value ? 'selected' : ''}>${label}</option>`)
        .join('');
    return `<select class="theme-status theme-status-select status-${theme.status}" data-theme-id="${theme.theme_id}" aria-label="${escapeHtml(theme.name)} のステータス">${options}</select>`;
}

function themeActionButton(theme, action) {
    const buttons = {
        milestone: {
            className: 'theme-milestone-btn',
            label: `${theme.name} のマイルストーンを編集`,
            title: 'マイルストーン',
            icon: `
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M8 1.5 9.7 4.9l3.8.5-2.8 2.6.7 3.7L8 9.9 4.6 11.7l.7-3.7L2.5 5.4l3.8-.5L8 1.5Z" fill="currentColor" />
                </svg>`,
        },
        assign: {
            className: 'theme-assign-btn',
            label: `${theme.name} にメンバーを追加`,
            title: 'メンバー追加',
            icon: `
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8Zm0 1.5c-2.67 0-4.83 1.33-5.58 3.25-.13.33.13.69.49.69h10.18c.36 0 .62-.36.49-.69C12.83 10.83 10.67 9.5 8 9.5ZM13.25 2.75a.75.75 0 0 1 .75.75V5h1.5a.75.75 0 0 1 0 1.5H14v1.5a.75.75 0 0 1-1.5 0V6.5H11a.75.75 0 0 1 0-1.5h1.5V3.5a.75.75 0 0 1 .75-.75Z" fill="currentColor" />
                </svg>`,
        },
    };
    const config = buttons[action];
    return `<button class="btn btn-ghost btn-sm theme-action-btn ${config.className}" data-theme-id="${theme.theme_id}" type="button" title="${config.title}" aria-label="${escapeHtmlAttr(config.label)}">${config.icon}</button>`;
}

function memberCell(theme, member, month, current) {
    const allocation = allAllocations.find((item) => item.theme_id === theme.theme_id && item.member_id === member.member_id && item.month === month);
    const rate = allocation?.allocation_rate || 0;
    const warning = warnings.find((item) => item.member_id === member.member_id && item.month === month);
    const memo = allocation?.memo || '';
    const previewMarkup = scenarioMemberPreviewChip(theme.theme_id, member.member_id, month);
    const previewCellClass = previewMarkup ? ' scenario-cell-highlight' : '';
    return `<td class="${month === current ? 'month-current' : ''}" data-gantt-month="${month}"><button class="gantt-cell ${warning ? 'rate-over' : rateClass(rate)}${previewCellClass}" data-theme="${theme.theme_id}" data-member="${member.member_id}" data-month="${month}" data-rate="${rate}" data-memo="${escapeHtml(memo)}" title="${memo || 'No memo'}" type="button">${rate ? `${rate}%` : ''}${diffChip(rate, month, theme.theme_id, member.member_id)}${previewMarkup}${warning ? '<span class="warning-icon">!</span>' : ''}</button></td>`;
}

function renderDetailPanel() {
    const empty = document.getElementById('detail-empty');
    const form = document.getElementById('detail-form');
    if (!selectedCell) { empty.hidden = false; form.hidden = true; return; }
    const theme = allThemes.find((item) => item.theme_id === selectedCell.themeId);
    const member = allMembers.find((item) => item.member_id === selectedCell.memberId);
    const allocation = allAllocations.find((item) => item.theme_id === selectedCell.themeId && item.member_id === selectedCell.memberId && item.month === selectedCell.month);
    empty.hidden = true;
    form.hidden = false;
    document.getElementById('detail-target').textContent = `${theme?.name || ''} / ${member?.display_name || ''} / ${selectedCell.month}`;
    document.getElementById('detail-rate').value = allocation?.allocation_rate || 0;
    document.getElementById('detail-memo').value = allocation?.memo || '';
    document.getElementById('detail-bulk-rate').value = allocation?.allocation_rate || 0;
    document.getElementById('detail-message').textContent = allocation?.memo ? 'メモは検索結果と CSV 出力にも含まれます。' : 'メモを追加すると検索や CSV 出力に含められます。';
}

function renderDetailPanelV2() {
    const empty = document.getElementById('detail-empty');
    const form = document.getElementById('detail-form');
    const panel = document.getElementById('gantt-detail-panel');
    if (!selectedCell) {
        empty.hidden = false;
        form.hidden = true;
        panel?.classList.remove('is-warning');
        return;
    }

    const theme = allThemes.find((item) => item.theme_id === selectedCell.themeId);
    const member = allMembers.find((item) => item.member_id === selectedCell.memberId);
    const allocation = allAllocations.find((item) => item.theme_id === selectedCell.themeId && item.member_id === selectedCell.memberId && item.month === selectedCell.month);
    const totalLoad = memberMonthTotal(selectedCell.memberId, selectedCell.month);
    const capacity = member?.capacity || 100;
    const isWarning = totalLoad > capacity;

    empty.hidden = true;
    form.hidden = false;
    panel?.classList.toggle('is-warning', isWarning);
    const themeName = document.getElementById('detail-theme-name');
    const memberName = document.getElementById('detail-member-name');
    const monthName = document.getElementById('detail-month-name');
    const detailTarget = document.getElementById('detail-target');
    const detailRate = document.getElementById('detail-rate');
    const detailMemo = document.getElementById('detail-memo');
    const detailBulkRate = document.getElementById('detail-bulk-rate');
    const detailMessage = document.getElementById('detail-message');

    if (themeName) themeName.textContent = theme?.name || '-';
    if (memberName) memberName.textContent = member?.display_name || '-';
    if (monthName) monthName.textContent = selectedCell.month;
    if (detailTarget) detailTarget.textContent = `${theme?.name || ''} / ${member?.display_name || ''} / ${selectedCell.month}`;
    if (detailRate) detailRate.value = allocation?.allocation_rate || 0;
    if (detailMemo) {
        const persistedMemo = allocation?.memo || '';
        detailMemo.value = persistedMemo;
        detailMemo.dataset.persistedValue = persistedMemo;
    }
    if (detailBulkRate) detailBulkRate.value = allocation?.allocation_rate || 0;
    if (detailMessage) {
        detailMessage.textContent = isWarning
            ? `この月の合計負荷は ${totalLoad}% で、担当者の上限 ${capacity}% を超えています。`
            : allocation?.memo
                ? 'メモは検索結果と CSV 出力にも含まれます。'
                : 'メモを追加すると検索や CSV 出力に含められます。';
    }
}

function jumpToMatchingCell(predicate) {
    const cells = Array.from(document.querySelectorAll('.gantt-cell[data-theme]'));
    if (cells.length === 0) return;
    const currentIndex = cells.findIndex((cell) => selectedCell
        && Number.parseInt(cell.dataset.theme, 10) === selectedCell.themeId
        && Number.parseInt(cell.dataset.member, 10) === selectedCell.memberId
        && cell.dataset.month === selectedCell.month);
    const ordered = currentIndex >= 0 ? [...cells.slice(currentIndex + 1), ...cells.slice(0, currentIndex + 1)] : cells;
    const next = ordered.find(predicate);
    if (!next) return;
    selectCellButton(next);
    next.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

function collectSnapshotDiffs(months) {
    return months.flatMap((month) => allAllocations
        .filter((item) => item.month === month)
        .map((item) => {
            const oldRate = lookupRate(snapshotAllocations, item.theme_id, item.member_id, month);
            if (oldRate === item.allocation_rate) return null;
            const theme = allThemes.find((row) => row.theme_id === item.theme_id);
            const member = allMembers.find((row) => row.member_id === item.member_id);
            return {
                ...item,
                old_rate: oldRate,
                new_rate: item.allocation_rate,
                theme_name: theme?.name || '',
                member_name: member?.display_name || '',
            };
        })
        .filter(Boolean))
        .sort((left, right) => Math.abs(right.new_rate - right.old_rate) - Math.abs(left.new_rate - left.old_rate));
}

function renderSnapshotSummaryCards(months) {
    const target = document.getElementById('snapshot-diff-summary');
    if (!target) return;
    const previewContext = buildScenarioPreviewContext();
    if (snapshotAllocations.length === 0) {
        if (!previewContext) {
            target.innerHTML = '';
            return;
        }
        target.innerHTML = `
            <article class="summary-card scenario-preview-card">
                <div class="summary-label">提案プレビュー</div>
                <div class="summary-value">${escapeHtml(previewContext.title)}</div>
                <div class="summary-subtext">追加 ${previewContext.assignmentCount} 件 / 後ろ倒し ${previewContext.shiftCount} 件 / 開始 ${escapeHtml(previewContext.startMonth)}</div>
                <div class="snapshot-diff-actions">
                    <button class="btn btn-ghost btn-sm" type="button" data-scenario-focus="true">ガント内で見る</button>
                    <button class="btn btn-ghost btn-sm" type="button" data-scenario-clear="true">解除</button>
                </div>
            </article>
        `;
        target.querySelector('[data-scenario-clear="true"]')?.addEventListener('click', () => clearScenarioPreview());
        target.querySelector('[data-scenario-focus="true"]')?.addEventListener('click', () => focusScenarioPreview());
        return;
    }

    const diffs = collectSnapshotDiffs(months);
    const themes = new Set(diffs.map((item) => item.theme_id));
    const members = new Set(diffs.map((item) => item.member_id));
    const topDiffs = diffs.slice(0, 5);

    target.innerHTML = `
        <article class="summary-card">
            <div class="summary-label">差分セル数</div>
            <div class="summary-value">${diffs.length}</div>
            <div class="summary-subtext">表示中の月だけを集計</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">差分テーマ数</div>
            <div class="summary-value">${themes.size}</div>
            <div class="summary-subtext">変更が入ったテーマ</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">差分メンバー数</div>
            <div class="summary-value">${members.size}</div>
            <div class="summary-subtext">変更が入った担当者</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">ジャンプ候補</div>
            <div class="snapshot-diff-list">
                ${topDiffs.map((item, index) => `
                    <div class="snapshot-diff-item">
                        <strong>${escapeHtml(item.theme_name)}</strong>
                        <div class="snapshot-diff-meta">${escapeHtml(item.member_name)} / ${item.month} / ${item.old_rate}% → ${item.new_rate}%</div>
                        <div class="snapshot-diff-actions">
                            <button class="btn btn-ghost btn-sm" type="button" data-diff-index="${index}">ここへ移動</button>
                        </div>
                    </div>
                `).join('') || '<div class="summary-subtext">差分候補はありません。</div>'}
            </div>
        </article>
    `;

    if (previewContext) {
        target.insertAdjacentHTML('afterbegin', `
            <article class="summary-card scenario-preview-card">
                <div class="summary-label">提案プレビュー</div>
                <div class="summary-value">${escapeHtml(previewContext.title)}</div>
                <div class="summary-subtext">追加 ${previewContext.assignmentCount} 件 / 後ろ倒し ${previewContext.shiftCount} 件 / 開始 ${escapeHtml(previewContext.startMonth)}</div>
                <div class="snapshot-diff-actions">
                    <button class="btn btn-ghost btn-sm" type="button" data-scenario-focus="true">ガント内で見る</button>
                    <button class="btn btn-ghost btn-sm" type="button" data-scenario-clear="true">解除</button>
                </div>
            </article>
        `);
    }

    target.querySelectorAll('[data-diff-index]').forEach((button) => {
        button.addEventListener('click', () => {
            const diff = topDiffs[Number.parseInt(button.dataset.diffIndex, 10)];
            if (diff) jumpToCell(diff.theme_id, diff.member_id, diff.month);
        });
    });
    target.querySelector('[data-scenario-clear="true"]')?.addEventListener('click', () => clearScenarioPreview());
    target.querySelector('[data-scenario-focus="true"]')?.addEventListener('click', () => focusScenarioPreview());
}

function jumpToCell(themeId, memberId, month) {
    collapsedThemes.delete(themeId);
    persistCollapsed();
    renderTable(getVisibleMonths(startMonth, visibleCount, scale));
    const button = document.querySelector(`.gantt-cell[data-theme="${themeId}"][data-member="${memberId}"][data-month="${month}"]`);
    if (!button) return;
    selectCellButton(button);
    button.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

async function saveSelectedCell() {
    if (!selectedCell) return;
    const rate = Number.parseInt(document.getElementById('detail-rate').value || '0', 10);
    const memo = document.getElementById('detail-memo').value.trim();
    await allocations.updateSingle({ theme_id: selectedCell.themeId, member_id: selectedCell.memberId, month: selectedCell.month, allocation_rate: rate, memo });
    setSaveState('saved', 'セルを保存しました');
    showToast('セルを保存しました。', 'success');
    await refreshGantt();
}

async function previewBulkUpdate() {
    if (!selectedCell) return;
    const rate = Number.parseInt(document.getElementById('detail-bulk-rate').value || '0', 10);
    const memo = document.getElementById('detail-memo').value.trim();
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const preview = months.map((month) => `- ${month}: ${lookupRate(allAllocations, selectedCell.themeId, selectedCell.memberId, month)}% → ${rate}%`).join('\n');
    const ok = await showConfirmDialog({ title: "Preview bulk update", message: `${preview}\n\nMemo: ${memo || "-"}`, confirmText: "Apply", cancelText: "Cancel" });
    if (!ok) return;
    const redo = months.map((month) => ({ theme_id: selectedCell.themeId, member_id: selectedCell.memberId, month, allocation_rate: rate, memo }));
    const undo = months.map((month) => { const current = allAllocations.find((item) => item.theme_id === selectedCell.themeId && item.member_id === selectedCell.memberId && item.month === month); return { theme_id: selectedCell.themeId, member_id: selectedCell.memberId, month, allocation_rate: current?.allocation_rate || 0, memo: current?.memo || '' }; });
    HistoryManager.push(undo, redo);
    await HistoryManager.perform(redo);
}

async function performDragAndDropMove({ undo, redo }) {
    if (!Array.isArray(undo) || !Array.isArray(redo) || undo.length === 0 || redo.length === 0) return;

    HistoryManager.push(undo, redo);

    try {
        await HistoryManager.perform(redo);
        setSaveState('saved', 'Allocation move applied.');
        showToast('配分を移動しました。Ctrl/Cmd + Z で元に戻せます。', 'success');
    } catch (error) {
        if (HistoryManager.index >= 0) {
            HistoryManager.stack.splice(HistoryManager.index, 1);
            HistoryManager.index -= 1;
        }
        setSaveState('error', 'Failed to move allocation.');
        showToast(`Failed to move allocation: ${formatError(error)}`, 'error');
        throw error;
    }
}

function moveSelection(offset) {
    const cells = Array.from(document.querySelectorAll('.gantt-cell[data-theme]'));
    const index = cells.findIndex((cell) => selectedCell && Number.parseInt(cell.dataset.theme, 10) === selectedCell.themeId && Number.parseInt(cell.dataset.member, 10) === selectedCell.memberId && cell.dataset.month === selectedCell.month);
    const next = cells[index + offset];
    if (!next) return;
    selectCellButton(next);
}

function openEditorForButton(button, options = {}) {
    const themeId = Number.parseInt(button.dataset.theme, 10);
    const memberId = Number.parseInt(button.dataset.member, 10);
    const month = button.dataset.month;
    const currentRate = Number.parseInt(button.dataset.rate || '0', 10);

    openCellEditor(
        button,
        themeId,
        memberId,
        month,
        currentRate,
        (nextRate) => applyCellValue(button, nextRate, button.dataset.memo || ''),
        (direction, changed, newRate) => handleEditorNavigationWithHistory(button, direction, changed, newRate),
        {
            ...options,
            optimisticSave: false,
            onCommitSuccess: (nextRate) => applyCellValue(button, nextRate, button.dataset.memo || ''),
            onHistoryShortcut: ({ isRedo }) => {
                if (isRedo) {
                    void HistoryManager.redo();
                } else {
                    void HistoryManager.undo();
                }
            },
            commitChange: (nextRate) => commitSingleCellChange(
                themeId,
                memberId,
                month,
                nextRate,
                button.dataset.memo || '',
                { successMessage: `${month} 縺ｮ雋闕ｷ邇・ｒ菫晏ｭ倥＠縺ｾ縺励◆` },
            ),
            clearChange: () => commitSingleCellChange(
                themeId,
                memberId,
                month,
                0,
                button.dataset.memo || '',
                { successMessage: `${month} 縺ｮ雋闕ｷ繧偵け繝ｪ繧｢縺励∪縺励◆` },
            ),
        },
    );
}

async function saveSelectedCellWithHistory() {
    if (!selectedCell) return;
    const rate = Number.parseInt(document.getElementById('detail-rate').value || '0', 10);
    const memo = document.getElementById('detail-memo').value.trim();
    const changed = await commitSingleCellChange(
        selectedCell.themeId,
        selectedCell.memberId,
        selectedCell.month,
        rate,
        memo,
        { successMessage: 'セルを保存しました' },
    );
    if (changed) {
        showToast('セルを保存しました', 'success');
    }
}

function handleEditorNavigationWithHistory(button, direction, changed, newRate) {
    const themeId = Number.parseInt(button.dataset.theme, 10);
    const memberId = Number.parseInt(button.dataset.member, 10);
    const month = button.dataset.month;
    const memo = button.dataset.memo || '';

    const moveToNext = () => {
        const nextButton = findAdjacentCell(button, direction);
        if (!nextButton) return;

        selectedCell = {
            themeId: Number.parseInt(nextButton.dataset.theme, 10),
            memberId: Number.parseInt(nextButton.dataset.member, 10),
            month: nextButton.dataset.month,
        };
        renderDetailPanelV2();
        openEditorForButton(nextButton);
    };

    if (!changed) {
        moveToNext();
        return;
    }

    const previousSnapshot = {
        allocation_rate: Number.parseInt(button.dataset.rate || '0', 10),
        memo,
    };
    const nextRate = Math.max(0, Math.min(100, Number.parseInt(newRate || '0', 10)));
    applyCellValue(button, nextRate, memo);
    moveToNext();

    commitSingleCellChange(themeId, memberId, month, nextRate, memo, {
        previousSnapshot,
        successMessage: `${month} の負荷率を保存しました`,
    }).catch((error) => {
        setSaveState('error', 'セル保存に失敗しました');
        showToast(`セル保存に失敗しました: ${formatError(error)}`, 'error');
        refreshGantt();
    });
}

function handleEditorNavigation(button, direction, changed, newRate) {
    const themeId = Number.parseInt(button.dataset.theme, 10);
    const memberId = Number.parseInt(button.dataset.member, 10);
    const month = button.dataset.month;
    const memo = button.dataset.memo || '';

    const moveToNext = () => {
        const nextButton = findAdjacentCell(button, direction);
        if (!nextButton) return;

        selectedCell = {
            themeId: Number.parseInt(nextButton.dataset.theme, 10),
            memberId: Number.parseInt(nextButton.dataset.member, 10),
            month: nextButton.dataset.month,
        };
        renderDetailPanelV2();
        openEditorForButton(nextButton);
    };

    if (!changed) {
        moveToNext();
        return;
    }

    const nextRate = Math.max(0, Math.min(100, Number.parseInt(newRate || '0', 10)));
    applyCellValue(button, nextRate, memo);
    moveToNext();

    allocations.updateSingle({
        theme_id: themeId,
        member_id: memberId,
        month,
        allocation_rate: nextRate,
        memo,
    }).then(() => {
        setSaveState('saved', `${month} の負荷を保存しました`);
    }).catch((error) => {
        setSaveState('error', 'セル保存に失敗しました');
        showToast(`セル保存に失敗しました: ${formatError(error)}`, 'error');
        refreshGantt();
    });
}

function applyCellValue(button, rate, memo = '') {
    const themeId = Number.parseInt(button.dataset.theme, 10);
    const memberId = Number.parseInt(button.dataset.member, 10);
    const month = button.dataset.month;
    const safeRate = Math.max(0, Math.min(100, Number.parseInt(rate || '0', 10)));
    const allocationIndex = allAllocations.findIndex((item) => item.theme_id === themeId && item.member_id === memberId && item.month === month);

    if (allocationIndex >= 0) {
        allAllocations[allocationIndex] = {
            ...allAllocations[allocationIndex],
            allocation_rate: safeRate,
            memo,
        };
    } else {
        allAllocations.push({
            theme_id: themeId,
            member_id: memberId,
            month,
            allocation_rate: safeRate,
            memo,
        });
    }

    button.dataset.rate = String(safeRate);
    button.dataset.memo = memo;
    button.title = memo || 'No memo';
    renderMemberCellButton(button, safeRate, memberId, month);
    refreshMemberMonthState(memberId, month);

    updateThemeSummaryCell(themeId, month);
    renderSnapshotSummaryCards(getVisibleMonths(startMonth, visibleCount, scale));

    if (selectedCell && selectedCell.themeId === themeId && selectedCell.memberId === memberId && selectedCell.month === month) {
        renderDetailPanelV2();
    }
}

function renderMemberCellButton(button, rate, memberId, month) {
    const safeRate = Math.max(0, Math.min(100, Number.parseInt(rate || '0', 10)));
    const member = allMembers.find((item) => item.member_id === memberId);
    const totalRate = memberMonthTotal(memberId, month);
    const hasWarning = totalRate > (member?.capacity || 100);
    button.className = `gantt-cell ${hasWarning ? 'rate-over' : rateClass(safeRate)}`;
    button.innerHTML = `${safeRate ? `${safeRate}%` : ''}${diffChip(safeRate, month, Number.parseInt(button.dataset.theme, 10), memberId)}${hasWarning ? '<span class="warning-icon">!</span>' : ''}`;
    syncSelectionStyles();
}

function refreshMemberMonthState(memberId, month) {
    const totalRate = memberMonthTotal(memberId, month);
    const member = allMembers.find((item) => item.member_id === memberId);
    if (!memberLoads[memberId]) memberLoads[memberId] = {};
    memberLoads[memberId][month] = totalRate;

    warnings = warnings.filter((item) => !(item.member_id === memberId && item.month === month));
    if (totalRate > (member?.capacity || 100)) {
        warnings.push({
            member_id: memberId,
            display_name: member?.display_name || '',
            month,
            load: totalRate,
            capacity: member?.capacity || 100,
            excess: totalRate - (member?.capacity || 100),
        });
    }

    document.querySelectorAll(`.gantt-cell[data-member="${memberId}"][data-month="${month}"]`).forEach((cell) => {
        renderMemberCellButton(cell, Number.parseInt(cell.dataset.rate || '0', 10), memberId, month);
    });
}

updateThemeSummaryCell = function(themeId, month) {
    const summaryRow = Array.from(document.querySelectorAll('.gantt-row-summary')).find((row) => row.querySelector(`.theme-toggle[data-theme-id="${themeId}"]`));
    if (!summaryRow) return;

    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const monthIndex = months.indexOf(month);
    if (monthIndex < 0) return;

    const members = themeMembers(themeId);
    const totalRate = sumThemeRate(themeId, month, members);
    const targetCell = summaryRow.children[monthIndex + 1];
    if (!targetCell) return;

    const theme = allThemes.find((item) => item.theme_id === themeId);
    if (!theme) {
        targetCell.innerHTML = `<div class="gantt-cell ${rateClass(totalRate)}">${formatRateValue(totalRate)}${diffChip(totalRate, month, themeId, null, members)}</div>`;
        return;
    }
    targetCell.outerHTML = renderThemeSummaryCellMarkup(theme, month, currentMonth(), members);
    bindRows();
};

function findAdjacentCell(button, direction) {
    const currentTd = button.closest('td');
    const currentRow = button.closest('tr');
    if (!currentTd || !currentRow) return null;

    if (direction === 'ArrowLeft') {
        const target = currentTd.previousElementSibling?.querySelector('.gantt-cell[data-theme]');
        return target || null;
    }
    if (direction === 'ArrowRight') {
        const target = currentTd.nextElementSibling?.querySelector('.gantt-cell[data-theme]');
        return target || null;
    }

    let sibling = direction === 'ArrowUp' ? currentRow.previousElementSibling : currentRow.nextElementSibling;
    while (sibling) {
        if (sibling.classList.contains('gantt-row-member') && !sibling.classList.contains('hidden-row')) {
            const target = sibling.children[currentTd.cellIndex]?.querySelector('.gantt-cell[data-theme]');
            if (target) return target;
        }
        sibling = direction === 'ArrowUp' ? sibling.previousElementSibling : sibling.nextElementSibling;
    }

    return null;
}

function bindKeyboardInteractions() {
    if (ganttKeyboardBound) return;
    ganttKeyboardBound = true;

    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;

        if (shouldHandleGanttHistoryShortcut(event)) {
            event.preventDefault();
            event.stopPropagation();
            const shortcutKey = getShortcutKey(event);
            if ((event.shiftKey && shortcutKey === 'z') || shortcutKey === 'y') {
                void HistoryManager.redo();
            } else {
                void HistoryManager.undo();
            }
            return;
        }

        if (!isGanttKeyboardContext(event)) return;
        if (!selectedCell) return;

        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'c') {
            event.preventDefault();
            copySelectionToInternalClipboard();
            return;
        }

        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'v') {
            event.preventDefault();
            pasteFromClipboard();
            return;
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            moveGridSelection(event.key, event.shiftKey);
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            const button = getSelectedButton();
            if (button) openEditorForButton(button);
            return;
        }

        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            clearSelectedRange();
            return;
        }

        if (/^\d$/.test(event.key)) {
            event.preventDefault();
            const button = getSelectedButton();
            if (button) openEditorForButton(button, { initialValue: event.key, selectOnOpen: false });
        }
    });

    document.addEventListener('copy', (event) => {
        if (!isGanttKeyboardContext(event) || !selectedCell) return;
        const text = copySelectionToInternalClipboard();
        if (text && event.clipboardData) {
            event.preventDefault();
            event.clipboardData.setData('text/plain', text);
        }
    });

    document.addEventListener('paste', (event) => {
        if (!isGanttKeyboardContext(event) || !selectedCell) return;
        event.preventDefault();
        const text = event.clipboardData?.getData('text/plain') || '';
        pasteFromClipboard(text);
    });
}

function shouldHandleGanttHistoryShortcut(event) {
    const key = getShortcutKey(event);
    const isUndo = key === 'z' && !event.shiftKey;
    const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
    if (!(event.ctrlKey || event.metaKey) || (!isUndo && !isRedo)) return false;
    if (!document.getElementById('view-gantt')?.classList.contains('active')) return false;
    if (shouldIgnoreShortcut(event)) return false;

    const target = event.target;
    return Boolean(
        selectedCell ||
        target?.closest?.('#gantt-container, #gantt-detail-panel, #cell-editor'),
    );
}

function isGanttKeyboardContext(event) {
    if (!document.getElementById('view-gantt')?.classList.contains('active') && document.getElementById('view-gantt')) return false;
    if (isCellEditorOpen()) return false;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return true;
    return !target.closest('input, textarea, select, [contenteditable="true"]');
}

function getVisibleMemberRows() {
    return Array.from(document.querySelectorAll('.gantt-row-member:not(.hidden-row)'));
}

function getCellPositionFromButton(button) {
    const row = button?.closest('.gantt-row-member');
    const cell = button?.closest('td');
    if (!row || !cell) return null;
    const rows = getVisibleMemberRows();
    const rowIndex = rows.indexOf(row);
    if (rowIndex < 0) return null;
    return { rowIndex, colIndex: cell.cellIndex - 1 };
}

function getButtonByPosition(rowIndex, colIndex) {
    const row = getVisibleMemberRows()[rowIndex];
    const cell = row?.children[colIndex + 1];
    return cell?.querySelector('.gantt-cell[data-theme]') || null;
}

function getSelectedButton() {
    if (!selectedCell) return null;
    return document.querySelector(`.gantt-cell[data-theme="${selectedCell.themeId}"][data-member="${selectedCell.memberId}"][data-month="${selectedCell.month}"]`);
}

function selectCellButton(button, options = {}) {
    if (!button) return;

    const nextSelected = {
        themeId: Number.parseInt(button.dataset.theme, 10),
        memberId: Number.parseInt(button.dataset.member, 10),
        month: button.dataset.month,
    };
    const nextPosition = getCellPositionFromButton(button);
    if (!nextPosition) return;

    selectedCell = nextSelected;
    if (!options.extend || !selectionAnchor) selectionAnchor = nextPosition;
    selectedRange = buildSelectionRange(selectionAnchor || nextPosition, nextPosition);
    renderDetailPanelV2();
    syncSelectionStyles();

    if (options.focus !== false) button.focus();
}

function buildSelectionRange(start, end) {
    return {
        startRow: Math.min(start.rowIndex, end.rowIndex),
        endRow: Math.max(start.rowIndex, end.rowIndex),
        startCol: Math.min(start.colIndex, end.colIndex),
        endCol: Math.max(start.colIndex, end.colIndex),
    };
}

function syncSelectionStyles() {
    const active = getSelectedButton();
    document.querySelectorAll('.gantt-cell[data-theme]').forEach((button) => {
        const position = getCellPositionFromButton(button);
        const inRange = Boolean(position && selectedRange
            && position.rowIndex >= selectedRange.startRow
            && position.rowIndex <= selectedRange.endRow
            && position.colIndex >= selectedRange.startCol
            && position.colIndex <= selectedRange.endCol);
        button.classList.toggle('is-range-selected', inRange);
        button.classList.toggle('is-selected', button === active);
    });
}

function setSelectedMonth(month) {
    selectedMonth = month || null;
    syncSelectedMonthStyles();
}

function syncSelectedMonthStyles() {
    document.querySelectorAll('[data-gantt-month]').forEach((element) => {
        element.classList.toggle('month-selected', Boolean(selectedMonth) && element.dataset.ganttMonth === selectedMonth);
    });
}

function moveGridSelection(direction, extendSelection = false) {
    const currentButton = getSelectedButton();
    const currentPosition = getCellPositionFromButton(currentButton);
    if (!currentPosition) return;

    const nextPosition = { ...currentPosition };
    if (direction === 'ArrowLeft') nextPosition.colIndex -= 1;
    if (direction === 'ArrowRight') nextPosition.colIndex += 1;
    if (direction === 'ArrowUp') nextPosition.rowIndex -= 1;
    if (direction === 'ArrowDown') nextPosition.rowIndex += 1;

    const nextButton = getButtonByPosition(nextPosition.rowIndex, nextPosition.colIndex);
    if (!nextButton) return;
    selectCellButton(nextButton, { extend: extendSelection });
}

function getSelectedRangeButtons() {
    if (!selectedRange) return [];
    const buttons = [];
    for (let rowIndex = selectedRange.startRow; rowIndex <= selectedRange.endRow; rowIndex += 1) {
        const row = [];
        for (let colIndex = selectedRange.startCol; colIndex <= selectedRange.endCol; colIndex += 1) {
            const button = getButtonByPosition(rowIndex, colIndex);
            if (button) row.push(button);
        }
        if (row.length > 0) buttons.push(row);
    }
    return buttons;
}

function copySelectionToInternalClipboard() {
    const matrix = getSelectedRangeButtons().map((row) => row.map((button) => button.textContent.replace('!', '').trim()));
    if (matrix.length === 0) return '';
    copiedRange = matrix.map((row) => row.map((value) => value.replace('%', '')));
    return copiedRange.map((row) => row.join('\t')).join('\n');
}

async function pasteFromClipboard(fallbackText = '') {
    let text = fallbackText;
    if (!text && navigator.clipboard?.readText) {
        try {
            text = await navigator.clipboard.readText();
        } catch {
            text = '';
        }
    }

    if (!text && copiedRange) {
        text = copiedRange.map((row) => row.join('\t')).join('\n');
    }

    const matrix = parseClipboardMatrix(text);
    if (!selectedCell || matrix.length === 0) return;

    const startButton = getSelectedButton();
    const startPosition = getCellPositionFromButton(startButton);
    if (!startPosition) return;

    const redo = [];
    const undo = [];
    const affected = [];

    matrix.forEach((row, rowOffset) => {
        row.forEach((value, colOffset) => {
            const button = getButtonByPosition(startPosition.rowIndex + rowOffset, startPosition.colIndex + colOffset);
            if (!button) return;

            const themeId = Number.parseInt(button.dataset.theme, 10);
            const memberId = Number.parseInt(button.dataset.member, 10);
            const month = button.dataset.month;
            const currentAllocation = allAllocations.find((item) => item.theme_id === themeId && item.member_id === memberId && item.month === month);
            const nextRate = Math.max(0, Math.min(100, Number.parseInt(value || '0', 10) || 0));

            undo.push({
                theme_id: themeId,
                member_id: memberId,
                month,
                allocation_rate: currentAllocation?.allocation_rate || 0,
                memo: currentAllocation?.memo || '',
            });
            redo.push({
                theme_id: themeId,
                member_id: memberId,
                month,
                allocation_rate: nextRate,
            });
            affected.push({ button, memberId, month, memo: currentAllocation?.memo || '', rate: nextRate });
        });
    });

    if (redo.length === 0) return;

    affected.forEach(({ button, rate, memo }) => applyCellValue(button, rate, memo));
    new Set(affected.map(({ memberId, month }) => `${memberId}:${month}`)).forEach((key) => {
        const [memberId, month] = key.split(':');
        refreshMemberMonthState(Number.parseInt(memberId, 10), month);
    });

    HistoryManager.push(undo, redo);

    try {
        await allocations.bulkUpdate(redo);
        setSaveState('saved', `${redo.length} cells pasted.`);
    } catch (error) {
        setSaveState('error', '貼り付けの保存に失敗しました');
        showToast(`貼り付けの保存に失敗しました: ${formatError(error)}`, 'error');
        await refreshGantt();
    }
}

function parseClipboardMatrix(text) {
    if (!text) return [];
    return text
        .split(/\r?\n/)
        .filter((row) => row.length > 0)
        .map((row) => row.split('\t').map((cell) => cell.replace('%', '').trim()));
}

async function clearSelectedRange() {
    const buttons = getSelectedRangeButtons().flat();
    if (buttons.length === 0) return;

    const redo = [];
    const undo = [];
    buttons.forEach((button) => {
        const themeId = Number.parseInt(button.dataset.theme, 10);
        const memberId = Number.parseInt(button.dataset.member, 10);
        const month = button.dataset.month;
        const currentAllocation = allAllocations.find((item) => item.theme_id === themeId && item.member_id === memberId && item.month === month);
        undo.push({
            theme_id: themeId,
            member_id: memberId,
            month,
            allocation_rate: currentAllocation?.allocation_rate || 0,
            memo: currentAllocation?.memo || '',
        });
        redo.push({
            theme_id: themeId,
            member_id: memberId,
            month,
            allocation_rate: 0,
        });
        applyCellValue(button, 0, currentAllocation?.memo || '');
        refreshMemberMonthState(memberId, month);
    });

    HistoryManager.push(undo, redo);
    try {
        await allocations.bulkUpdate(redo);
        setSaveState('saved', `${redo.length} cells cleared.`);
    } catch (error) {
        setSaveState('error', 'セルのクリアに失敗しました');
        showToast(`セルのクリアに失敗しました: ${formatError(error)}`, 'error');
        await refreshGantt();
    }
}

function exportCsv() {
    const csv = buildGanttGridCsvContent();
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildGanttExportFilename('csv');
    link.click();
    URL.revokeObjectURL(url);
    showToast('CSV を書き出しました。', 'success');
}

async function showAssignMemberModal(themeId) {
    const theme = allThemes.find((item) => item.theme_id === themeId);
    if (!theme) return;

    const currentMemberIds = new Set(themeMembers(themeId).map((m) => m.member_id));
    const allActiveMembers = allMembers
        .filter((member) => member.is_active)
        .sort((left, right) => left.display_name.localeCompare(right.display_name, 'ja'));

    if (allActiveMembers.length === 0) {
        showToast('利用可能なメンバーがいません。', 'warning');
        return;
    }

    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFooter = document.getElementById('modal-footer');
    const modalOverlay = document.getElementById('modal-overlay');

    modalTitle.textContent = `${theme.name} のメンバー管理`;
    modalBody.innerHTML = `
        <p class="summary-subtext" style="margin-bottom:12px">チェックを入れるとメンバーを追加、外すと削除します。</p>
        <div class="member-selection-list">
            ${allActiveMembers.map((member) => {
                const isAssigned = currentMemberIds.has(member.member_id);
                return `<label class="member-selection-item ${isAssigned ? 'member-assigned' : ''}">
                    <input type="checkbox" value="${member.member_id}" ${isAssigned ? 'checked' : ''}>
                    <div>
                        <div>${escapeHtml(member.display_name)}${isAssigned ? ' <span class="member-assigned-badge">参加中</span>' : ''}</div>
                        <div class="summary-subtext">${member.department || 'No Department'} / Capacity ${member.capacity}%</div>
                    </div>
                </label>`;
            }).join('')}
        </div>
    `;
    modalFooter.innerHTML = `
        <button class="btn btn-ghost" id="modal-cancel-btn" type="button">キャンセル</button>
        <button class="btn btn-primary" id="modal-save-btn" type="button">保存する</button>
    `;
    modalOverlay.hidden = false;

    document.getElementById('modal-close').onclick = () => { modalOverlay.hidden = true; };
    document.getElementById('modal-cancel-btn').onclick = () => { modalOverlay.hidden = true; };
    document.getElementById('modal-save-btn').onclick = async () => {
        const checkedIds = new Set(
            Array.from(modalBody.querySelectorAll('input[type="checkbox"]:checked'))
                .map((input) => Number.parseInt(input.value, 10))
        );
        const toAdd = [...checkedIds].filter((id) => !currentMemberIds.has(id));
        const toRemove = [...currentMemberIds].filter((id) => !checkedIds.has(id));

        if (toAdd.length === 0 && toRemove.length === 0) {
            modalOverlay.hidden = true;
            return;
        }

        try {
            if (toAdd.length > 0) {
                await themesApi.assignMembersBulk(themeId, toAdd);
            }
            for (const memberId of toRemove) {
                await themesApi.unassignMember(themeId, memberId);
            }
            modalOverlay.hidden = true;
            const msgs = [];
            if (toAdd.length > 0) msgs.push(`${toAdd.length} 名追加`);
            if (toRemove.length > 0) msgs.push(`${toRemove.length} 名削除`);
            showToast(msgs.join(' / ') + ' しました。', 'success');
            await refreshGantt();
        } catch (error) {
            showToast(`メンバー更新に失敗しました: ${error?.message || error}`, 'error');
        }
    };
}

function applyAllocationRowToState(row) {
    const themeId = Number.parseInt(row.theme_id, 10);
    const memberId = Number.parseInt(row.member_id, 10);
    const month = row.month;
    const nextRate = Math.max(0, Math.min(100, Number.parseInt(row.allocation_rate || '0', 10) || 0));
    const allocationIndex = allAllocations.findIndex((item) => item.theme_id === themeId && item.member_id === memberId && item.month === month);
    const nextMemo = row.memo ?? (allocationIndex >= 0 ? allAllocations[allocationIndex].memo : '') ?? '';

    if (nextRate <= 0) {
        if (allocationIndex >= 0) {
            allAllocations.splice(allocationIndex, 1);
        }
        return;
    }

    const nextRow = {
        theme_id: themeId,
        member_id: memberId,
        month,
        allocation_rate: nextRate,
        memo: nextMemo,
    };

    if (allocationIndex >= 0) {
        allAllocations[allocationIndex] = {
            ...allAllocations[allocationIndex],
            ...nextRow,
        };
    } else {
        allAllocations.push(nextRow);
    }
}

function applyHistoryRowsOptimistically(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    resetTransientGanttUi();
    rows.forEach(applyAllocationRowToState);
    rerenderGanttView();
}

function resetTransientGanttUi() {
    closeCellEditor();
    const activeElement = document.activeElement;
    if (
        activeElement instanceof HTMLElement
        && (activeElement.closest('#gantt-detail-panel, #cell-editor')
            || activeElement.matches('#detail-rate, #detail-memo, #detail-bulk-rate, #cell-editor-input'))
    ) {
        activeElement.blur();
    }
}

function closeSharedModal() {
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) modalOverlay.hidden = true;
}

function compareMilestoneMonth(left, right) {
    const leftMonth = left?.month || '9999-99';
    const rightMonth = right?.month || '9999-99';
    if (leftMonth !== rightMonth) return leftMonth.localeCompare(rightMonth);
    return (left?.label || '').localeCompare(right?.label || '', 'ja');
}

function themeMilestonesForEdit(theme) {
    if (Array.isArray(theme?.milestones) && theme.milestones.length > 0) {
        return theme.milestones
            .map((item) => ({
                month: item.month || '',
                label: item.label || '',
                is_completed: Boolean(item.is_completed),
            }))
            .sort(compareMilestoneMonth);
    }
    if (theme?.milestone_month) {
        return [{ month: theme.milestone_month, label: theme.milestone_label || '', is_completed: false }];
    }
    return [{ month: '', label: '', is_completed: false }];
}

function compareMonthValues(left, right) {
    return (left || '9999-99').localeCompare(right || '9999-99');
}

function getThemeDevCompleteItems(theme) {
    const source = Array.isArray(theme?.dev_complete_months)
        ? theme.dev_complete_months
        : (theme?.dev_complete_month ? [theme.dev_complete_month] : []);
    return source
        .map((item) => {
            if (item && typeof item === 'object') {
                return {
                    month: String(item.month || '').trim(),
                    is_completed: Boolean(item.is_completed),
                };
            }
            return { month: String(item || '').trim(), is_completed: false };
        })
        .filter((item) => item.month)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.month === item.month) === index)
        .sort((left, right) => compareMonthValues(left.month, right.month));
}

async function showMilestoneModal(themeId) {
    const theme = allThemes.find((item) => item.theme_id === themeId);
    if (!theme) return;

    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFooter = document.getElementById('modal-footer');
    const modalOverlay = document.getElementById('modal-overlay');
    const renderDevCompleteRow = (item = { month: '', is_completed: false }) => `
        <div class="theme-dev-complete-row" style="display:grid;grid-template-columns:140px auto auto;gap:8px;align-items:center;margin-bottom:8px;">
            <input class="theme-dev-complete-month" type="month" value="${escapeHtml(item.month || '')}">
            <label style="display:flex;align-items:center;gap:4px;font-size:var(--text-sm);margin:0;"><input class="theme-dev-complete-completed" type="checkbox" ${item.is_completed ? 'checked' : ''}>完了</label>
            <button class="btn btn-ghost btn-sm theme-dev-complete-remove" type="button">削除</button>
        </div>
    `;
    const initialDevCompleteItems = getThemeDevCompleteItems(theme);

    const renderRow = (item = { month: '', label: '', is_completed: false }) => `
        <div class="theme-milestone-row" style="display:grid;grid-template-columns:140px 1fr auto auto;gap:8px;align-items:center;margin-bottom:8px;">
            <input class="theme-milestone-month" type="month" value="${item.month || ''}">
            <input class="theme-milestone-label" type="text" value="${escapeHtml(item.label || '')}" placeholder="例: リリース">
            <label style="display:flex;align-items:center;gap:4px;font-size:var(--text-sm);margin:0;"><input class="theme-milestone-completed" type="checkbox" ${item.is_completed ? 'checked' : ''}>完了</label>
            <button class="btn btn-ghost btn-sm theme-milestone-remove" type="button">削除</button>
        </div>
    `;

    modalTitle.textContent = `${theme.name} のマイルストーン`;
    modalBody.innerHTML = `
        <div class="form-field">
            <label>開発完了月</label>
            <div style="display:flex;align-items:center;gap:8px;">
                <div id="theme-dev-complete-editor" style="flex:1;">${(initialDevCompleteItems.length ? initialDevCompleteItems : [{ month: '', is_completed: false }]).map((item) => renderDevCompleteRow(item)).join('')}</div>
                <button class="btn btn-ghost btn-sm" id="theme-dev-complete-add" type="button">追加</button>
                <span class="summary-subtext" style="white-space:nowrap;">★ 総計欄に表示されます</span>
            </div>
        </div>
        <div class="form-field">
            <label>マイルストーン</label>
            <div id="theme-milestones-editor">${themeMilestonesForEdit(theme).map((item) => renderRow(item)).join('')}</div>
            <button class="btn btn-ghost btn-sm" id="theme-milestone-add" type="button">追加</button>
        </div>
    `;
    modalFooter.innerHTML = `
        <button class="btn btn-ghost" id="modal-cancel-btn" type="button">キャンセル</button>
        <button class="btn btn-primary" id="modal-save-btn" type="button">保存する</button>
    `;
    modalOverlay.hidden = false;

    const devCompleteEditor = document.getElementById('theme-dev-complete-editor');
    const bindDevCompleteRows = () => {
        devCompleteEditor.querySelectorAll('.theme-dev-complete-remove').forEach((button) => {
            button.onclick = () => {
                const rows = devCompleteEditor.querySelectorAll('.theme-dev-complete-row');
                if (rows.length === 1) {
                    rows[0].querySelector('.theme-dev-complete-month').value = '';
                    return;
                }
                button.closest('.theme-dev-complete-row')?.remove();
            };
        });
    };
    document.getElementById('theme-dev-complete-add').onclick = () => {
        devCompleteEditor.insertAdjacentHTML('beforeend', renderDevCompleteRow());
        bindDevCompleteRows();
    };
    bindDevCompleteRows();

    const editor = document.getElementById('theme-milestones-editor');
    const bindMilestoneRows = () => {
        editor.querySelectorAll('.theme-milestone-remove').forEach((button) => {
            button.onclick = () => {
                const rows = editor.querySelectorAll('.theme-milestone-row');
                if (rows.length === 1) {
                    rows[0].querySelector('.theme-milestone-month').value = '';
                    rows[0].querySelector('.theme-milestone-label').value = '';
                    return;
                }
                button.closest('.theme-milestone-row')?.remove();
            };
        });
    };

    document.getElementById('theme-milestone-add').onclick = () => {
        editor.insertAdjacentHTML('beforeend', renderRow());
        bindMilestoneRows();
    };
    bindMilestoneRows();

    document.getElementById('modal-close').onclick = closeSharedModal;
    document.getElementById('modal-cancel-btn').onclick = closeSharedModal;
    document.getElementById('modal-save-btn').onclick = async () => {
        const milestones = Array.from(editor.querySelectorAll('.theme-milestone-row'))
            .map((row) => ({
                month: row.querySelector('.theme-milestone-month')?.value || '',
                label: row.querySelector('.theme-milestone-label')?.value.trim() || '',
                is_completed: row.querySelector('.theme-milestone-completed')?.checked || false,
            }))
            .filter((item) => item.month)
            .sort(compareMilestoneMonth);
        const devCompleteMonths = Array.from(devCompleteEditor.querySelectorAll('.theme-dev-complete-row'))
            .map((row) => ({
                month: row.querySelector('.theme-dev-complete-month')?.value || '',
                is_completed: row.querySelector('.theme-dev-complete-completed')?.checked || false,
            }))
            .filter((item) => item.month)
            .filter((item, index, list) => list.findIndex((candidate) => candidate.month === item.month) === index)
            .sort((left, right) => compareMonthValues(left.month, right.month));

        try {
            setSaveState('saving', 'マイルストーンを保存しています...');
            await themesApi.update(themeId, { milestones, dev_complete_months: devCompleteMonths });
            closeSharedModal();
            setSaveState('saved', 'マイルストーンを保存しました');
            showToast('マイルストーンを保存しました。', 'success');
            await refreshGantt();
        } catch (error) {
            setSaveState('error', 'マイルストーンの保存に失敗しました');
            showToast(`マイルストーンの保存に失敗しました: ${formatError(error)}`, 'error');
        }
    };
}

function filterThemes() {
    return allThemes.filter((theme) => matchesThemeFilters(theme));
}

function themeMembers(themeId) {
    const theme = allThemes.find((item) => item.theme_id === themeId);
    const assigned = new Set(theme?.member_ids || []);
    allAllocations.forEach((item) => {
        if (item.theme_id === themeId) assigned.add(item.member_id);
    });
    return allMembers
        .filter((member) => assigned.has(member.member_id))
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'));
}
function memberMonthTotal(memberId, month) { return allAllocations.filter((item) => item.member_id === memberId && item.month === month).reduce((sum, item) => sum + item.allocation_rate, 0); }
function sumThemeRate(themeId, month, members) { return members.reduce((sum, member) => sum + lookupRate(allAllocations, themeId, member.member_id, month), 0); }
function lookupRate(source, themeId, memberId, month) { return source.find((item) => item.theme_id === themeId && item.member_id === memberId && item.month === month)?.allocation_rate || 0; }
function countBy(items, selector) { const map = new Map(); items.forEach((item) => map.set(selector(item), (map.get(selector(item)) || 0) + 1)); return map; }
function getDevRankLabel(devRank) { return DEV_RANK_LABELS[devRank || ''] || devRank || '-'; }
function getGroupKey(theme) {
    if (groupBy === 'status') return STATUS_LABELS[theme.status] || theme.status;
    if (groupBy === 'priority') return `P${Number.isFinite(Number(theme.priority)) ? Number(theme.priority) : 0}`;
    if (groupBy === 'dev-rank') return `Rank ${getDevRankLabel(theme.dev_rank)}`;
    return theme.category || 'Uncategorized';
}
function rateClass(rate) { if (rate <= 0) return ''; if (rate <= 30) return 'rate-low'; if (rate <= 60) return 'rate-mid'; if (rate < 100) return 'rate-high'; if (rate === 100) return 'rate-full'; return 'rate-over'; }
function csvEscape(value) { const text = String(value ?? ''); return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function getExportCellText(value) { if (value && typeof value === 'object') return value.text ?? ''; return value ?? ''; }
export function buildGanttGridCsvContent() {
    const dataset = getGanttGridExportDataset();
    const header = dataset.header_labels || dataset.headers;
    const rows = dataset.rows.map((row) => [row.label, ...row.values.map(getExportCellText)]);
    return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}
function buildGanttExportFilename(extension) {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const from = months[0] || startMonth;
    const to = months[months.length - 1] || from;
    return `gantt_${from}_${to}.${extension}`;
}
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function escapeHtmlAttr(value) { return escapeHtml(value).replaceAll('`', '&#96;'); }
function diffChip(rate, month, themeId, memberId, members = []) { if (snapshotAllocations.length === 0 || scale !== 1) return ''; const oldRate = memberId == null ? members.reduce((sum, member) => sum + lookupRate(snapshotAllocations, themeId, member.member_id, month), 0) : lookupRate(snapshotAllocations, themeId, memberId, month); if (oldRate === rate) return ''; const diff = rate - oldRate; return `<span class="diff-chip ${diff > 0 ? 'diff-plus' : 'diff-minus'}">${diff > 0 ? '+' : ''}${diff}</span>`; }
function hydrateCollapsed() { try { collapsedThemes = new Set(JSON.parse(localStorage.getItem('gantt_collapsed') || '[]')); } catch { collapsedThemes = new Set(); } }
function persistCollapsed() { localStorage.setItem('gantt_collapsed', JSON.stringify([...collapsedThemes])); }
function syncScaleButtons() { document.querySelectorAll('#scale-switcher .scale-btn').forEach((button) => button.classList.toggle('active', Number.parseInt(button.dataset.scale, 10) === scale)); }

function buildSummaryTooltip(theme, month, members, totalRate) {
    const lines = [`${theme.name} | ${month} | 合計 ${totalRate}%`];
    const milestones = getThemeMilestones(theme).filter((item) => monthBucketIncludes(item.month, month, scale));
    if (milestones.length) {
        lines.push(`マイルストーン: ${milestones.map((item) => item.label || 'Milestone').join(', ')}`);
    }
    const breakdown = members
        .map((member) => ({
            name: member.display_name,
            rate: lookupRate(allAllocations, theme.theme_id, member.member_id, month),
        }))
        .filter((item) => item.rate > 0)
        .sort((left, right) => right.rate - left.rate || left.name.localeCompare(right.name, 'ja'));
    if (breakdown.length) {
        lines.push(...breakdown.map((item) => `${item.name}: ${item.rate}%`));
    } else {
        lines.push('内訳なし');
    }
    return lines.join('\n');
}

function renderThemeSummaryCellMarkup(theme, month, current, members) {
    const total = sumThemeRate(theme.theme_id, month, members);
    const tooltip = escapeHtmlAttr(buildSummaryTooltip(theme, month, members, total));
    const previewChip = scenarioThemePreviewChip(theme.theme_id, month);
    const previewCellClass = previewChip ? ' scenario-cell-highlight' : '';
    return `<td class="${month === current ? 'month-current' : ''}" data-gantt-month="${month}"><button class="gantt-cell gantt-summary-cell ${rateClass(total)}${previewCellClass}" data-theme-id="${theme.theme_id}" data-month="${month}" title="${tooltip}" type="button">${formatSummaryCellContent(theme, total, month, members)}${previewChip}</button>${milestoneChips(theme, month)}</td>`;
}

function syncFilterInputs() {
    const search = document.getElementById('gantt-theme-filter');
    if (search && search.value !== searchQuery) search.value = searchQuery;
    const category = document.getElementById('gantt-category-filter');
    if (category && category.value !== categoryFilter) category.value = categoryFilter;
    const owner = document.getElementById('gantt-owner-filter');
    if (owner) {
        const matchingOption = [...owner.options].find((option) => option.value.toLowerCase() === ownerFilter.toLowerCase());
        const nextOwnerValue = matchingOption?.value || '';
        if (owner.value !== nextOwnerValue) owner.value = nextOwnerValue;
    }
    const status = document.getElementById('gantt-status-filter');
    if (status && status.value !== statusFilter) status.value = statusFilter;
    const priority = document.getElementById('gantt-priority-filter');
    if (priority && priority.value !== priorityFilter) priority.value = priorityFilter;
    const groupByInput = document.getElementById('gantt-group-by');
    if (groupByInput && groupByInput.value !== groupBy) groupByInput.value = groupBy;
    renderActiveFilterChips();
}

function renderActiveFilterChips() {
    const container = document.getElementById('gantt-active-filters');
    if (!container) return;

    const chips = [];
    if (searchQuery) chips.push({ label: `テーマ: ${searchQuery}`, update: { ganttSearch: '' } });
    if (categoryFilter) chips.push({ label: `カテゴリ: ${categoryFilter}`, update: { ganttCategory: '' } });
    if (ownerFilter) chips.push({ label: `担当者: ${ownerFilter}`, update: { ganttOwner: '' } });
    if (statusFilter !== 'all') {
        const statusLabel = statusFilter === 'open' ? '未完了のみ' : STATUS_LABELS[statusFilter] || statusFilter;
        chips.push({ label: `ステータス: ${statusLabel}`, update: { ganttStatus: 'all' } });
    }
    if (priorityFilter !== 'all') chips.push({ label: `優先度: P${priorityFilter}以上`, update: { ganttPriority: 'all' } });

    if (chips.length === 0) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }

    container.hidden = false;
    container.innerHTML = chips.map((chip, index) => `
        <span class="filter-chip">
            <span>${escapeHtml(chip.label)}</span>
            <button type="button" data-chip-index="${index}" aria-label="${escapeHtml(chip.label)} を解除">×</button>
        </span>
    `).join('') + '<span class="filter-chip filter-chip-reset"><button type="button" id="gantt-chip-reset-all">すべて解除</button></span>';

    container.querySelectorAll('[data-chip-index]').forEach((button) => {
        button.addEventListener('click', () => {
            const chip = chips[Number.parseInt(button.dataset.chipIndex, 10)];
            if (chip) updateViewState(chip.update);
        });
    });
    container.querySelector('#gantt-chip-reset-all')?.addEventListener('click', () => updateViewState({
        ganttSearch: '',
        ganttCategory: '',
        ganttOwner: '',
        ganttStatus: 'all',
        ganttPriority: 'all',
    }));
}

function renderFilterControls() {
    const themeSelect = document.getElementById('gantt-theme-filter');
    if (themeSelect) {
        const themeNames = [...new Set(allThemes
            .map((theme) => (theme.name || '').trim())
            .filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, 'ja'));
        themeSelect.innerHTML = '<option value="">テーマ名: すべて</option>'
            + themeNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    }

    const categorySelect = document.getElementById('gantt-category-filter');
    if (categorySelect) {
        const categories = [...new Set(allThemes.map((theme) => (theme.category || '').trim()).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, 'ja'));
        categorySelect.innerHTML = '<option value="">カテゴリ: すべて</option>'
            + categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    }

    const ownerSelect = document.getElementById('gantt-owner-filter');
    if (ownerSelect) {
        const names = [...new Set(allMembers
            .filter((member) => member.is_active !== false)
            .map((member) => (member.display_name || '').trim())
            .filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, 'ja'));
        ownerSelect.innerHTML = '<option value="">メンバー名: すべて</option>'
            + names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    }

    syncFilterInputs();
    if (themeSelect?.options[0]) themeSelect.options[0].textContent = 'テーマ: すべて';
    if (categorySelect?.options[0]) categorySelect.options[0].textContent = 'カテゴリ: すべて';
    if (ownerSelect?.options[0]) ownerSelect.options[0].textContent = '担当者: すべて';
}

function themeSearchText(theme) {
    return String(theme.name || '').trim();
}

function matchesThemeFilters(theme) {
    if (searchQuery && themeSearchText(theme) !== searchQuery) return false;
    if (categoryFilter && (theme.category || '') !== categoryFilter) return false;

    if (ownerFilter) {
        const normalizedOwner = ownerFilter.toLowerCase();
        const hasOwnerMatch = themeMembers(theme.theme_id)
            .some((member) => (member.display_name || '').toLowerCase().includes(normalizedOwner));
        if (!hasOwnerMatch) return false;
    }

    if (statusFilter === 'open' && ['completed', 'cancelled'].includes(theme.status)) return false;
    if (!['all', 'open'].includes(statusFilter) && theme.status !== statusFilter) return false;

    if (priorityFilter !== 'all') {
        const minimumPriority = Number.parseInt(priorityFilter, 10);
        if ((theme.priority || 0) < minimumPriority) return false;
    }

    return true;
}

export function getGanttExportDataset(selectedColumns = ['Theme', 'Member', 'Department', 'Month', 'Allocation', 'Memo', 'Category', 'Status', 'Priority', 'Capacity']) {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const rows = allAllocations
        .filter((item) => months.includes(item.month))
        .map((item) => {
            const theme = allThemes.find((row) => row.theme_id === item.theme_id);
            const member = allMembers.find((row) => row.member_id === item.member_id);
            const lookup = {
                Theme: theme?.name || '',
                Member: member?.display_name || '',
                Department: member?.department || '',
                Month: item.month,
                Allocation: item.allocation_rate,
                Memo: item.memo || '',
                Category: theme?.category || '',
                Status: theme?.status || '',
                Priority: theme?.priority ?? '',
                Capacity: member?.capacity ?? '',
            };
            return selectedColumns.map((column) => lookup[column] ?? '');
        });
    return { headers: selectedColumns, rows };
}

export function getGanttGridExportDataset() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const current = currentMonth();
    document.querySelectorAll('#gantt-thead th').forEach((header, index) => {
        if (index === 0) return;
        header.dataset.ganttMonth = months[index - 1];
    });
    const themes = filterThemes();
    document.querySelectorAll('#gantt-thead th').forEach((header, index) => {
        if (index === 0) return;
        header.dataset.ganttMonth = months[index - 1];
    });
    const rows = [];
    const groups = groupBy === 'none'
        ? [{ key: '', themes }]
        : [...countBy(themes, getGroupKey).keys()]
            .map((key) => ({ key, themes: themes.filter((theme) => getGroupKey(theme) === key) }));

    groups.forEach((group) => {
        if (group.key) {
            rows.push({
                type: 'group',
                label: group.key,
                values: months.map(() => ''),
            });
        }

        group.themes.forEach((theme) => {
            const members = themeMembers(theme.theme_id);
            rows.push({
                type: 'summary',
                label: formatThemeExportLabel(theme),
                color: theme.color || '',
                values: months.map((month) => buildSummaryExportCell(theme, month, members, current)),
            });

            if (collapsedThemes.has(theme.theme_id)) return;
            members.forEach((member) => {
                rows.push({
                    type: 'member',
                    label: formatMemberExportLabel(member),
                    values: months.map((month) => buildMemberExportCell(theme, member, month, current)),
                });
            });
        });
    });

    return {
        headers: ['Theme / Member', ...months],
        header_labels: ['Theme / Member', ...months.map((month) => formatMonthHeader(month, scale))],
        rows,
    };
}

function formatThemeExportLabel(theme) {
    const parts = [theme.name];
    if (theme.dev_rank != null) parts.push(`Rank ${getDevRankLabel(theme.dev_rank)}`);
    if (theme.priority != null) parts.push(`P${theme.priority}`);
    if (theme.status) parts.push(STATUS_LABELS[theme.status] || theme.status);
    return parts.join(' / ');
}

function formatMemberExportLabel(member) {
    const details = [];
    if (member.department) details.push(member.department);
    if (member.capacity != null) details.push(`Capacity ${member.capacity}%`);
    return details.length ? `${member.display_name} (${details.join(' / ')})` : member.display_name;
}

function buildSummaryExportCell(theme, month, members, current) {
    const rate = sumThemeRate(theme.theme_id, month, members);
    const isDevComplete = getThemeDevCompleteItems(theme).some((item) => monthBucketIncludes(item.month, month, scale));
    const milestones = getThemeMilestones(theme)
        .filter((item) => monthBucketIncludes(item.month, month, scale))
        .map((item) => item.label || 'Milestone');
    const textParts = [];
    const rateText = formatRateValue(rate);

    if (isDevComplete) {
        textParts.push(rateText ? `★${rateText}` : '★');
    } else if (rateText) {
        textParts.push(rateText);
    }

    if (milestones.length > 0) {
        textParts.push(...milestones);
    }

    return {
        text: textParts.join('\n'),
        rate,
        is_current: month === current,
        has_special_text: isDevComplete || milestones.length > 0,
    };
}

function formatSummaryCellContent(theme, totalRate, month, members) {
    const devCompleteItem = getThemeDevCompleteItems(theme).find((item) => monthBucketIncludes(item.month, month, scale));
    const isDevComplete = Boolean(devCompleteItem);
    const primaryLabel = isDevComplete
        ? `<span class="gantt-star-label ${devCompleteItem.is_completed ? 'completed' : ''}" title="開発完了月">★${formatRateValue(totalRate) || ''}</span>`
        : `<span class="gantt-summary-value">${formatRateValue(totalRate)}</span>`;
    return `${primaryLabel}${diffChip(totalRate, month, theme.theme_id, null, members)}`;
}

function buildMemberExportCell(theme, member, month, current) {
    const allocation = allAllocations.find((item) => item.theme_id === theme.theme_id && item.member_id === member.member_id && item.month === month);
    const rate = allocation?.allocation_rate || 0;
    const hasWarning = warnings.some((item) => item.member_id === member.member_id && item.month === month);
    const text = `${rate ? `${rate}%` : ''}${hasWarning ? (rate ? '\n!' : '!') : ''}`;

    return {
        text,
        rate,
        is_current: month === current,
        has_warning: hasWarning,
        has_special_text: hasWarning,
    };
}

function formatRateValue(rate) {
    return rate ? `${rate}%` : '';
}

function monthBucketIncludes(targetMonth, periodStart, step) {
    if (!targetMonth || !periodStart) return false;
    if (step <= 1) return targetMonth === periodStart;
    const periodEnd = addMonths(periodStart, step - 1);
    return targetMonth >= periodStart && targetMonth <= periodEnd;
}

function getThemeMilestones(theme) {
    if (Array.isArray(theme.milestones) && theme.milestones.length > 0) return theme.milestones;
    if (theme.milestone_month) {
        return [{ month: theme.milestone_month, label: theme.milestone_label || 'Milestone' }];
    }
    return [];
}

function milestoneChips(theme, month) {
    const matches = getThemeMilestones(theme)
        .filter((item) => monthBucketIncludes(item.month, month, scale));
    if (matches.length === 0) return '';
    const chips = matches.map((item) => {
        const label = escapeHtml(item.label || 'Milestone');
        const completedClass = item.is_completed ? 'completed' : '';
        const tooltip = escapeHtmlAttr(`${theme.name}\n${item.month}\n${item.label || 'Milestone'}`);
        return `<button class="gantt-milestone-chip ${completedClass}" data-theme-id="${theme.theme_id}" type="button" title="${tooltip}">${label}</button>`;
    }).join('');
    return `<div class="gantt-milestones">${chips}</div>`;
}

function renderMobileThemeList(themes, months) {
    const container = document.getElementById('gantt-mobile-theme-list');
    if (!container) return;

    if (window.innerWidth > 720) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }

    const items = themes.map((theme) => {
        const members = themeMembers(theme.theme_id);
        const firstMonth = months[0];
        const currentTotal = sumThemeRate(theme.theme_id, firstMonth, members);
        const isActive = selectedCell?.themeId === theme.theme_id;
        return `
            <button class="gantt-mobile-theme-card ${isActive ? 'is-active' : ''}" type="button" data-mobile-theme-id="${theme.theme_id}">
                <span class="gantt-mobile-theme-title">
                    <span class="theme-color-bar" style="background:${theme.color}"></span>
                    <span>${escapeHtml(theme.name)}</span>
                </span>
                <span class="gantt-mobile-theme-meta">担当 ${members.length}名 / 今月 ${currentTotal}% / ${STATUS_LABELS[theme.status] || theme.status}</span>
            </button>
        `;
    }).join('');

    container.hidden = false;
    container.innerHTML = items || '<div class="summary-subtext">表示できるテーマはありません。</div>';
    container.querySelectorAll('[data-mobile-theme-id]').forEach((button) => {
        button.addEventListener('click', () => {
            const themeId = Number.parseInt(button.dataset.mobileThemeId, 10);
            collapsedThemes = new Set();
            allThemes.forEach((theme) => {
                if (theme.theme_id !== themeId) collapsedThemes.add(theme.theme_id);
            });
            collapsedThemes.delete(themeId);
            persistCollapsed();
            rerenderGanttView();
            const firstCell = document.querySelector(`.gantt-cell[data-theme="${themeId}"]`);
            if (firstCell) {
                selectCellButton(firstCell);
                firstCell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }
        });
    });
}

function renderTable(months) {
    const current = currentMonth();
    scenarioPreviewContext = buildScenarioPreviewContext();
    renderFilterControls();
    document.getElementById('gantt-thead').innerHTML = `<tr><th>テーマ / メンバー</th>${months.map((month) => `<th class="${month === current ? 'month-current' : ''}">${formatMonthHeader(month, scale).replace('\n', '<br>')}</th>`).join('')}</tr>`;
    const rows = [];
    document.querySelectorAll('#gantt-thead th').forEach((header, index) => {
        if (index === 0) return;
        header.dataset.ganttMonth = months[index - 1];
    });
    const themes = filterThemes();
    const groups = groupBy === 'none'
        ? [{ key: '', themes }]
        : [...countBy(themes, getGroupKey).keys()]
            .map((key) => ({ key, themes: themes.filter((theme) => getGroupKey(theme) === key) }));

    groups.forEach((group) => {
        if (group.key) rows.push(`<tr class="gantt-row-group"><td colspan="${months.length + 1}">${group.key}</td></tr>`);
        if (!group.key && scenarioPreviewContext) {
            rows.push(...renderScenarioPreviewRows(months, current));
        }
        group.themes.forEach((theme) => {
            const members = themeMembers(theme.theme_id);
            const priorityValue = Number.isFinite(Number(theme.priority)) ? Number(theme.priority) : 0;
            const completedRowClass = theme.status === 'completed' ? ' theme-row-completed' : '';
            const priorityBadge = `<span class="theme-priority-badge" title="優先度 ${priorityValue}">P${priorityValue}</span>`;
            rows.push(`<tr class="gantt-row-summary${completedRowClass}" data-theme-id="${theme.theme_id}"><td><div class="theme-label-cell"><button class="theme-toggle" data-theme-id="${theme.theme_id}" type="button"><span class="theme-toggle-icon ${collapsedThemes.has(theme.theme_id) ? '' : 'expanded'}">▾</span><span class="theme-color-bar" style="background:${theme.color}"></span><span class="theme-name-text">${escapeHtml(theme.name)}</span></button><div class="theme-label-actions">${priorityBadge}${themeStatusSelect(theme)}${themeActionButton(theme, 'milestone')}${themeActionButton(theme, 'assign')}</div></div></td>${months.map((month) => renderThemeSummaryCellMarkup(theme, month, current, members)).join('')}</tr>`);
            members.forEach((member) => rows.push(`<tr class="gantt-row-member${completedRowClass} ${collapsedThemes.has(theme.theme_id) ? 'hidden-row' : ''}" data-theme-id="${theme.theme_id}" data-member-id="${member.member_id}"><td><div class="member-label-cell"><span>${member.display_name}</span><span class="member-capacity">${member.department || 'No Department'} / Capacity ${member.capacity}%</span></div></td>${months.map((month) => memberCell(theme, member, month, current)).join('')}</tr>`));
        });
    });

    document.getElementById('gantt-tbody').innerHTML = rows.join('') || `<tr><td colspan="${months.length + 1}" class="summary-subtext">条件に一致するテーマがありません。</td></tr>`;
    decorateThemeSummaryRows();
    bindRows();
    renderMobileThemeList(themes, months);
    syncSelectionStyles();
}

function updateThemeSummaryCell(themeId, month) {
    const summaryRow = Array.from(document.querySelectorAll('.gantt-row-summary')).find((row) => row.querySelector(`.theme-toggle[data-theme-id="${themeId}"]`));
    if (!summaryRow) return;

    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const monthIndex = months.indexOf(month);
    if (monthIndex < 0) return;

    const members = themeMembers(themeId);
    const totalRate = sumThemeRate(themeId, month, members);
    const targetCell = summaryRow.children[monthIndex + 1];
    if (!targetCell) return;

    const theme = allThemes.find((item) => item.theme_id === themeId);
    if (!theme) {
        targetCell.innerHTML = `<div class="gantt-cell ${rateClass(totalRate)}">${formatRateValue(totalRate)}${diffChip(totalRate, month, themeId, null, members)}</div>`;
        return;
    }
    targetCell.outerHTML = renderThemeSummaryCellMarkup(theme, month, currentMonth(), members);
    bindRows();
}
