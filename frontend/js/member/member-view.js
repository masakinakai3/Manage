/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Member Load View
 * Displays member monthly load with overload warnings and detail popups.
 */

import { openCellEditor } from '../gantt/gantt-editor.js';
import { allocations, members as membersApi, themes as themesApi } from '../api.js';
import {
    currentMonth, getVisibleMonths, formatMonthHeader, addMonths, aggregateRate,
    shortenMonth
} from '../utils/date-utils.js';

let allMembers = [];
let allThemes = [];
let startMonth = addMonths(currentMonth(), -1);
let visibleCount = 14;
let scale = 1;

let lastAllocations = [];

export async function initMemberView() {
    setupControls();
    await refreshMemberView();
}

export async function refreshMemberView() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const from = months[0];
    const to = months[months.length - 1];
    const toEnd = scale > 1 ? addMonths(to, scale - 1) : to;

    try {
        [allMembers, allThemes] = await Promise.all([
            membersApi.list(),
            themesApi.list(),
        ]);

        let memberLoads, warns;
        [memberLoads, warns, lastAllocations] = await Promise.all([
            allocations.memberLoads(from, toEnd),
            allocations.warnings(from, toEnd),
            allocations.list({ from, to: toEnd }),
        ]);

        render(months, memberLoads, warns, lastAllocations);
    } catch (err) {
        console.error('Failed to load member view:', err);
    }
}

function setupControls() {
    // Inject Expand/Collapse All and Export buttons if not present
    const switcher = document.getElementById('member-scale-switcher');
    if (switcher && !document.getElementById('member-expand-all')) {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.marginRight = '16px';
        container.innerHTML = `
            <button class="btn btn-ghost btn-sm" id="member-expand-all">全展開</button>
            <button class="btn btn-ghost btn-sm" id="member-collapse-all">全たたみ</button>
            <button class="btn btn-secondary btn-sm" id="member-export-csv" style="margin-left:8px">CSV出力</button>
        `;
        switcher.parentNode.insertBefore(container, switcher);
    }

    document.getElementById('member-expand-all')?.addEventListener('click', () => {
        document.querySelectorAll('.theme-row').forEach(row => row.classList.remove('hidden'));
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.classList.add('expanded');
            btn.textContent = '▼';
        });
    });

    document.getElementById('member-collapse-all')?.addEventListener('click', () => {
        document.querySelectorAll('.theme-row').forEach(row => row.classList.add('hidden'));
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.classList.remove('expanded');
            btn.textContent = '▶';
        });
    });

    document.getElementById('member-export-csv')?.addEventListener('click', () => {
        exportCSV();
    });

    document.querySelectorAll('#member-scale-switcher .scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelector('#member-scale-switcher .scale-btn.active')?.classList.remove('active');
            btn.classList.add('active');
            scale = parseInt(btn.dataset.scale);
            refreshMemberView();
        });
    });

    document.getElementById('member-prev').addEventListener('click', () => {
        startMonth = addMonths(startMonth, -scale * 3);
        refreshMemberView();
    });
    document.getElementById('member-next').addEventListener('click', () => {
        startMonth = addMonths(startMonth, scale * 3);
        refreshMemberView();
    });
    document.getElementById('member-today').addEventListener('click', () => {
        startMonth = addMonths(currentMonth(), -1);
        refreshMemberView();
    });
}

async function exportCSV() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const monthsHeader = months.map(m => formatMonthHeader(m, scale).replace('\n', ''));

    // Header
    const headers = ['メンバー', '所属', 'テーマ', 'カテゴリ', 'ステータス', ...monthsHeader];
    let csvContent = headers.join(',') + '\n';

    // Build detail data: member -> theme -> { month: rate }
    const memberThemeLoads = {}; // { memberId: { themeId: { month: rate } } }

    lastAllocations.forEach(a => {
        if (!memberThemeLoads[a.member_id]) memberThemeLoads[a.member_id] = {};
        if (!memberThemeLoads[a.member_id][a.theme_id]) memberThemeLoads[a.member_id][a.theme_id] = {};
        memberThemeLoads[a.member_id][a.theme_id][a.month] = a.allocation_rate;
    });

    // Generate rows
    allMembers.forEach(member => {
        const memberThemes = memberThemeLoads[member.member_id] || {};
        const themeIds = Object.keys(memberThemes).map(id => parseInt(id));

        if (themeIds.length === 0) {
            // Option: export member with no themes?
            // For now, let's only export members with allocations to match the view's "expand" logic?
            // Actually, view shows all members, but only expands if they have themes.
            // Let's export even if no themes?
            // "Member Load" usually implies seeing what they are working on.
            // If they have no work, a single row with empty theme columns might be useful to show they are free.
            const row = [
                member.display_name,
                member.department || '',
                '', // Theme
                '', // Category
                '', // Status
                ...months.map(() => '')
            ];
            csvContent += row.join(',') + '\n';
        } else {
            themeIds.forEach(tid => {
                const theme = allThemes.find(t => t.theme_id === tid);
                const themeName = theme ? theme.name : `Theme ${tid}`;
                const category = theme ? theme.category : '';
                const status = theme ? theme.status : '';
                const themeLoads = memberThemes[tid];

                const row = [
                    member.display_name,
                    member.department || '',
                    themeName,
                    category,
                    status,
                    ...months.map(m => themeLoads[m] || '')
                ];
                csvContent += row.join(',') + '\n';
            });
        }
    });

    // Send to backend
    const filename = `member_load_${months[0]}_${months[months.length - 1]}.csv`;

    try {
        const response = await fetch('/api/export/csv', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: csvContent,
                filename: filename
            })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } else {
            console.error('Export failed:', await response.text());
            alert('CSV出力に失敗しました。');
        }
    } catch (err) {
        console.error('Export error:', err);
        alert('CSV出力中にエラーが発生しました。');
    }
}

function render(months, memberLoads, warnings, allAllocs) {
    renderHeader(months);
    renderBody(months, memberLoads, warnings, allAllocs);
}

function renderHeader(months) {
    const thead = document.getElementById('member-load-thead');
    const cur = currentMonth();
    let html = '<tr><th>メンバー</th>';
    months.forEach(m => {
        const isCurrent = m === cur;
        const label = formatMonthHeader(m, scale);
        html += `<th class="${isCurrent ? 'month-current' : ''}">${label.replace('\n', '<br>')}</th>`;
    });
    html += '</tr>';
    thead.innerHTML = html;
}

/**
 * Build a stacked bar HTML string showing theme-color proportions for a member/month.
 * @param {number} memberId
 * @param {string} month
 * @param {object} memberThemes  { themeId: { month: rate } }
 * @param {number} capacity  member's capacity %
 * @returns {{ barHtml: string, details: Array<{theme_name,color,rate}> }}
 */
function buildStackedBar(memberId, month, memberThemes, capacity) {
    const details = [];
    Object.keys(memberThemes).forEach(themeId => {
        const tid = parseInt(themeId);
        const rate = aggregateRate(memberThemes[tid], month, scale);
        if (rate <= 0) return;
        const theme = allThemes.find(t => t.theme_id === tid);
        details.push({
            theme_id: tid,
            theme_name: theme ? theme.name : `Theme ${tid}`,
            color: theme ? theme.color : '#888888',
            rate,
        });
    });

    if (details.length === 0) return { barHtml: '', details: [] };

    const total = details.reduce((s, d) => s + d.rate, 0);
    // Bar base is capacity (capped at 100 for display; overflow shown in red extension)
    const barBase = Math.max(total, capacity, 100);

    let segmentsHtml = '';
    details.forEach(d => {
        const widthPct = (d.rate / barBase) * 100;
        segmentsHtml += `<span class="stacked-bar-segment" style="width:${widthPct.toFixed(2)}%;background:${d.color}" title="${d.theme_name}: ${d.rate}%"></span>`;
    });

    // Capacity marker line position
    const markerPct = (capacity / barBase) * 100;
    const overflowClass = total > capacity ? ' stacked-bar--over' : '';

    const barHtml = `<div class="stacked-bar${overflowClass}">
        ${segmentsHtml}
        <span class="stacked-bar-capacity" style="left:${markerPct.toFixed(2)}%" title="キャパシティ: ${capacity}%"></span>
    </div>`;

    return { barHtml, details };
}

function renderBody(months, memberLoads, warnings, allAllocs) {
    const tbody = document.getElementById('member-load-tbody');
    const cur = currentMonth();

    // Build warnings set
    const warnSet = new Set();
    warnings.forEach(w => warnSet.add(`${w.member_id}-${w.month}`));

    // Build detail data: member -> theme -> { month: rate }
    const memberThemeLoads = {}; // { memberId: { themeId: { month: rate } } }

    allAllocs.forEach(a => {
        if (!memberThemeLoads[a.member_id]) memberThemeLoads[a.member_id] = {};
        if (!memberThemeLoads[a.member_id][a.theme_id]) memberThemeLoads[a.member_id][a.theme_id] = {};
        memberThemeLoads[a.member_id][a.theme_id][a.month] = a.allocation_rate;
    });

    let html = '';
    allMembers.forEach(member => {
        const loads = memberLoads[member.member_id] || {};
        const memberThemes = memberThemeLoads[member.member_id] || {};
        const hasThemes = Object.keys(memberThemes).length > 0;

        // Member Row
        html += `<tr class="member-row" data-member-row="${member.member_id}">`;
        html += `<td>
            <div class="member-row-header">
                ${hasThemes ? `<div class="toggle-btn" data-toggle="${member.member_id}">▶</div>` : '<div style="width:20px"></div>'}
                <div>${member.display_name} <span class="member-capacity">(${member.capacity}%)</span></div>
            </div>
        </td>`;

        months.forEach(m => {
            const load = aggregateRate(loads, m, scale);
            const isCurrent = m === cur;
            const isOver = warnSet.has(`${member.member_id}-${m}`);
            const cls = getLoadClass(load, member.capacity, isOver);
            const { barHtml, details } = buildStackedBar(member.member_id, m, memberThemes, member.capacity);
            // Serialize details into data attribute for hover popup
            const detailsJson = details.length > 0 ? encodeURIComponent(JSON.stringify(details)) : '';

            html += `<td class="${isCurrent ? 'month-current' : ''}" data-member-cell="${member.member_id}-${m}" data-member-id="${member.member_id}" data-month="${m}" data-details="${detailsJson}">`;
            if (load > 0) {
                html += `<div class="member-cell-inner">`;
                html += `<span class="load-cell ${cls}">${load}%</span>`;
                html += barHtml;
                html += `</div>`;
            }
            html += `</td>`;
        });
        html += '</tr>';

        // Theme Rows (Hidden by default)
        Object.keys(memberThemes).forEach(themeId => {
            const tid = parseInt(themeId);
            const theme = allThemes.find(t => t.theme_id === tid);
            const themeName = theme ? theme.name : `Theme ${tid}`;
            const themeColor = theme ? theme.color : '#888';
            const themeLoads = memberThemes[tid];

            html += `<tr class="theme-row hidden" data-parent="${member.member_id}">`;
            html += `<td>
                <div class="theme-row-content">
                    <span class="card-color-dot" style="background:${themeColor};width:8px;height:8px"></span>
                    ${themeName}
                </div>
            </td>`;

            months.forEach(m => {
                const val = aggregateRate(themeLoads, m, scale);
                const isCurrent = m === cur;
                // For individual theme rows, we color based on constant 100% scale or member capacity?
                // Using member capacity for consistency with the parent row's percentage calculation.
                const cls = getLoadClass(val, member.capacity, false); 

                html += `<td class="member-theme-cell ${isCurrent ? 'month-current' : ''}" 
                            data-member="${member.member_id}" 
                            data-theme="${tid}" 
                            data-month="${m}"
                            data-rate="${val}">`;

                if (val > 0) {
                    html += `<div class="theme-cell-inner">`;
                    html += `<span class="theme-row-load ${cls}">${val}%</span>`;
                    html += `<div class="theme-cell-bar" style="width:${Math.min(val, 100)}%;background:${themeColor}"></div>`;
                    html += `</div>`;
                }
                html += `</td>`;
            });
            html += '</tr>';
        });
    });

    tbody.innerHTML = html;

    // Toggle handlers
    tbody.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const memberId = btn.dataset.toggle;
            const isExpanded = btn.classList.contains('expanded');
            btn.classList.toggle('expanded');
            btn.textContent = isExpanded ? '▶' : '▼';
            tbody.querySelectorAll(`tr[data-parent="${memberId}"]`).forEach(row => {
                row.classList.toggle('hidden');
            });
        });
    });

    // Hover popup on member summary cells (stacked bar)
    tbody.querySelectorAll('td[data-member-cell]').forEach(td => {
        td.addEventListener('mouseenter', (e) => {
            const encoded = td.dataset.details;
            if (!encoded) return;
            let details;
            try { details = JSON.parse(decodeURIComponent(encoded)); } catch { return; }
            if (!details || details.length === 0) return;
            const memberId = parseInt(td.dataset.memberId);
            const month = td.dataset.month;
            const member = allMembers.find(m => m.member_id === memberId);
            if (!member) return;
            showDetailPopup(e, member, month, details);
        });
        td.addEventListener('mouseleave', () => {
            // Popup auto-closes on outside click; mouseleave closes immediately for clean UX
            document.querySelectorAll('.member-detail-popup').forEach(el => el.remove());
        });
    });

    // Cell click handlers for editor
    tbody.querySelectorAll('.member-theme-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            const themeId = parseInt(cell.dataset.theme);
            const memberId = parseInt(cell.dataset.member);
            const month = cell.dataset.month;
            const currentRate = parseInt(cell.dataset.rate) || 0;

            if (scale === 1) { // Only allow editing in 1M scale for clarity
                openCellEditor(cell, themeId, memberId, month, currentRate, (newRate) => {
                    handleCellEdit(cell, newRate, themeId, memberId, month);
                }, (dir, changed, newRate) => {
                    handleCellNavigation(cell, dir, changed, newRate, themeId, memberId, month);
                });
            }
        });
    });
}

function handleCellEdit(cell, newRate, themeId, memberId, month) {
    // 1. Update Cell DOM
    cell.dataset.rate = newRate;
    cell.innerHTML = newRate > 0 ? `<span class="theme-row-load">${newRate}%</span>` : '';

    // 2. Update Local Data (lastAllocations)
    let alloc = lastAllocations.find(a => a.member_id === memberId && a.theme_id === themeId && a.month === month);
    if (alloc) {
        alloc.allocation_rate = newRate;
    } else {
        lastAllocations.push({
            member_id: memberId,
            theme_id: themeId,
            month: month,
            allocation_rate: newRate
        });
    }

    // 3. Recalculate member total for this month
    updateMemberTotalCell(memberId, month);
}

function handleCellNavigation(currentCell, direction, changed, newRate, themeId, memberId, month) {
    if (changed) {
        // Optimistic update if value changed before navigation
        handleCellEdit(currentCell, newRate, themeId, memberId, month);

        // Background save is handled by openCellEditor's internal logic which calls API, 
        // but handleCellEdit updates local state.
        // NOTE: `openCellEditor` calls `onSave` (which is `handleCellEdit` here) AND does the API call.
        // So we don't need to call API here again. 
    }

    // Move Focus
    const next = calculateNextFocus(currentCell, direction);
    if (next) {
        const selector = `.member-theme-cell[data-theme="${next.themeId}"][data-member="${next.memberId}"][data-month="${next.month}"]`;
        const tbody = document.getElementById('member-load-tbody');
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
        const prevTd = currentCell.previousElementSibling;
        if (prevTd && prevTd.classList.contains('member-theme-cell')) {
            return extractCellData(prevTd);
        }
    }
    else if (direction === 'ArrowRight') {
        const nextTd = currentCell.nextElementSibling;
        if (nextTd && nextTd.classList.contains('member-theme-cell')) {
            return extractCellData(nextTd);
        }
    }
    else if (direction === 'ArrowUp') {
        // Move to previous theme row (same member or previous member)
        let prevRow = row.previousElementSibling;
        while (prevRow) { // Skip member summary rows?
            // Member rows are `member-row`, Theme rows are `theme-row`.
            // We want to skip `member-row` because they are not editable in this context (they are summaries).
            // But if we hit a member row, we should look before it for the last theme row of the previous member?
            // `row.previousElementSibling` works linearly.

            if (prevRow.classList.contains('theme-row') && !prevRow.classList.contains('hidden')) {
                const cellIndex = currentCell.cellIndex; // Index matches because tables align?
                // `member-row` has 1 th + months. `theme-row` has 1 td + months.
                // But `theme-row` first td is name. `member-row` first td is name.
                // Indices should match 1:1 for month columns.
                const target = prevRow.children[cellIndex];
                if (target && target.classList.contains('member-theme-cell')) {
                    return extractCellData(target);
                }
                break;
            }
            if (prevRow.classList.contains('member-row')) {
                // If we hit a member row header, keep going up to find the previous member's last theme?
                // Yes, continue loop.
            }
            prevRow = prevRow.previousElementSibling;
        }
    }
    else if (direction === 'ArrowDown') {
        let nextRow = row.nextElementSibling;
        while (nextRow) {
            if (nextRow.classList.contains('theme-row') && !nextRow.classList.contains('hidden')) {
                const cellIndex = currentCell.cellIndex;
                const target = nextRow.children[cellIndex];
                if (target && target.classList.contains('member-theme-cell')) {
                    return extractCellData(target);
                }
                break;
            }
            nextRow = nextRow.nextElementSibling;
        }
    }
    return null;
}

function extractCellData(cell) {
    return {
        themeId: parseInt(cell.dataset.theme),
        memberId: parseInt(cell.dataset.member),
        month: cell.dataset.month
    };
}

function updateMemberTotalCell(memberId, month) {
    // Recalculate total for this member/month from lastAllocations
    const total = lastAllocations
        .filter(a => a.member_id === memberId && a.month === month)
        .reduce((sum, a) => sum + a.allocation_rate, 0);

    // Find the cell
    const cell = document.querySelector(`td[data-member-cell="${memberId}-${month}"]`);
    if (cell) {
        // Find capacity
        const member = allMembers.find(m => m.member_id === memberId);
        const capacity = member ? member.capacity : 100;

        const cls = getLoadClass(total, capacity, total > capacity);

        if (total > 0) {
            // Rebuild memberThemeLoads for this member from lastAllocations
            const memberThemes = {};
            lastAllocations
                .filter(a => a.member_id === memberId)
                .forEach(a => {
                    if (!memberThemes[a.theme_id]) memberThemes[a.theme_id] = {};
                    memberThemes[a.theme_id][a.month] = a.allocation_rate;
                });
            const { barHtml, details } = buildStackedBar(memberId, month, memberThemes, capacity);
            const detailsJson = details.length > 0 ? encodeURIComponent(JSON.stringify(details)) : '';
            cell.dataset.details = detailsJson;
            cell.innerHTML = `<div class="member-cell-inner"><span class="load-cell ${cls}">${total}%</span>${barHtml}</div>`;
        } else {
            cell.dataset.details = '';
            cell.innerHTML = '';
        }
    }
}

function getLoadClass(load, capacity, isOver) {
    if (isOver || load > capacity) return 'load-over';
    if (load === 0) return 'load-none';
    if (load <= 30) return 'load-low';
    if (load <= 60) return 'load-mid';
    if (load < 100) return 'load-high';
    return 'load-full';
}

function showDetailPopup(e, member, month, details) {
    // Remove existing popup
    document.querySelectorAll('.member-detail-popup').forEach(el => el.remove());

    const total = details.reduce((sum, d) => sum + d.rate, 0);
    const isOver = total > member.capacity;

    let html = `<h4>${member.display_name} — ${shortenMonth(month)}</h4>`;
    details.forEach(d => {
        html += `<div class="detail-row">
            <span class="theme-name">
                <span class="card-color-dot" style="background:${d.color}"></span>
                ${d.theme_name}
            </span>
            <span class="rate">${d.rate}%</span>
        </div>`;
    });
    html += `<div class="detail-total ${isOver ? 'over' : ''}">
        <span>合計</span>
        <span>${total}%${isOver ? ` (+${total - member.capacity}% 超過)` : ''}</span>
    </div>`;

    const popup = document.createElement('div');
    popup.className = 'member-detail-popup';
    popup.innerHTML = html;
    popup.style.left = `${e.clientX + 12}px`;
    popup.style.top = `${e.clientY}px`;
    document.body.appendChild(popup);

    // Adjust if off-screen
    const rect = popup.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        popup.style.left = `${e.clientX - rect.width - 12}px`;
    }
    if (rect.bottom > window.innerHeight) {
        popup.style.top = `${e.clientY - rect.height}px`;
    }

    // Close on outside click
    setTimeout(() => {
        const close = (ev) => {
            if (!popup.contains(ev.target)) {
                popup.remove();
                document.removeEventListener('mousedown', close);
            }
        };
        document.addEventListener('mousedown', close);
    }, 50);
}
