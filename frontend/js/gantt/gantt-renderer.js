/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Gantt Chart Renderer
 * Renders theme-based gantt chart with collapsible member rows,
 * allocation rate display, and warning indicators.
 */

import { allocations, themes as themesApi, members as membersApi, snapshots as snapshotsApi } from '../api.js';
import {
    currentMonth, getVisibleMonths, formatMonthHeader, addMonths, aggregateRate,
    shortenMonth
} from '../utils/date-utils.js';
import { openCellEditor } from './gantt-editor.js';

export const HistoryManager = {
    stack: [],
    index: -1,
    push(undoData, redoData) {
        this.stack = this.stack.slice(0, this.index + 1);
        this.stack.push({ undo: undoData, redo: redoData });
        this.index++;
    },
    async perform(data) {
        try {
            await allocations.bulkUpdate(data);
            await refreshGantt();
        } catch (err) {
            console.error("History action failed", err);
            alert("操作の取り消し・やり直しに失敗しました。");
        }
    },
    async undo() {
        if (this.index >= 0) {
            const action = this.stack[this.index];
            this.index--;
            await this.perform(action.undo);
        }
    },
    async redo() {
        if (this.index < this.stack.length - 1) {
            this.index++;
            const action = this.stack[this.index];
            await this.perform(action.redo);
        }
    }
};

let allThemes = [];
let allMembers = [];
let allAllocations = [];
let warningsMap = {};
let memberLoadsMap = {};

let collapsedThemes = new Set();
let nextFocus = null; // { themeId, memberId, month }
let startMonth = addMonths(currentMonth(), -1);
let visibleCount = 14;
let scale = 1;
let currentSnapshotData = null;
let searchQuery = '';
let groupBy = 'none';

async function loadSnapshots() {
    try {
        const list = await snapshotsApi.list();
        const select = document.getElementById('snapshot-select');
        select.innerHTML = '<option value="">-- スナップショット比較なし --</option>';
        list.forEach(s => {
            const d = new Date(s.created_at);
            const ts = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            select.innerHTML += `<option value="${s.id}">${s.name} (${ts})</option>`;
        });
    } catch (err) {
        console.error('Failed to load snapshots', err);
    }
}

export async function initGantt() {
    setupControls();
    await loadSnapshots();

    // Load collapsed state
    const saved = localStorage.getItem('gantt_collapsed');
    if (saved) {
        try {
            const ids = JSON.parse(saved);
            if (Array.isArray(ids)) {
                collapsedThemes = new Set(ids);
            }
        } catch (e) {
            console.warn('Failed to parse collapsed state', e);
        }
    }

    await refreshGantt();
}

export async function refreshGantt() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const from = months[0];
    const to = months[months.length - 1];
    const toEnd = scale > 1 ? addMonths(to, scale - 1) : to;

    try {
        [allThemes, allMembers, allAllocations] = await Promise.all([
            themesApi.list(),
            membersApi.list(),
            allocations.list({ from, to: toEnd }),
        ]);

        // Build warnings map: { "member_id-month": excess }
        const warns = await allocations.warnings(from, toEnd);
        warningsMap = {};
        warns.forEach(w => { warningsMap[`${w.member_id}-${w.month}`] = w; });

        // Build member loads map
        const mLoads = await allocations.memberLoads(from, toEnd);
        memberLoadsMap = mLoads;

        render(months);
    } catch (err) {
        console.error('Failed to load gantt data:', err);
    }
}

function saveCollapsedState() {
    localStorage.setItem('gantt_collapsed', JSON.stringify([...collapsedThemes]));
}

function setupControls() {
    // Scale switcher
    document.querySelectorAll('#scale-switcher .scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelector('#scale-switcher .scale-btn.active')?.classList.remove('active');
            btn.classList.add('active');
            scale = parseInt(btn.dataset.scale);
            refreshGantt();
        });
    });

    // Filter and Grouping
    const searchInput = document.getElementById('gantt-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            refreshGantt();
        });
    }
    const groupBySelect = document.getElementById('gantt-group-by');
    if (groupBySelect) {
        groupBySelect.addEventListener('change', (e) => {
            groupBy = e.target.value;
            refreshGantt();
        });
    }

    // Navigation
    document.getElementById('gantt-prev').addEventListener('click', () => {
        startMonth = addMonths(startMonth, -scale * 3);
        refreshGantt();
    });
    document.getElementById('gantt-next').addEventListener('click', () => {
        startMonth = addMonths(startMonth, scale * 3);
        refreshGantt();
    });
    document.getElementById('gantt-today').addEventListener('click', () => {
        startMonth = addMonths(currentMonth(), -1);
        refreshGantt();
    });

    // Expand / Collapse all
    document.getElementById('gantt-expand-all').addEventListener('click', () => {
        collapsedThemes.clear();
        saveCollapsedState();
        refreshGantt();
    });
    document.getElementById('gantt-collapse-all').addEventListener('click', () => {
        allThemes.forEach(t => collapsedThemes.add(t.theme_id));
        saveCollapsedState();
        refreshGantt();
    });

    // CSV Export
    document.getElementById('gantt-export-csv').addEventListener('click', () => {
        handleExportCSV();
    });

    // XLSX Export
    document.getElementById('gantt-export-xlsx').addEventListener('click', () => {
        handleExportXLSX();
    });

    // Snapshots
    document.getElementById('snapshot-save-btn').addEventListener('click', async () => {
        const name = prompt('スナップショットの名前を入力してください:', `Snap_${new Date().toLocaleDateString()}`);
        if (!name) return;
        try {
            await snapshotsApi.create({ name, data: allAllocations });
            alert('スナップショットを保存しました。');
            await loadSnapshots();
        } catch (err) {
            alert('保存に失敗しました: ' + err.message);
        }
    });

    document.getElementById('snapshot-select').addEventListener('change', async (e) => {
        const id = e.target.value;
        if (!id) {
            currentSnapshotData = null;
        } else {
            try {
                const snap = await snapshotsApi.get(id);
                currentSnapshotData = JSON.parse(snap.data);
            } catch (err) {
                alert('スナップショットの取得に失敗しました');
                currentSnapshotData = null;
                e.target.value = '';
            }
        }
        refreshGantt();
    });
}

function render(months) {
    renderHeader(months);
    renderBody(months);
}

function renderHeader(months) {
    const thead = document.getElementById('gantt-thead');
    const cur = currentMonth();
    let html = '<tr><th>テーマ / メンバー</th>';
    months.forEach(m => {
        const isCurrent = m === cur;
        const label = formatMonthHeader(m, scale);
        html += `<th class="${isCurrent ? 'month-current' : ''}">${label.replace('\n', '<br>')}</th>`;
    });
    html += '</tr>';
    thead.innerHTML = html;
}

function renderBody(months) {
    const tbody = document.getElementById('gantt-tbody');
    const cur = currentMonth();

    // Build allocation lookup: { "theme-member": { month: rate } }
    const allocMap = {};
    allAllocations.forEach(a => {
        const key = `${a.theme_id}-${a.member_id}`;
        if (!allocMap[key]) allocMap[key] = {};
        allocMap[key][a.month] = a.allocation_rate;
    });

    let html = '';

    let displayThemes = allThemes;
    if (searchQuery) {
        displayThemes = allThemes.filter(t => {
            const matchName = t.name.toLowerCase().includes(searchQuery);
            const matchCat = (t.category || '').toLowerCase().includes(searchQuery);
            const assignedIds = new Set(t.member_ids || []);
            allMembers.forEach(m => {
                const key = `${t.theme_id}-${m.member_id}`;
                if (allocMap[key]) assignedIds.add(m.member_id);
            });
            const matchMember = allMembers.some(m => assignedIds.has(m.member_id) && m.display_name.toLowerCase().includes(searchQuery));
            return matchName || matchCat || matchMember;
        });
    }

    let groups = [];
    if (groupBy !== 'none') {
        const grouped = {};
        displayThemes.forEach(t => {
            const key = groupBy === 'category' ? (t.category || '未分類') : (t.status || '未定義');
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(t);
        });
        Object.keys(grouped).sort().forEach(groupKey => {
            let displayKey = groupKey;
            if (groupBy === 'status') {
                const sl = { planning: '計画中', active: '進行中', completed: '完了', cancelled: '中止' };
                displayKey = sl[groupKey] || groupKey;
            }
            groups.push({ key: displayKey, themes: grouped[groupKey] });
        });
    } else {
        groups = [{ key: null, themes: displayThemes }];
    }

    groups.forEach(g => {
        if (g.key) {
            html += `<tr class="gantt-row-group"><td colspan="${months.length + 1}">${g.key}</td></tr>`;
        }
        g.themes.forEach(theme => {
            const isCollapsed = collapsedThemes.has(theme.theme_id);

        // Find members assigned to this theme OR with allocations
        const assignedIds = new Set(theme.member_ids || []);
        const themeMemberRates = {};
        const themeMembers = [];

        // Pre-fill themeMemberRates and identify members with allocations
        allMembers.forEach(member => {
            const key = `${theme.theme_id}-${member.member_id}`;
            if (allocMap[key]) {
                assignedIds.add(member.member_id);
                themeMemberRates[member.member_id] = allocMap[key];
            }
        });

        // Filter and sort members assigned to this theme
        allMembers.forEach(member => {
            if (assignedIds.has(member.member_id)) {
                themeMembers.push(member);
            }
        });
        themeMembers.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'));

        // Summary row (theme total)
        const statusLabel = { planning: '計画中', active: '進行中', completed: '完了', cancelled: '中止' }[theme.status] || theme.status;
        html += `<tr class="gantt-row-summary" data-theme-id="${theme.theme_id}">`;
        html += `<td><div class="theme-label-cell">`;
        html += `<span class="theme-toggle" data-theme-id="${theme.theme_id}">`;
        html += `<span class="theme-toggle-icon ${isCollapsed ? '' : 'expanded'}">▶</span>`;
        html += `<span class="theme-priority" data-theme-id="${theme.theme_id}" title="優先度 (クリックで編集)">${theme.priority}</span>`;
        html += `<span class="theme-color-bar" style="background:${theme.color}"></span>`;
        html += `<span class="theme-name">${theme.name}</span>`;
        html += `<span class="theme-member-count" title="アサイン人数" style="margin-left: 6px; font-size: 0.8rem; color: var(--text-muted); background: var(--border-color); padding: 1px 6px; border-radius: 10px; display: inline-flex; align-items: center; gap: 3px;">👤 ${themeMembers.length}</span></span>`;

        const periodText = (theme.start_month && theme.end_month)
            ? `${shortenMonth(theme.start_month)} 〜 ${shortenMonth(theme.end_month)}`
            : '期間未設定';
        html += `<span class="theme-period ${theme.start_month ? '' : 'empty'}" data-theme-id="${theme.theme_id}">${periodText}</span>`;

        html += `<span class="theme-status status-${theme.status}" data-theme-id="${theme.theme_id}" data-status="${theme.status}">${statusLabel}</span>`;
        if (theme.category) {
            html += `<span class="theme-category">${theme.category}</span>`;
        }
        html += `<button class="btn-assign-member" data-theme-id="${theme.theme_id}" title="メンバーを追加">＋</button>`;
        html += `</div></td>`;

        months.forEach(m => {
            let total = 0;
            let oldTotal = 0;
            let breakdown = [];
            themeMembers.forEach(member => {
                const r = aggregateRate(themeMemberRates[member.member_id] || {}, m, scale);
                if (r > 0) {
                    total += r;
                    breakdown.push(`${member.display_name}: ${r}%`);
                }
                if (currentSnapshotData && scale === 1) {
                    const sAlloc = currentSnapshotData.find(a => a.theme_id === theme.theme_id && a.member_id === member.member_id && a.month === m);
                    if (sAlloc) oldTotal += sAlloc.allocation_rate;
                }
            });
            const cls = getCellClass(total, false);
            const isCurrent = m === cur;
            const isPeriod = theme.start_month && theme.end_month && m >= theme.start_month && m <= theme.end_month;
            const tooltip = breakdown.length > 0 ? breakdown.join('\n') : '';

            let content = total > 0 ? `${total}%` : '';
            if (currentSnapshotData && scale === 1 && total !== oldTotal) {
                const diff = total - oldTotal;
                const sign = diff > 0 ? '+' : '';
                const color = diff > 0 ? 'var(--color-danger)' : 'var(--color-primary-hover)';
                content = `${total > 0 ? total + '%' : '0%'} <span style="font-size:0.7em; color:${color}">(${sign}${diff})</span>`;
            }

            html += `<td class="${isCurrent ? 'month-current' : ''} ${isPeriod ? 'in-period' : 'out-period'}">`;
            html += `<div class="gantt-cell ${cls}" tabindex="0" title="${tooltip}">${content}</div>`;
            html += `</td>`;
        });
        html += '</tr>';

        // Member detail rows
        themeMembers.forEach(member => {
            const rates = themeMemberRates[member.member_id] || {};
            html += `<tr class="gantt-row-member ${isCollapsed ? 'hidden-row' : ''}" data-theme-id="${theme.theme_id}" data-member-id="${member.member_id}">`;
            html += `<td><div class="member-label-cell">`;
            html += `<span>${member.display_name}</span>`;
            html += `<button class="btn-unassign-member" data-theme-id="${theme.theme_id}" data-member-id="${member.member_id}" title="アサイン解除">×</button>`;
            html += `</div></td>`;

            months.forEach(m => {
                const rate = aggregateRate(rates, m, scale);
                const warnKey = `${member.member_id}-${m}`;
                const hasWarning = warningsMap[warnKey];
                const cls = getCellClass(rate, !!hasWarning);
                const isCurrent = m === cur;
                const isPeriod = theme.start_month && theme.end_month && m >= theme.start_month && m <= theme.end_month;

                let content = '';
                if (currentSnapshotData && scale === 1) {
                    const sAlloc = currentSnapshotData.find(a => a.theme_id === theme.theme_id && a.member_id === member.member_id && a.month === m);
                    const oldRate = sAlloc ? sAlloc.allocation_rate : 0;
                    if (rate !== oldRate) {
                        const diff = rate - oldRate;
                        const sign = diff > 0 ? '+' : '';
                        const color = diff > 0 ? 'var(--color-danger)' : 'var(--color-primary-hover)';
                        content = `${rate > 0 ? rate + '%' : '0%'} <span style="font-size:0.7em; color:${color}">(${sign}${diff})</span>`;
                    } else {
                        content = rate > 0 ? `${rate}%` : '';
                    }
                } else {
                    content = rate > 0 ? `${rate}%` : '';
                }

                html += `<td class="${isCurrent ? 'month-current' : ''} ${isPeriod ? 'in-period' : 'out-period'}">`;
                html += `<div class="gantt-cell ${cls}" tabindex="0" data-rate="${rate}" data-theme="${theme.theme_id}" data-member="${member.member_id}" data-month="${m}">`;
                html += content;
                if (hasWarning) html += `<span class="warning-icon">⚠</span>`;
                html += `</div></td>`;
            });
            html += '</tr>';
        });
    });
    });

    tbody.innerHTML = html;

    // Restore focus if set
    if (nextFocus) {
        const selector = `.gantt-cell[data-theme="${nextFocus.themeId}"][data-member="${nextFocus.memberId}"][data-month="${nextFocus.month}"]`;
        const cell = tbody.querySelector(selector);
        if (cell) {
            // Slight delay to ensure DOM is ready and previous event loop finished
            setTimeout(() => {
                const rate = parseInt(cell.dataset.rate) || 0;
                openCellEditor(cell, nextFocus.themeId, nextFocus.memberId, nextFocus.month, rate, refreshGantt, (dir, changed, newRate) => {
                    handleCellNavigation(cell, dir, changed, newRate, nextFocus.themeId, nextFocus.memberId, nextFocus.month);
                });
            }, 0);
        }
        nextFocus = null;
    }

    // Bind events
    tbody.querySelectorAll('.btn-assign-member').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const themeId = parseInt(btn.dataset.themeId);
            showAssignMemberModal(themeId);
        });
    });

    tbody.querySelectorAll('.theme-status').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const themeId = parseInt(badge.dataset.themeId);
            showStatusDropdown(badge, themeId, badge.dataset.status);
        });
    });

    tbody.querySelectorAll('.theme-period').forEach(period => {
        period.addEventListener('click', (e) => {
            e.stopPropagation();
            const themeId = parseInt(period.dataset.themeId);
            showPeriodEditor(period, themeId);
        });
    });

    tbody.querySelectorAll('.btn-unassign-member').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('このテーマからメンバーのアサインを解除しますか？（入力済みの割当データは保持されますが、この一覧からは消えます）')) return;
            const themeId = parseInt(btn.dataset.themeId);
            const memberId = parseInt(btn.dataset.memberId);
            try {
                await themesApi.unassignMember(themeId, memberId);
                refreshGantt();
            } catch (err) {
                alert('解除に失敗しました: ' + err.message);
            }
        });
    });

    tbody.querySelectorAll('.theme-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            // Prevent toggling if clicking on priority
            if (e.target.classList.contains('theme-priority')) return;

            const themeId = parseInt(toggle.dataset.themeId);
            if (collapsedThemes.has(themeId)) {
                collapsedThemes.delete(themeId);
            } else {
                collapsedThemes.add(themeId);
            }
            saveCollapsedState();
            refreshGantt();
        });
    });

    tbody.querySelectorAll('.theme-priority').forEach(p => {
        p.addEventListener('click', async (e) => {
            e.stopPropagation();
            const themeId = parseInt(p.dataset.themeId);
            showPriorityEditor(p, themeId);
        });
    });

    let isDragging = false;
    tbody.querySelectorAll('.gantt-row-member .gantt-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (isDragging) { isDragging = false; return; }
            const themeId = parseInt(cell.dataset.theme);
            const memberId = parseInt(cell.dataset.member);
            const month = cell.dataset.month;
            const currentRate = parseInt(cell.dataset.rate) || 0;
            if (scale === 1) {
                openCellEditor(e.target, themeId, memberId, month, currentRate, (newRate) => {
                    handleCellEdit(e.target, newRate, themeId, memberId, month);
                }, (dir, changed, newRate) => {
                    handleCellNavigation(e.target, dir, changed, newRate, themeId, memberId, month);
                });
            }
        });

        cell.addEventListener('contextmenu', (e) => {
            if (scale !== 1) return;
            e.preventDefault();
            const themeId = parseInt(cell.dataset.theme);
            const memberId = parseInt(cell.dataset.member);
            const month = cell.dataset.month;
            const currentRate = parseInt(cell.dataset.rate) || 0;
            showContextMenu(e.clientX, e.clientY, cell, themeId, memberId, month, currentRate);
        });

        // Tooltip on hover
        cell.addEventListener('mouseenter', (e) => {
            const memberId = parseInt(cell.dataset.member);
            const month = cell.dataset.month;
            const warnKey = `${memberId}-${month}`;
            const w = warningsMap[warnKey];
            if (w) {
                showTooltip(e, `合計 ${w.load}% (+${w.excess}% 超過)`);
            }
        });
        cell.addEventListener('mouseleave', hideTooltip);
    });

    // Keyboard Navigation (Arrow keys / Enter)
    tbody.addEventListener('keydown', (e) => {
        const cell = e.target;
        if (!cell.classList.contains('gantt-cell') || !cell.dataset.theme) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            const themeId = parseInt(cell.dataset.theme);
            const memberId = parseInt(cell.dataset.member);
            const month = cell.dataset.month;
            const currentRate = parseInt(cell.dataset.rate) || 0;
            if (scale === 1) {
                openCellEditor(cell, themeId, memberId, month, currentRate, (newRate) => {
                    handleCellEdit(cell, newRate, themeId, memberId, month);
                }, (dir, changed, newRate) => {
                    handleCellNavigation(cell, dir, changed, newRate, themeId, memberId, month);
                });
            }
            return;
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const next = calculateNextFocus(cell, e.key);
            if (next) {
                const selector = `.gantt-cell[data-theme="${next.themeId}"][data-member="${next.memberId}"][data-month="${next.month}"]`;
                const targetCell = tbody.querySelector(selector);
                if (targetCell) {
                    targetCell.focus();
                }
            }
        }
    });

    // Drag & drop for allocation transfer
    setupDragAndDrop(tbody, () => { isDragging = true; });
}

// Module-level state
let clipboardRate = null;
let _dragState = null;
let _dragCells = [];
let _dragOnStart = null;
let _saving = false;



// Handle manual update (optimistic DOM + Local Data) without API call
// API call is handled by gantt-editor's save() method
function handleCellEdit(cell, newRate, themeId, memberId, month) {
    // 1. Update DOM
    cell.dataset.rate = newRate;
    cell.textContent = newRate > 0 ? `${newRate}%` : '';

    cell.classList.remove('rate-low', 'rate-mid', 'rate-high', 'rate-full', 'rate-over');
    if (newRate > 0) {
        if (newRate <= 30) cell.classList.add('rate-low');
        else if (newRate <= 60) cell.classList.add('rate-mid');
        else if (newRate < 100) cell.classList.add('rate-high');
        else if (newRate === 100) cell.classList.add('rate-full');
    }

    // 2. Update Local Data
    let alloc = allAllocations.find(a => a.theme_id === themeId && a.member_id === memberId && a.month === month);
    if (alloc) {
        alloc.allocation_rate = newRate;
    } else {
        allAllocations.push({
            theme_id: themeId,
            member_id: memberId,
            month: month,
            allocation_rate: newRate
        });
    }
}

// Navigation handler
// Navigation handler
function handleCellNavigation(currentCell, direction, changed, newRate, themeId, memberId, month) {
    if (changed) {
        // 1. Optimistic Update: Update DOM immediately
        currentCell.dataset.rate = newRate;
        // Update cell content and class based on new rate
        // We need to re-evaluate the cell class logic here to keep it consistent
        // For now, simpler update:
        currentCell.textContent = newRate > 0 ? `${newRate}%` : '';

        // Remove old rate classes and add new one
        currentCell.classList.remove('rate-low', 'rate-mid', 'rate-high', 'rate-full', 'rate-over');

        // We don't have easy access to total load to calculate 'rate-over' without full recalc,
        // but we can at least show the rate color.
        if (newRate > 0) {
            if (newRate <= 30) currentCell.classList.add('rate-low');
            else if (newRate <= 60) currentCell.classList.add('rate-mid');
            else if (newRate < 100) currentCell.classList.add('rate-high');
            else if (newRate === 100) currentCell.classList.add('rate-full');
        }

        // 2. Update Local Data (allAllocations)
        let alloc = allAllocations.find(a => a.theme_id === themeId && a.member_id === memberId && a.month === month);
        const oldRate = alloc ? alloc.allocation_rate : 0;
        if (alloc) {
            alloc.allocation_rate = newRate;
        } else {
            // Create new structure if it didn't exist
            allAllocations.push({
                theme_id: themeId,
                member_id: memberId,
                month: month,
                allocation_rate: newRate
            });
        }

        // 3. Background Save (Fire and Forget)
        const updateData = {
            theme_id: themeId,
            member_id: memberId,
            month: month,
            allocation_rate: newRate,
        };
        HistoryManager.push(
            [{...updateData, allocation_rate: oldRate}],
            [updateData]
        );
        allocations.updateSingle(updateData).catch(err => {
            console.error('Background save failed:', err);
            alert('保存に失敗しました。リロードしてください。');
        });
    }

    // 4. Move Focus
    const next = calculateNextFocus(currentCell, direction);
    if (next) {
        const selector = `.gantt-cell[data-theme="${next.themeId}"][data-member="${next.memberId}"][data-month="${next.month}"]`;
        const tbody = document.getElementById('gantt-tbody');
        const targetCell = tbody.querySelector(selector);
        if (targetCell) {
            const rate = parseInt(targetCell.dataset.rate) || 0;
            openCellEditor(targetCell, next.themeId, next.memberId, next.month, rate, (newRate) => {
                handleCellEdit(targetCell, newRate, next.themeId, next.memberId, next.month);
            }, (dir, ch, nr) => {
                handleCellNavigation(targetCell, dir, ch, nr, next.themeId, next.memberId, next.month);
            });
        }
    }
}

function calculateNextFocus(currentCell, direction) {
    const row = currentCell.closest('tr');
    if (!row) return null;

    if (direction === 'ArrowLeft') {
        const prevTd = currentCell.parentElement.previousElementSibling;
        const target = prevTd?.querySelector('.gantt-cell[data-theme]');
        if (target) return extractCellData(target);
    }
    else if (direction === 'ArrowRight') {
        const nextTd = currentCell.parentElement.nextElementSibling;
        const target = nextTd?.querySelector('.gantt-cell[data-theme]');
        if (target) return extractCellData(target);
    }
    else if (direction === 'ArrowUp') {
        let prevRow = row.previousElementSibling;
        while (prevRow) {
            if (prevRow.classList.contains('gantt-row-member') && !prevRow.classList.contains('hidden-row')) {
                const cellIndex = currentCell.parentElement.cellIndex;
                const target = prevRow.children[cellIndex]?.querySelector('.gantt-cell');
                if (target) return extractCellData(target);
                break;
            }
            prevRow = prevRow.previousElementSibling;
        }
    }
    else if (direction === 'ArrowDown') {
        let nextRow = row.nextElementSibling;
        while (nextRow) {
            if (nextRow.classList.contains('gantt-row-member') && !nextRow.classList.contains('hidden-row')) {
                const cellIndex = currentCell.parentElement.cellIndex;
                const target = nextRow.children[cellIndex]?.querySelector('.gantt-cell');
                if (target) return extractCellData(target);
                break;
            }
            nextRow = nextRow.nextElementSibling;
        }
    }
    return null;
}

function showContextMenu(x, y, cell, themeId, memberId, month, currentRate) {
    const menu = document.getElementById('context-menu');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.hidden = false;
    
    const pasteBtn = menu.querySelector('#ctx-paste');
    if (clipboardRate !== null) {
        pasteBtn.classList.remove('disabled');
    } else {
        pasteBtn.classList.add('disabled');
    }
    
    // Re-attach handlers safely by clearing old ones
    const newMenu = menu.cloneNode(true);
    menu.parentNode.replaceChild(newMenu, menu);
    
    newMenu.querySelector('#ctx-edit').onclick = () => {
        newMenu.hidden = true;
        openCellEditor(cell, themeId, memberId, month, currentRate, (newRate) => {
            handleCellEdit(cell, newRate, themeId, memberId, month);
        }, (dir, changed, newRate) => {
            handleCellNavigation(cell, dir, changed, newRate, themeId, memberId, month);
        });
    };
    
    newMenu.querySelector('#ctx-copy').onclick = () => {
        clipboardRate = currentRate;
        newMenu.hidden = true;
    };
    
    newMenu.querySelector('#ctx-paste').onclick = () => {
        if (clipboardRate === null) return;
        newMenu.hidden = true;
        if (currentRate !== clipboardRate) {
            handleCellNavigation(cell, null, true, clipboardRate, themeId, memberId, month);
        }
    };
    
    newMenu.querySelector('#ctx-clear').onclick = () => {
        newMenu.hidden = true;
        if (currentRate !== 0) {
            handleCellNavigation(cell, null, true, 0, themeId, memberId, month);
        }
    };
    
    const hideMenu = (e) => {
        if (!newMenu.contains(e.target)) {
            newMenu.hidden = true;
            document.removeEventListener('mousedown', hideMenu);
        }
    };
    setTimeout(() => {
        document.addEventListener('mousedown', hideMenu);
    }, 10);
}

function extractCellData(cell) {
    return {
        themeId: parseInt(cell.dataset.theme),
        memberId: parseInt(cell.dataset.member),
        month: cell.dataset.month
    };
}

function setupDragAndDrop(tbody, onDragStart) {
    if (scale !== 1) return; // Only allow D&D at 1M scale

    const DRAG_THRESHOLD = 5;
    _dragCells = Array.from(tbody.querySelectorAll('.gantt-row-member .gantt-cell'));
    _dragOnStart = onDragStart;

    // handlers (defined per scope to access closure if needed, but here we use module state)
    const onMouseMove = (e) => {
        if (!_dragState) return;

        const dx = e.clientX - _dragState.startX;
        const dy = e.clientY - _dragState.startY;

        if (!_dragState.started) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            _dragState.started = true;
            if (_dragOnStart) _dragOnStart();
            _dragState.srcCell.classList.add('dragging');

            const ghost = document.createElement('div');
            ghost.className = 'drag-ghost';
            ghost.textContent = `${_dragState.rate}%`;
            ghost.style.cssText = `
                position: fixed; z-index: 9999;
                padding: 4px 14px; background: #6366f1; color: #fff;
                border-radius: 6px; font-size: 13px; font-weight: 600;
                pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transform: translate(-50%, -50%);
            `;
            document.body.appendChild(ghost);
            _dragState.ghost = ghost;
        }

        if (_dragState.ghost) {
            _dragState.ghost.style.left = `${e.clientX}px`;
            _dragState.ghost.style.top = `${e.clientY}px`;
        }

        // Highlight valid drop targets:
        // - Same theme, different member (transfer)
        // - Same theme, same member, different month (period move)
        _dragCells.forEach(c => {
            c.classList.remove('drag-over');
            if (c.dataset.theme !== _dragState.themeId) return;
            // Skip the exact source cell
            if (c === _dragState.srcCell) return;

            const rect = c.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                c.classList.add('drag-over');
            }
        });
    };

    const onMouseUp = async (e) => {
        // Cleanup listeners immediately
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (!_dragState) return;
        const state = _dragState;
        _dragState = null;

        // Cleanup visuals
        state.srcCell.classList.remove('dragging');
        if (state.ghost && state.ghost.parentNode) {
            document.body.removeChild(state.ghost);
        }
        _dragCells.forEach(c => c.classList.remove('drag-over'));

        if (!state.started) return;
        if (_saving) return; // Prevent double-submit

        // Find drop target (same theme, but not the exact source cell)
        const target = _dragCells.find(c => {
            if (c === state.srcCell) return false;
            if (c.dataset.theme !== state.themeId) return false;
            const rect = c.getBoundingClientRect();
            return e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom;
        });

        if (!target) return;

        const isSameMember = target.dataset.member === state.memberId;
        const targetRate = parseInt(target.dataset.rate) || 0;

        _saving = true;
        try {
            if (isSameMember) {
                // Period move: move allocation to different month
                const redoData = [
                    { theme_id: parseInt(state.themeId), member_id: parseInt(state.memberId), month: state.month, allocation_rate: 0 },
                    { theme_id: parseInt(state.themeId), member_id: parseInt(state.memberId), month: target.dataset.month, allocation_rate: state.rate },
                ];
                const undoData = [
                    { theme_id: parseInt(state.themeId), member_id: parseInt(state.memberId), month: state.month, allocation_rate: state.rate },
                    { theme_id: parseInt(state.themeId), member_id: parseInt(state.memberId), month: target.dataset.month, allocation_rate: targetRate },
                ];
                HistoryManager.push(undoData, redoData);
                await allocations.bulkUpdate(redoData);
            } else {
                // Transfer: move allocation to different member
                const newTargetRate = Math.min(100, targetRate + state.rate);
                const redoData = [
                    { theme_id: parseInt(state.themeId), member_id: parseInt(state.memberId), month: state.month, allocation_rate: 0 },
                    { theme_id: parseInt(target.dataset.theme), member_id: parseInt(target.dataset.member), month: target.dataset.month, allocation_rate: newTargetRate },
                ];
                const undoData = [
                    { theme_id: parseInt(state.themeId), member_id: parseInt(state.memberId), month: state.month, allocation_rate: state.rate },
                    { theme_id: parseInt(target.dataset.theme), member_id: parseInt(target.dataset.member), month: target.dataset.month, allocation_rate: targetRate },
                ];
                HistoryManager.push(undoData, redoData);
                await allocations.bulkUpdate(redoData);
            }
            refreshGantt();
        } catch (err) {
            console.error('Drag transfer failed:', err);
            alert('負荷率の移動に失敗しました: ' + err.message);
        } finally {
            _saving = false;
        }
    };

    // Attach mousedown
    _dragCells.forEach(cell => {
        cell.addEventListener('mousedown', (e) => {
            const rate = parseInt(cell.dataset.rate) || 0;
            if (rate === 0) return;
            if (e.button !== 0) return;

            _dragState = {
                srcCell: cell,
                themeId: cell.dataset.theme,
                memberId: cell.dataset.member,
                month: cell.dataset.month,
                rate: rate,
                startX: e.clientX,
                startY: e.clientY,
                started: false,
                ghost: null,
            };
            e.preventDefault();

            // Attach dynamic listeners
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

function getCellClass(rate, isOver) {
    if (isOver) return 'rate-over';
    if (rate === 0) return '';
    if (rate <= 30) return 'rate-low';
    if (rate <= 60) return 'rate-mid';
    if (rate < 100) return 'rate-high';
    if (rate === 100) return 'rate-full';
    return 'rate-over';
}

function showTooltip(e, text) {
    const tooltip = document.getElementById('tooltip');
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY - 8}px`;
}

function hideTooltip() {
    document.getElementById('tooltip').hidden = true;
}

async function showAssignMemberModal(themeId) {
    const theme = allThemes.find(t => t.theme_id === themeId);
    if (!theme) return;

    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFooter = document.getElementById('modal-footer');
    const modalOverlay = document.getElementById('modal-overlay');

    modalTitle.textContent = `${theme.name} にメンバーを追加`;

    // Filter out members already assigned
    const assignedIds = new Set(theme.member_ids || []);
    const availableMembers = allMembers.filter(m => m.is_active && !assignedIds.has(m.member_id));
    availableMembers.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'));

    if (availableMembers.length === 0) {
        modalBody.innerHTML = '<p>追加可能な有効なメンバーがいません。</p>';
        modalFooter.innerHTML = '<button class="btn btn-ghost" id="modal-cancel">閉じる</button>';
    } else {
        let html = '<div class="member-selection-list">';
        availableMembers.forEach(m => {
            html += `
                <div class="member-selection-item" data-member-id="${m.member_id}">
                    <div style="display:flex; flex-direction:column">
                        <span class="member-name">${m.display_name}</span>
                        <span class="member-dept" style="font-size:0.8em; color:var(--color-text-muted)">${m.department || ''}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        modalBody.innerHTML = html;

        // Footer with Submit button
        modalFooter.innerHTML = `
            <button class="btn btn-ghost" id="modal-cancel">キャンセル</button>
            <button class="btn btn-primary" id="modal-submit" disabled>登録</button>
        `;

        const selectedMemberIds = new Set();
        const submitBtn = document.getElementById('modal-submit');

        // Bind selection events
        modalBody.querySelectorAll('.member-selection-item').forEach(item => {
            item.addEventListener('click', () => {
                const memberId = parseInt(item.dataset.memberId);
                if (selectedMemberIds.has(memberId)) {
                    selectedMemberIds.delete(memberId);
                    item.classList.remove('is-selected');
                } else {
                    selectedMemberIds.add(memberId);
                    item.classList.add('is-selected');
                }
                submitBtn.disabled = selectedMemberIds.size === 0;
            });
        });

        // Bind submit action
        submitBtn.addEventListener('click', async () => {
            if (selectedMemberIds.size === 0) return;
            try {
                submitBtn.disabled = true;
                submitBtn.textContent = '登録中...';
                await themesApi.assignMembersBulk(themeId, Array.from(selectedMemberIds));
                modalOverlay.hidden = true;
                refreshGantt();
            } catch (err) {
                alert('登録に失敗しました: ' + err.message);
                submitBtn.disabled = false;
                submitBtn.textContent = '登録';
            }
        });
    }

    document.getElementById('modal-close').onclick = () => { modalOverlay.hidden = true; };
    const cancelBtn = document.getElementById('modal-cancel');
    if (cancelBtn) cancelBtn.onclick = () => { modalOverlay.hidden = true; };
    modalOverlay.hidden = false;
}

const STATUS_OPTIONS = [
    { value: 'planning', label: '計画中' },
    { value: 'active', label: '進行中' },
    { value: 'completed', label: '完了' },
    { value: 'cancelled', label: '中止' },
];

function showStatusDropdown(badge, themeId, currentStatus) {
    // Remove any existing dropdown
    document.querySelector('.status-dropdown')?.remove();

    const dropdown = document.createElement('div');
    dropdown.className = 'status-dropdown';

    STATUS_OPTIONS.forEach(opt => {
        const item = document.createElement('div');
        item.className = `status-dropdown-item status-${opt.value}${opt.value === currentStatus ? ' current' : ''}`;
        item.textContent = opt.label;
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.remove();
            if (opt.value === currentStatus) return;
            try {
                await themesApi.update(themeId, { status: opt.value });
                refreshGantt();
            } catch (err) {
                alert('ステータス変更に失敗しました: ' + err.message);
            }
        });
        dropdown.appendChild(item);
    });

    // Position below the badge
    const rect = badge.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(dropdown);

    // Close on outside click
    const closeHandler = (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function showPeriodEditor(pElement, themeId) {
    // Remove any existing editor
    document.querySelector('.period-editor')?.remove();

    const theme = allThemes.find(t => t.theme_id === themeId);
    if (!theme) return;

    // Parse start/end dates
    const parseYM = (ym) => {
        if (!ym) {
            const now = new Date();
            return { y: now.getFullYear() % 100, m: now.getMonth() + 1 };
        }
        const [y, m] = ym.split('-');
        return { y: parseInt(y) % 100, m: parseInt(m) };
    };
    const start = parseYM(theme.start_month);
    const end = parseYM(theme.end_month);

    const editor = document.createElement('div');
    editor.className = 'period-editor';
    editor.innerHTML = `
        <div class="period-editor-fields">
            <div class="period-group">
                <input type="number" id="period-start-y" class="period-input-year" value="${start.y}" min="0" max="99">
                <span>年</span>
                <input type="number" id="period-start-m" class="period-input-month" value="${start.m}" min="1" max="12">
                <span>月</span>
            </div>
            <span class="period-separator">〜</span>
            <div class="period-group">
                <input type="number" id="period-end-y" class="period-input-year" value="${end.y}" min="0" max="99">
                <span>年</span>
                <input type="number" id="period-end-m" class="period-input-month" value="${end.m}" min="1" max="12">
                <span>月</span>
            </div>
        </div>
        <div class="period-editor-actions">
            <button class="btn btn-primary btn-sm" id="period-save">保存</button>
            <button class="btn btn-ghost btn-sm" id="period-cancel">キャンセル</button>
        </div>
    `;

    const rect = pElement.getBoundingClientRect();
    editor.style.left = `${rect.left}px`;
    editor.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(editor);

    const closeEditor = () => {
        editor.remove();
        document.removeEventListener('mousedown', onOutsideClick);
    };

    const onOutsideClick = (e) => {
        if (!editor.contains(e.target)) closeEditor();
    };

    editor.querySelector('#period-cancel').onclick = closeEditor;
    editor.querySelector('#period-save').onclick = async () => {
        const startY = editor.querySelector('#period-start-y').value;
        const startM = editor.querySelector('#period-start-m').value;
        const endY = editor.querySelector('#period-end-y').value;
        const endM = editor.querySelector('#period-end-m').value;

        // Simple validation
        if (startM < 1 || startM > 12 || endM < 1 || endM > 12) {
            alert('月は1〜12の間で入力してください');
            return;
        }

        const fmt = (y, m) => `20${y.toString().padStart(2, '0')}-${m.toString().padStart(2, '0')}`;
        const startStr = fmt(startY, startM);
        const endStr = fmt(endY, endM);

        try {
            await themesApi.update(themeId, { start_month: startStr, end_month: endStr });
            closeEditor();
            refreshGantt();
        } catch (err) {
            alert('保存に失敗しました: ' + err.message);
        }
    };

    setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
}

function showPriorityEditor(pElement, themeId) {
    // Remove any existing editor
    document.querySelector('.priority-editor')?.remove();

    const currentVal = pElement.textContent.trim();

    const editor = document.createElement('div');
    editor.className = 'priority-editor';
    editor.innerHTML = `
        <input type="number" id="priority-input" min="0" max="9" value="${currentVal}">
    `;

    const rect = pElement.getBoundingClientRect();
    editor.style.left = `${rect.left}px`;
    editor.style.top = `${rect.bottom + 4}px`; // Position below the element
    document.body.appendChild(editor);

    const input = editor.querySelector('#priority-input');
    input.focus();
    input.select();

    const closeEditor = () => {
        editor.remove();
        document.removeEventListener('mousedown', onOutsideClick);
    };

    const save = async () => {
        const val = input.value;
        const num = parseInt(val);
        if (isNaN(num) || num < 0 || num > 9) {
            // Invalid input, just close or maybe show error? 
            // For now, consistent with requester: valid 0-9
            return;
        }

        try {
            await themesApi.update(themeId, { priority: num });
            closeEditor();
            refreshGantt();
        } catch (err) {
            alert('保存に失敗しました: ' + err.message);
        }
    };

    const onOutsideClick = (e) => {
        if (!editor.contains(e.target)) closeEditor();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            closeEditor();
        }
    });

    // Auto-save on blur? Or just close? Requester wants arrow keys which works in input type=number.
    // Let's rely on Enter to save to prevent accidental saves while scrolling through numbers.

    setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
}

/**
 * Handle CSV Export - sends CSV data to server endpoint for proper file download
 */
async function handleExportCSV() {
    try {
        const months = getVisibleMonths(startMonth, visibleCount, scale);

        // CSV Header Labels
        const getCSVHeaderLabel = (m, s) => {
            const [y, mm] = m.split('-').map(Number);
            const shortY = String(y).slice(2);
            if (s === 1) return `${shortY}-${String(mm).padStart(2, '0')}`;
            if (s === 3) return `${shortY}-Q${Math.ceil(mm / 3)}`;
            if (s === 6) return `${shortY}-${mm <= 6 ? 'H1' : 'H2'}`;
            return `${y}`;
        };

        const escape = (val) => {
            const str = String(val || '');
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // CSV Header Row
        const headers = ['\u30c6\u30fc\u30de', '\u5185\u8a33', '\u30b9\u30c6\u30fc\u30bf\u30b9'];
        months.forEach(m => headers.push(getCSVHeaderLabel(m, scale)));
        const csvRows = [headers.map(escape).join(',')];

        // Allocation lookup
        const allocMap = {};
        allAllocations.forEach(a => {
            const key = `${a.theme_id}-${a.member_id}`;
            if (!allocMap[key]) allocMap[key] = {};
            allocMap[key][a.month] = a.allocation_rate;
        });

        allThemes.forEach(theme => {
            const statusLabel = { planning: '\u8a08\u753b\u4e2d', active: '\u9032\u884c\u4e2d', completed: '\u5b8c\u4e86', cancelled: '\u4e2d\u6b62' }[theme.status] || theme.status;

            const assignedIds = new Set(theme.member_ids || []);
            const themeMemberRates = {};
            const themeMembers = [];

            allMembers.forEach(member => {
                const key = `${theme.theme_id}-${member.member_id}`;
                if (allocMap[key]) {
                    assignedIds.add(member.member_id);
                    themeMemberRates[member.member_id] = allocMap[key];
                }
            });

            assignedIds.forEach(mid => {
                const member = allMembers.find(m => m.member_id === mid);
                if (member) {
                    themeMembers.push(member);
                    if (!themeMemberRates[mid]) themeMemberRates[mid] = allocMap[`${theme.theme_id}-${mid}`] || {};
                }
            });

            const summaryRow = [theme.name, '\u5408\u7b97', statusLabel];
            months.forEach(m => {
                let total = 0;
                themeMembers.forEach(member => {
                    total += aggregateRate(themeMemberRates[member.member_id] || {}, m, scale);
                });
                summaryRow.push(total > 0 ? `${total}%` : '');
            });
            csvRows.push(summaryRow.map(escape).join(','));

            themeMembers.forEach(member => {
                const memberRow = ['', member.display_name, ''];
                months.forEach(m => {
                    const rate = aggregateRate(themeMemberRates[member.member_id] || {}, m, scale);
                    memberRow.push(rate > 0 ? `${rate}%` : '');
                });
                csvRows.push(memberRow.map(escape).join(','));
            });
        });

        // Use hidden form POST so browser natively handles Content-Disposition filename
        const csvContent = csvRows.join('\r\n');
        const fileName = `gantt_export_${currentMonth().replace('-', '')}.csv`;

        // Create a hidden iframe as the form target
        let iframe = document.getElementById('csv-download-frame');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'csv-download-frame';
            iframe.name = 'csv-download-frame';
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
        }

        // Create and submit a hidden form
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/api/export/csv';
        form.target = 'csv-download-frame';
        form.style.display = 'none';

        const contentInput = document.createElement('input');
        contentInput.type = 'hidden';
        contentInput.name = 'content';
        contentInput.value = csvContent;
        form.appendChild(contentInput);

        const filenameInput = document.createElement('input');
        filenameInput.type = 'hidden';
        filenameInput.name = 'filename';
        filenameInput.value = fileName;
        form.appendChild(filenameInput);

        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
    } catch (err) {
        console.error('CSV Export Error:', err);
        alert('CSV出力中にエラーが発生しました: ' + err.message);
    }
}

async function handleExportXLSX() {
    try {
        const months = getVisibleMonths(startMonth, visibleCount, scale);

        const getCSVHeaderLabel = (m, s) => {
            const [y, mm] = m.split('-').map(Number);
            const shortY = String(y).slice(2);
            if (s === 1) return `${shortY}-${String(mm).padStart(2, '0')}`;
            if (s === 3) return `${shortY}-Q${Math.ceil(mm / 3)}`;
            if (s === 6) return `${shortY}-${mm <= 6 ? 'H1' : 'H2'}`;
            return `${y}`;
        };

        const headers = ['テーマ', '内訳', 'ステータス'];
        months.forEach(m => headers.push(getCSVHeaderLabel(m, scale)));
        
        const rows = [];
        const allocMap = {};
        allAllocations.forEach(a => {
            const key = `${a.theme_id}-${a.member_id}`;
            if (!allocMap[key]) allocMap[key] = {};
            allocMap[key][a.month] = a.allocation_rate;
        });

        allThemes.forEach(theme => {
            const statusLabel = { planning: '計画中', active: '進行中', completed: '完了', cancelled: '中止' }[theme.status] || theme.status;
            const assignedIds = new Set(theme.member_ids || []);
            const themeMemberRates = {};
            const themeMembers = [];

            allMembers.forEach(member => {
                const key = `${theme.theme_id}-${member.member_id}`;
                if (allocMap[key]) {
                    assignedIds.add(member.member_id);
                    themeMemberRates[member.member_id] = allocMap[key];
                }
            });

            assignedIds.forEach(mid => {
                const member = allMembers.find(m => m.member_id === mid);
                if (member) {
                    themeMembers.push(member);
                    if (!themeMemberRates[mid]) themeMemberRates[mid] = allocMap[`${theme.theme_id}-${mid}`] || {};
                }
            });

            const summaryRow = [theme.name, '合算', statusLabel];
            months.forEach(m => {
                let total = 0;
                themeMembers.forEach(member => {
                    total += aggregateRate(themeMemberRates[member.member_id] || {}, m, scale);
                });
                summaryRow.push(total > 0 ? `${total}%` : '');
            });
            rows.push(summaryRow);

            themeMembers.forEach(member => {
                const memberRow = ['', member.display_name, ''];
                months.forEach(m => {
                    const rate = aggregateRate(themeMemberRates[member.member_id] || {}, m, scale);
                    memberRow.push(rate > 0 ? `${rate}%` : '');
                });
                rows.push(memberRow);
            });
        });

        const fileName = `gantt_export_${currentMonth().replace('-', '')}.xlsx`;
        
        const res = await fetch('/api/export/xlsx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headers, rows, filename: fileName })
        });
        
        if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);

    } catch (err) {
        console.error('XLSX Export Error:', err);
        alert('Excel出力中にエラーが発生しました: ' + err.message);
    }
}
