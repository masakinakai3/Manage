/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Member Load View
 * Displays member monthly load with overload warnings and detail popups.
 */

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

function exportCSV() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);

    // Header
    const headers = ['メンバー', '所属', 'テーマ', 'カテゴリ', 'ステータス', ...months];
    let csvContent = '\uFEFF' + headers.join(',') + '\n';

    // Detailed Data
    // We need to re-fetch or reconstruct the detailed allocation data map
    // Since we don't store the raw map globally, we'll rebuild it from current global data
    // Ideally we should have stored it in refreshMemberView but rebuilding is cheap enough here.

    // Re-fetch all allocations for current range? 
    // Wait, refreshMemberView has local scopes.
    // Let's make a simplified attempt: iterate all members and all themes,
    // fetch allocation if it exists from a global store? 
    // We don't have a reliable global store for allocations yet.
    // Let's modify refreshMemberView to store the latest data in a module-level variable.
    // OR just re-fetch here if it was fast enough? 
    // Actually, let's create a hidden global var or attach to window for simplicity? 
    // No, let's use a module level variable `lastAllocations` similar to `allMembers`.
}

// ... (existing code)

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

            html += `<td class="${isCurrent ? 'month-current' : ''}">`;
            if (load > 0) {
                html += `<span class="load-cell ${cls}">${load}%</span>`;
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
                // For theme rows, we don't aggregate if scale > 1 for now, or we just take the month's value
                // Assuming scale=1 for simplicity in detail view, or simple lookup
                const val = themeLoads[m] || 0;
                const isCurrent = m === cur;
                html += `<td class="${isCurrent ? 'month-current' : ''}">`;
                if (val > 0) {
                    html += `<span class="theme-row-load">${val}%</span>`;
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

            // Toggle button state
            btn.classList.toggle('expanded');
            btn.textContent = isExpanded ? '▶' : '▼'; // Optional: if using CSS rotation, text might not change or use unicode

            // Toggle rows
            tbody.querySelectorAll(`tr[data-parent="${memberId}"]`).forEach(row => {
                row.classList.toggle('hidden');
            });
        });
    });
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
