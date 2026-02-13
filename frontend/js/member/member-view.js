/**
 * Member Load View
 * Displays member monthly load with overload warnings and detail popups.
 */

import { allocations, members as membersApi, themes as themesApi } from '../api.js';
import {
    currentMonth, getVisibleMonths, formatMonthHeader, addMonths, aggregateRate
} from '../utils/date-utils.js';

let allMembers = [];
let allThemes = [];
let startMonth = addMonths(currentMonth(), -1);
let visibleCount = 14;
let scale = 1;

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

        const [memberLoads, warns, allAllocs] = await Promise.all([
            allocations.memberLoads(from, toEnd),
            allocations.warnings(from, toEnd),
            allocations.list({ from, to: toEnd }),
        ]);

        render(months, memberLoads, warns, allAllocs);
    } catch (err) {
        console.error('Failed to load member view:', err);
    }
}

function setupControls() {
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

    // Build detail data: member -> month -> [{theme_name, color, rate}]
    const detailMap = {};
    allAllocs.forEach(a => {
        const key = `${a.member_id}-${a.month}`;
        if (!detailMap[key]) detailMap[key] = [];
        const theme = allThemes.find(t => t.theme_id === a.theme_id);
        detailMap[key].push({
            theme_name: theme ? theme.name : `Theme ${a.theme_id}`,
            color: theme ? theme.color : '#888',
            rate: a.allocation_rate,
        });
    });

    let html = '';
    allMembers.forEach(member => {
        const loads = memberLoads[member.member_id] || {};
        html += '<tr>';
        html += `<td>${member.display_name} <span class="member-capacity">(${member.capacity}%)</span></td>`;

        months.forEach(m => {
            const load = aggregateRate(loads, m, scale);
            const isCurrent = m === cur;
            const isOver = warnSet.has(`${member.member_id}-${m}`);
            const cls = getLoadClass(load, member.capacity, isOver);

            html += `<td class="${isCurrent ? 'month-current' : ''}" data-member="${member.member_id}" data-month="${m}">`;
            if (load > 0) {
                html += `<span class="load-cell ${cls}">${load}%</span>`;
            }
            html += `</td>`;
        });
        html += '</tr>';
    });

    tbody.innerHTML = html;

    // Click for detail popup
    tbody.querySelectorAll('td[data-member]').forEach(td => {
        td.addEventListener('click', (e) => {
            const memberId = parseInt(td.dataset.member);
            const month = td.dataset.month;
            const member = allMembers.find(m => m.member_id === memberId);
            const key = `${memberId}-${month}`;
            const details = detailMap[key] || [];
            if (details.length > 0) {
                showDetailPopup(e, member, month, details);
            }
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

    let html = `<h4>${member.display_name} — ${month}</h4>`;
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
