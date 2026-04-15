import { allocations, members as membersApi, snapshots as snapshotsApi, themes as themesApi } from '../api.js';
import { getPresetConfig, loadViewState, subscribeViewState, updateViewState } from '../shared-state.js';
import { addMonths, currentMonth, formatMonthHeader, getVisibleMonths } from '../utils/date-utils.js';
import { formatError, setBusyState, setSaveState, showConfirmDialog, showPromptDialog, showToast } from '../ui.js';
import { openCellEditor } from './gantt-editor.js';

const STATUS_LABELS = { planning: 'Planning', active: 'Active', completed: 'Completed', cancelled: 'Cancelled' };

export const HistoryManager = {
    stack: [],
    index: -1,
    push(undo, redo) {
        this.stack = this.stack.slice(0, this.index + 1);
        this.stack.push({ undo, redo });
        this.index += 1;
    },
    async perform(data) {
        await allocations.bulkUpdate(data);
        await refreshGantt();
    },
    async undo() {
        if (this.index < 0) return;
        const action = this.stack[this.index--];
        await this.perform(action.undo);
    },
    async redo() {
        if (this.index >= this.stack.length - 1) return;
        const action = this.stack[++this.index];
        await this.perform(action.redo);
    },
};

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
let groupBy = 'none';
let collapsedThemes = new Set();
let selectedCell = null;

export async function initGantt() {
    const state = loadViewState();
    startMonth = state.startMonth;
    scale = state.scale;
    searchQuery = state.ganttSearch || '';
    groupBy = state.groupBy || 'none';
    bindControls();
    await loadSnapshots();
    subscribeViewState((next) => {
        startMonth = next.startMonth;
        scale = next.scale;
        searchQuery = next.ganttSearch || '';
        groupBy = next.groupBy || 'none';
        const search = document.getElementById('gantt-search');
        if (search) search.value = searchQuery;
        const groupByInput = document.getElementById('gantt-group-by');
        if (groupByInput) groupByInput.value = groupBy;
        syncScaleButtons();
        refreshGantt();
    });
    hydrateCollapsed();
    await refreshGantt();
}

export async function refreshGantt() {
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
        renderSnapshotSummary(months);
        renderTable(months);
        renderDetailPanel();
    } catch (error) {
        setSaveState('error', 'ガントの読み込みに失敗しました');
        showToast(`ガントの読み込みに失敗しました: ${formatError(error)}`, 'error');
    } finally {
        setBusyState(false);
    }
}

function bindControls() {
    document.querySelectorAll('#scale-switcher .scale-btn').forEach((button) => button.addEventListener('click', () => updateViewState({ scale: Number.parseInt(button.dataset.scale, 10) })));
    document.getElementById('gantt-search')?.addEventListener('input', (event) => updateViewState({ ganttSearch: event.target.value.trim().toLowerCase() }));
    document.getElementById('gantt-group-by')?.addEventListener('change', (event) => updateViewState({ groupBy: event.target.value }));
    document.getElementById('gantt-prev')?.addEventListener('click', () => updateViewState({ startMonth: addMonths(startMonth, -scale * 3) }));
    document.getElementById('gantt-next')?.addEventListener('click', () => updateViewState({ startMonth: addMonths(startMonth, scale * 3) }));
    document.getElementById('gantt-today')?.addEventListener('click', () => {
        const preset = document.getElementById('shared-period-preset').value || 'rolling-6';
        updateViewState({ preset, ...getPresetConfig(preset) });
    });
    document.getElementById('gantt-expand-all')?.addEventListener('click', () => { collapsedThemes.clear(); persistCollapsed(); refreshGantt(); });
    document.getElementById('gantt-collapse-all')?.addEventListener('click', () => { allThemes.forEach((theme) => collapsedThemes.add(theme.theme_id)); persistCollapsed(); refreshGantt(); });
    document.getElementById('gantt-export-csv')?.addEventListener('click', exportCsv);
    document.getElementById('gantt-export-xlsx')?.addEventListener('click', exportXlsx);
    document.getElementById('snapshot-save-btn')?.addEventListener('click', saveSnapshot);
    document.getElementById('snapshot-select')?.addEventListener('change', loadSelectedSnapshot);
    document.getElementById('detail-save')?.addEventListener('click', saveSelectedCell);
    document.getElementById('detail-prev')?.addEventListener('click', () => moveSelection(-1));
    document.getElementById('detail-next')?.addEventListener('click', () => moveSelection(1));
    document.getElementById('detail-preview-bulk')?.addEventListener('click', previewBulkUpdate);
}

async function saveSnapshot() {
    const name = await showPromptDialog({ title: 'Save snapshot', message: 'Enter a snapshot name.', defaultValue: Snap_, confirmText: 'Save', cancelText: 'Cancel' });
    if (!name) return;
    await snapshotsApi.create({ name, data: allAllocations });
    await loadSnapshots();
    showToast('Snapshot saved.', 'success');
}

async function loadSnapshots() {
    const select = document.getElementById('snapshot-select');
    if (!select) return;
    select.innerHTML = '<option value="">スナップショット比較なし</option>';
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



function bindRows() {
    document.querySelectorAll('.theme-toggle').forEach((button) => button.addEventListener('click', () => { const id = Number.parseInt(button.dataset.themeId, 10); collapsedThemes.has(id) ? collapsedThemes.delete(id) : collapsedThemes.add(id); persistCollapsed(); refreshGantt(); }));
    document.querySelectorAll('.theme-milestone-btn').forEach((button) => button.addEventListener('click', () => showMilestoneModal(Number.parseInt(button.dataset.themeId, 10))));
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
            showToast('Theme status updated.', 'success');
            await refreshGantt();
        } catch (error) {
            event.target.value = theme.status;
            setSaveState('error', 'テーマステータスの更新に失敗しました');
            showToast(`テーマステータスの更新に失敗しました: ${formatError(error)}`, 'error');
        } finally {
            event.target.disabled = false;
        }
    }));
    document.querySelectorAll('.gantt-cell[data-theme]').forEach((button) => button.addEventListener('click', () => {
        selectedCell = { themeId: Number.parseInt(button.dataset.theme, 10), memberId: Number.parseInt(button.dataset.member, 10), month: button.dataset.month };
        renderDetailPanel();
        button.focus();
        openEditorForButton(button);
    }));
}

function themeStatusSelect(theme) {
    const options = Object.entries(STATUS_LABELS)
        .map(([value, label]) => `<option value="${value}" ${theme.status === value ? 'selected' : ''}>${label}</option>`)
        .join('');
    return `<select class="theme-status theme-status-select status-${theme.status}" data-theme-id="${theme.theme_id}" aria-label="${escapeHtml(theme.name)} のステータス">${options}</select>`;
}

function memberCell(theme, member, month, current) {
    const allocation = allAllocations.find((item) => item.theme_id === theme.theme_id && item.member_id === member.member_id && item.month === month);
    const rate = allocation?.allocation_rate || 0;
    const warning = warnings.find((item) => item.member_id === member.member_id && item.month === month);
    const memo = allocation?.memo || '';
    return `<td class="${month === current ? 'month-current' : ''}"><button class="gantt-cell ${warning ? 'rate-over' : rateClass(rate)}" data-theme="${theme.theme_id}" data-member="${member.member_id}" data-month="${month}" data-rate="${rate}" data-memo="${escapeHtml(memo)}" title="${memo || 'No memo'}" type="button">${rate ? `${rate}%` : ''}${diffChip(rate, month, theme.theme_id, member.member_id)}${warning ? '<span class="warning-icon">!</span>' : ''}</button></td>`;
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
    document.getElementById('detail-message').textContent = allocation?.memo ? 'Memo will be included in search and CSV export.' : 'Add a memo to include it in search.';
}

async function saveSelectedCell() {
    if (!selectedCell) return;
    const rate = Number.parseInt(document.getElementById('detail-rate').value || '0', 10);
    const memo = document.getElementById('detail-memo').value.trim();
    await allocations.updateSingle({ theme_id: selectedCell.themeId, member_id: selectedCell.memberId, month: selectedCell.month, allocation_rate: rate, memo });
    setSaveState('saved', 'セルを保存しました');
    showToast('Cell saved.', 'success');
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

function moveSelection(offset) {
    const cells = Array.from(document.querySelectorAll('.gantt-cell[data-theme]'));
    const index = cells.findIndex((cell) => selectedCell && Number.parseInt(cell.dataset.theme, 10) === selectedCell.themeId && Number.parseInt(cell.dataset.member, 10) === selectedCell.memberId && cell.dataset.month === selectedCell.month);
    const next = cells[index + offset];
    if (!next) return;
    selectedCell = { themeId: Number.parseInt(next.dataset.theme, 10), memberId: Number.parseInt(next.dataset.member, 10), month: next.dataset.month };
    renderDetailPanel();
    next.focus();
}

function openEditorForButton(button) {
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
        (direction, changed, newRate) => handleEditorNavigation(button, direction, changed, newRate),
    );
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
        renderDetailPanel();
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
    const previousRate = lookupRate(allAllocations, themeId, memberId, month);
    const allocationIndex = allAllocations.findIndex((item) => item.theme_id === themeId && item.member_id === memberId && item.month === month);
    const totalRate = memberMonthTotal(memberId, month) - previousRate + safeRate;
    const hasWarning = totalRate > 100;

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
    button.className = `gantt-cell ${hasWarning ? 'rate-over' : rateClass(safeRate)}`;
    button.innerHTML = `${safeRate ? `${safeRate}%` : ''}${diffChip(safeRate, month, themeId, memberId)}${hasWarning ? '<span class="warning-icon">!</span>' : ''}`;

    updateThemeSummaryCell(themeId, month);
    renderSnapshotSummary(getVisibleMonths(startMonth, visibleCount, scale));

    if (selectedCell && selectedCell.themeId === themeId && selectedCell.memberId === memberId && selectedCell.month === month) {
        renderDetailPanel();
    }
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

    targetCell.innerHTML = `<div class="gantt-cell ${rateClass(totalRate)}">${totalRate || ''}${diffChip(totalRate, month, themeId, null, members)}</div>`;
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

function exportCsv() {
    const { headers, rows } = getGanttExportDataset(['Theme', 'Member', 'Department', 'Month', 'Allocation', 'Memo']);
    rows.unshift(headers);
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gantt_export.csv';
    link.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported.', 'success');
}

exportXlsx = async function() {
    const { headers, rows } = getGanttExportDataset(['Theme', 'Member', 'Department', 'Month', 'Allocation', 'Memo']);
    const response = await fetch('/api/export/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ headers, rows: rows.map((row) => row.map((value, index) => (headers[index] === 'Allocation' ? `${value}%` : value))), filename: 'gantt_export.xlsx' }) });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gantt_export.xlsx';
    link.click();
    URL.revokeObjectURL(url);
    showToast('Excel exported.', 'success');
};

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

function closeSharedModal() {
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) modalOverlay.hidden = true;
}

function themeMilestonesForEdit(theme) {
    if (Array.isArray(theme?.milestones) && theme.milestones.length > 0) {
        return theme.milestones.map((item) => ({ month: item.month || '', label: item.label || '' }));
    }
    if (theme?.milestone_month) {
        return [{ month: theme.milestone_month, label: theme.milestone_label || '' }];
    }
    return [{ month: '', label: '' }];
}

async function showMilestoneModal(themeId) {
    const theme = allThemes.find((item) => item.theme_id === themeId);
    if (!theme) return;

    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFooter = document.getElementById('modal-footer');
    const modalOverlay = document.getElementById('modal-overlay');

    const renderRow = (item = { month: '', label: '' }) => `
        <div class="theme-milestone-row" style="display:grid;grid-template-columns:140px 1fr auto;gap:8px;align-items:center;margin-bottom:8px;">
            <input class="theme-milestone-month" type="month" value="${item.month || ''}">
            <input class="theme-milestone-label" type="text" value="${escapeHtml(item.label || '')}" placeholder="例: リリース">
            <button class="btn btn-ghost btn-sm theme-milestone-remove" type="button">削除</button>
        </div>
    `;

    modalTitle.textContent = `${theme.name} のマイルストーン`;
    modalBody.innerHTML = `
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
            }))
            .filter((item) => item.month);

        try {
            setSaveState('saving', 'マイルストーンを保存しています...');
            await themesApi.update(themeId, { milestones });
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
    if (!searchQuery) return allThemes;
    return allThemes.filter((theme) => `${theme.name} ${theme.category || ''}`.toLowerCase().includes(searchQuery) || allAllocations.some((item) => item.theme_id === theme.theme_id && `${item.memo || ''} ${(allMembers.find((member) => member.member_id === item.member_id)?.display_name || '')}`.toLowerCase().includes(searchQuery)));
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
function getGroupKey(theme) { return groupBy === 'status' ? STATUS_LABELS[theme.status] || theme.status : groupBy === 'priority' ? `優先度 ${theme.priority ?? 0}` : theme.category || 'Uncategorized'; }
function rateClass(rate) { if (rate <= 0) return ''; if (rate <= 30) return 'rate-low'; if (rate <= 60) return 'rate-mid'; if (rate < 100) return 'rate-high'; if (rate === 100) return 'rate-full'; return 'rate-over'; }
function csvEscape(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function diffChip(rate, month, themeId, memberId, members = []) { if (snapshotAllocations.length === 0 || scale !== 1) return ''; const oldRate = memberId == null ? members.reduce((sum, member) => sum + lookupRate(snapshotAllocations, themeId, member.member_id, month), 0) : lookupRate(snapshotAllocations, themeId, memberId, month); if (oldRate === rate) return ''; const diff = rate - oldRate; return `<span class="diff-chip ${diff > 0 ? 'diff-plus' : 'diff-minus'}">${diff > 0 ? '+' : ''}${diff}</span>`; }
function hydrateCollapsed() { try { collapsedThemes = new Set(JSON.parse(localStorage.getItem('gantt_collapsed') || '[]')); } catch { collapsedThemes = new Set(); } }
function persistCollapsed() { localStorage.setItem('gantt_collapsed', JSON.stringify([...collapsedThemes])); }
function syncScaleButtons() { document.querySelectorAll('#scale-switcher .scale-btn').forEach((button) => button.classList.toggle('active', Number.parseInt(button.dataset.scale, 10) === scale)); }

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
    const themes = filterThemes();
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
                label: theme.name,
                color: theme.color || '',
                values: months.map((month) => formatRateValue(sumThemeRate(theme.theme_id, month, members))),
            });

            members.forEach((member) => {
                rows.push({
                    type: 'member',
                    label: `${member.display_name}${member.department ? ` (${member.department})` : ''}`,
                    values: months.map((month) => formatRateValue(lookupRate(allAllocations, theme.theme_id, member.member_id, month))),
                });
            });
        });
    });

    return {
        headers: ['Theme / Member', ...months],
        rows,
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
        return `<div class="gantt-milestone-chip" title="${label}">${label}</div>`;
    }).join('');
    return `<div class="gantt-milestones">${chips}</div>`;
}

function renderTable(months) {
    const current = currentMonth();
    document.getElementById('gantt-thead').innerHTML = `<tr><th>テーマ / メンバー</th>${months.map((month) => `<th class="${month === current ? 'month-current' : ''}">${formatMonthHeader(month, scale).replace('\n', '<br>')}</th>`).join('')}</tr>`;
    const rows = [];
    const themes = filterThemes();
    const groups = groupBy === 'none'
        ? [{ key: '', themes }]
        : [...countBy(themes, getGroupKey).keys()]
            .map((key) => ({ key, themes: themes.filter((theme) => getGroupKey(theme) === key) }));

    groups.forEach((group) => {
        if (group.key) rows.push(`<tr class="gantt-row-group"><td colspan="${months.length + 1}">${group.key}</td></tr>`);
        group.themes.forEach((theme) => {
            const members = themeMembers(theme.theme_id);
            rows.push(`<tr class="gantt-row-summary"><td><div class="theme-label-cell"><button class="theme-toggle" data-theme-id="${theme.theme_id}" type="button"><span class="theme-toggle-icon ${collapsedThemes.has(theme.theme_id) ? '' : 'expanded'}">▾</span><span class="theme-color-bar" style="background:${theme.color}"></span><span>${theme.name}</span></button>${themeStatusSelect(theme)}<button class="btn btn-ghost btn-sm theme-milestone-btn" data-theme-id="${theme.theme_id}" type="button">マイルストーン</button><button class="btn btn-ghost btn-sm theme-assign-btn" data-theme-id="${theme.theme_id}" type="button">メンバー追加</button></div></td>${months.map((month) => `<td class="${month === current ? 'month-current' : ''}"><div class="gantt-cell ${rateClass(sumThemeRate(theme.theme_id, month, members))}">${formatRateValue(sumThemeRate(theme.theme_id, month, members))}${diffChip(sumThemeRate(theme.theme_id, month, members), month, theme.theme_id, null, members)}</div>${milestoneChips(theme, month)}</td>`).join('')}</tr>`);
            members.forEach((member) => rows.push(`<tr class="gantt-row-member ${collapsedThemes.has(theme.theme_id) ? 'hidden-row' : ''}"><td><div class="member-label-cell"><span>${member.display_name}</span><span class="member-capacity">${member.department || 'No Department'} / Capacity ${member.capacity}%</span></div></td>${months.map((month) => memberCell(theme, member, month, current)).join('')}</tr>`));
        });
    });

    document.getElementById('gantt-tbody').innerHTML = rows.join('') || `<tr><td colspan="${months.length + 1}" class="summary-subtext">条件に一致するテーマがありません。</td></tr>`;
    bindRows();
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

    targetCell.innerHTML = `<div class="gantt-cell ${rateClass(totalRate)}">${formatRateValue(totalRate)}${diffChip(totalRate, month, themeId, null, members)}</div>`;
}

async function exportXlsx() {
    const dataset = getGanttGridExportDataset();
    const response = await fetch('/api/export/xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            layout: 'gantt',
            ...dataset,
            filename: 'gantt_export.xlsx',
        }),
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gantt_export.xlsx';
    link.click();
    URL.revokeObjectURL(url);
    showToast('Excel exported.', 'success');
}
