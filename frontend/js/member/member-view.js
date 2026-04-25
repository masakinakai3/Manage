/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

import { openCellEditor } from '../gantt/gantt-editor.js';
import { allocations, members as membersApi, themes as themesApi } from '../api.js';
import { currentMonth, getVisibleMonths, formatMonthHeader, addMonths, aggregateRate, shortenMonth } from '../utils/date-utils.js';
import { getPresetConfig, loadViewState, subscribeViewState, updateViewState } from '../shared-state.js';
import { formatError, setBusyState, setSaveState, showToast } from '../ui.js';

let allMembers = [];
let allThemes = [];
let lastAllocations = [];
let startMonth = addMonths(currentMonth(), -1);
let visibleCount = 14;
let scale = 1;
let memberSearchQuery = '';
let selectedMonth = null;
const MEMBER_MONTH_COLUMN_WIDTH = 88;

export async function initMemberView() {
    const state = loadViewState();
    startMonth = state.startMonth;
    scale = state.scale;
    memberSearchQuery = state.memberSearch || '';

    setupControls();
    subscribeViewState((nextState) => {
        startMonth = nextState.startMonth;
        scale = nextState.scale;
        memberSearchQuery = nextState.memberSearch || '';

        const searchInput = document.getElementById('member-search');
        if (searchInput && searchInput.value !== memberSearchQuery) {
            searchInput.value = memberSearchQuery;
        }

        const presetInput = document.getElementById('member-period-preset');
        if (presetInput) presetInput.value = nextState.preset;

        syncScaleButtons();
        refreshMemberView();
    });

    await refreshMemberView();
}

export async function refreshMemberView() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const from = months[0];
    const to = months[months.length - 1];
    const toEnd = scale > 1 ? addMonths(to, scale - 1) : to;

    try {
        setBusyState(true, 'メンバー負荷を読み込んでいます...');
        [allMembers, allThemes] = await Promise.all([membersApi.list(), themesApi.list()]);

        const [memberLoads, warnings, allocationsList] = await Promise.all([
            allocations.memberLoads(from, toEnd),
            allocations.warnings(from, toEnd),
            allocations.list({ from, to: toEnd }),
        ]);

        lastAllocations = allocationsList;
        renderSummary(memberLoads, warnings);
        renderTable(months, memberLoads, warnings, allocationsList);
    } catch (error) {
        console.error('Failed to load member view:', error);
        setSaveState('error', 'メンバー負荷の読み込みに失敗しました');
        showToast(`メンバー負荷の読み込みに失敗しました: ${formatError(error)}`, 'error');
    } finally {
        setBusyState(false);
    }
}

function setupControls() {
    const switcher = document.getElementById('member-scale-switcher');
    if (switcher && !document.getElementById('member-export-csv')) {
        const container = document.createElement('div');
        container.className = 'member-toolbar-actions';
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.marginRight = '16px';
        container.innerHTML = `
            <button class="btn btn-ghost btn-sm" id="member-export-csv" type="button">CSV 出力</button>
        `;
        switcher.parentNode.insertBefore(container, switcher);
    }

    document.getElementById('member-export-csv')?.addEventListener('click', exportCSV);

    document.querySelectorAll('#member-scale-switcher .scale-btn').forEach((button) => {
        button.addEventListener('click', () => {
            scale = Number.parseInt(button.dataset.scale, 10);
            updateViewState({ scale });
        });
    });

    const searchInput = document.getElementById('member-search');
    if (searchInput) {
        searchInput.value = memberSearchQuery;
        searchInput.addEventListener('input', (event) => {
            memberSearchQuery = event.target.value.trim().toLowerCase();
            updateViewState({ memberSearch: memberSearchQuery });
        });
    }

    document.getElementById('member-prev').addEventListener('click', () => {
        startMonth = addMonths(startMonth, -scale * 3);
        updateViewState({ startMonth });
    });

    document.getElementById('member-next').addEventListener('click', () => {
        startMonth = addMonths(startMonth, scale * 3);
        updateViewState({ startMonth });
    });

    document.getElementById('member-today').addEventListener('click', () => {
        const preset = document.getElementById('member-period-preset').value || 'rolling-6';
        const config = getPresetConfig(preset);
        startMonth = config.startMonth;
        scale = config.scale;
        updateViewState({ startMonth, scale, preset });
    });
}

function syncScaleButtons() {
    document.querySelectorAll('#member-scale-switcher .scale-btn').forEach((button) => {
        button.classList.toggle('active', Number.parseInt(button.dataset.scale, 10) === scale);
    });
}

function renderSummary(memberLoads, warnings) {
    const summary = document.getElementById('member-load-summary');
    if (!summary) return;

    {
        const summaryMembersWithData = allMembers.length;
        let summaryOverloadedMembers = 0;
        let summaryAverageLoad = 0;

        allMembers.forEach((member) => {
            const loads = Object.values(memberLoads[member.member_id] || {});
            const maxLoad = loads.length ? Math.max(...loads) : 0;
            const avg = loads.length ? Math.round(loads.reduce((sum, value) => sum + value, 0) / loads.length) : 0;
            summaryAverageLoad += avg;

            if (maxLoad > member.capacity) summaryOverloadedMembers += 1;
        });

        const avgLoadDisplay = summaryMembersWithData > 0 ? Math.round(summaryAverageLoad / summaryMembersWithData) : 0;

        summary.innerHTML = `
            <article class="summary-card member-load-summary-card">
                <div class="member-load-summary-main">
                    <div class="summary-label">平均負荷</div>
                    <div class="summary-value">${avgLoadDisplay}%</div>
                </div>
                <div class="summary-subtext member-load-summary-meta">全メンバーの月平均</div>
            </article>
            <article class="summary-card member-load-summary-card">
                <div class="member-load-summary-main">
                    <div class="summary-label">過負荷メンバー</div>
                    <div class="summary-value">${summaryOverloadedMembers}</div>
                </div>
                <div class="summary-subtext member-load-summary-meta">警告セル ${warnings.length} 件</div>
            </article>
        `;
        return;

        summary.innerHTML = `
            <article class="summary-card">
                <div class="summary-label">平均負荷</div>
                <div class="summary-value">${avgLoadDisplay}%</div>
                <div class="summary-subtext">全メンバーの月平均</div>
            </article>
            <article class="summary-card">
                <div class="summary-label">過負荷メンバー</div>
                <div class="summary-value">${summaryOverloadedMembers}</div>
                <div class="summary-subtext">警告セル ${warnings.length} 件</div>
            </article>
        `;
        return;
    }

    const membersWithData = allMembers.length;
    let overloadedMembers = 0;
    let slackMembers = 0;
    let unassignedMembers = 0;
    let averageLoad = 0;

    allMembers.forEach((member) => {
        const loads = Object.values(memberLoads[member.member_id] || {});
        const maxLoad = loads.length ? Math.max(...loads) : 0;
        const avg = loads.length ? Math.round(loads.reduce((sum, value) => sum + value, 0) / loads.length) : 0;
        averageLoad += avg;

        if (maxLoad > member.capacity) overloadedMembers += 1;
        if (maxLoad === 0) {
            unassignedMembers += 1;
        } else if (maxLoad < Math.max(30, Math.round(member.capacity * 0.5))) {
            slackMembers += 1;
        }
    });

    const avgLoadDisplay = membersWithData > 0 ? Math.round(averageLoad / membersWithData) : 0;

    summary.innerHTML = `
        <article class="summary-card">
            <div class="summary-label">平均負荷</div>
            <div class="summary-value">${avgLoadDisplay}%</div>
            <div class="summary-subtext">全メンバーの月平均</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">過負荷メンバー</div>
            <div class="summary-value">${overloadedMembers}</div>
            <div class="summary-subtext">警告セル ${warnings.length} 件</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">余力あり</div>
            <div class="summary-value">${slackMembers}</div>
            <div class="summary-subtext">上限の 50% 未満</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">未割当</div>
            <div class="summary-value">${unassignedMembers}</div>
            <div class="summary-subtext">全期間で配分なし</div>
        </article>
    `;
}

function renderTable(months, memberLoads, warnings, allocationsList) {
    renderHeader(months);

    const tbody = document.getElementById('member-load-tbody');
    const current = currentMonth();
    const warningSet = new Set(warnings.map((warning) => `${warning.member_id}-${warning.month}`));
    const memberThemeLoads = buildMemberThemeLoads(allocationsList);

    const filteredMembers = allMembers.filter((member) => matchesMemberSearch(member, memberThemeLoads[member.member_id] || {}));

    let html = '';
    filteredMembers.forEach((member) => {
        const loads = memberLoads[member.member_id] || {};
        const memberThemes = memberThemeLoads[member.member_id] || {};
        const themeIds = Object.keys(memberThemes).map((id) => Number.parseInt(id, 10));
        const hasThemes = themeIds.length > 0;

        html += `<tr class="member-row" data-member-row="${member.member_id}">`;
        html += `<td><div class="member-row-header">`;
        html += hasThemes ? `<div class="toggle-btn" data-toggle="${member.member_id}">▶</div>` : '<div style="width:20px"></div>';
        html += `<div>${member.display_name} <span class="member-capacity">(${member.capacity}% / ${member.department || '部署未設定'})</span></div>`;
        html += `</div></td>`;

        months.forEach((month) => {
            const load = aggregateRate(loads, month, scale);
            const isOver = warningSet.has(`${member.member_id}-${month}`);
            const className = getLoadClass(load, member.capacity, isOver);
            const { barHtml, details } = buildStackedBar(month, memberThemes, member.capacity);
            const detailsJson = details.length > 0 ? encodeURIComponent(JSON.stringify(details)) : '';

            html += `<td class="${month === current ? 'month-current' : ''}" data-member-month="${month}" data-member-cell="${member.member_id}-${month}" data-member-id="${member.member_id}" data-month="${month}" data-details="${detailsJson}">`;
            if (load > 0) {
                html += `<div class="member-cell-inner"><span class="load-cell ${className}">${load}%</span>${barHtml}</div>`;
            }
            html += `</td>`;
        });

        html += '</tr>';

        themeIds.forEach((themeId) => {
            const theme = allThemes.find((item) => item.theme_id === themeId);
            const themeName = theme ? theme.name : `Theme ${themeId}`;
            const themeColor = theme ? theme.color : '#888888';
            const themeLoads = memberThemes[themeId];

            html += `<tr class="theme-row hidden" data-parent="${member.member_id}">`;
            html += `<td><div class="theme-row-content"><span class="card-color-dot" style="background:${themeColor};width:8px;height:8px"></span>${themeName}</div></td>`;

            months.forEach((month) => {
                const rate = aggregateRate(themeLoads, month, scale);
                html += `<td class="member-theme-cell ${month === current ? 'month-current' : ''}" data-member-month="${month}" data-member="${member.member_id}" data-theme="${themeId}" data-month="${month}" data-rate="${rate}">`;
                html += renderMemberThemeCellContent(theme, member, month, rate);
                html += `</td>`;
            });

            html += `</tr>`;
        });
    });

    tbody.innerHTML = html || `<tr><td colspan="${months.length + 1}" class="summary-subtext">条件に一致するメンバーがありません。</td></tr>`;

    bindTableInteractions(tbody);
    syncSelectedMonthStyles();
}

function renderHeader(months) {
    const thead = document.getElementById('member-load-thead');
    const current = currentMonth();
    let html = `<tr><th>
        <div class="member-header-actions">
            <span>メンバー</span>
            <span class="member-header-buttons">
                <button class="btn btn-ghost btn-sm" id="member-expand-all" type="button">すべて展開</button>
                <button class="btn btn-ghost btn-sm" id="member-collapse-all" type="button">すべて折りたたみ</button>
            </span>
        </div>
    </th>`;
    months.forEach((month) => {
        const label = formatMonthHeader(month, scale);
        html += `<th class="${month === current ? 'month-current' : ''}" data-member-month="${month}" style="width:${MEMBER_MONTH_COLUMN_WIDTH}px;min-width:${MEMBER_MONTH_COLUMN_WIDTH}px;max-width:${MEMBER_MONTH_COLUMN_WIDTH}px;">${label.replace('\n', '<br>')}</th>`;
    });
    html += '</tr>';
    thead.innerHTML = html;
    bindHeaderActions();
}

function bindHeaderActions() {
    document.getElementById('member-expand-all')?.addEventListener('click', (event) => {
        event.stopPropagation();
        document.querySelectorAll('.theme-row').forEach((row) => row.classList.remove('hidden'));
        document.querySelectorAll('.toggle-btn').forEach((button) => {
            button.classList.add('expanded');
            button.textContent = '▼';
        });
    });

    document.getElementById('member-collapse-all')?.addEventListener('click', (event) => {
        event.stopPropagation();
        document.querySelectorAll('.theme-row').forEach((row) => row.classList.add('hidden'));
        document.querySelectorAll('.toggle-btn').forEach((button) => {
            button.classList.remove('expanded');
            button.textContent = '▶';
        });
    });
}

function buildMemberThemeLoads(allocationsList) {
    const memberThemeLoads = {};
    allocationsList.forEach((allocation) => {
        if (!memberThemeLoads[allocation.member_id]) memberThemeLoads[allocation.member_id] = {};
        if (!memberThemeLoads[allocation.member_id][allocation.theme_id]) memberThemeLoads[allocation.member_id][allocation.theme_id] = {};
        memberThemeLoads[allocation.member_id][allocation.theme_id][allocation.month] = allocation.allocation_rate;
    });
    return memberThemeLoads;
}

function matchesMemberSearch(member, memberThemes) {
    if (!memberSearchQuery) return true;

    const themeNames = Object.keys(memberThemes)
        .map((themeId) => allThemes.find((theme) => theme.theme_id === Number.parseInt(themeId, 10))?.name || '')
        .join(' ');

    return [member.display_name, member.department || '', themeNames]
        .some((value) => value.toLowerCase().includes(memberSearchQuery));
}

function buildStackedBar(month, memberThemes, capacity) {
    const details = [];

    Object.keys(memberThemes).forEach((themeId) => {
        const parsedThemeId = Number.parseInt(themeId, 10);
        const rate = aggregateRate(memberThemes[parsedThemeId], month, scale);
        if (rate <= 0) return;

        const theme = allThemes.find((item) => item.theme_id === parsedThemeId);
        details.push({
            theme_name: theme ? theme.name : `Theme ${parsedThemeId}`,
            color: theme ? theme.color : '#888888',
            rate,
        });
    });

    if (details.length === 0) return { barHtml: '', details: [] };

    const total = details.reduce((sum, detail) => sum + detail.rate, 0);
    const barBase = Math.max(total, capacity, 100);
    const markerPct = (capacity / barBase) * 100;
    const overflowClass = total > capacity ? ' stacked-bar--over' : '';
    const segments = details.map((detail) => {
        const widthPct = (detail.rate / barBase) * 100;
        return `<span class="stacked-bar-segment" style="width:${widthPct.toFixed(2)}%;background:${detail.color}" title="${detail.theme_name}: ${detail.rate}%"></span>`;
    }).join('');

    return {
        barHtml: `<div class="stacked-bar${overflowClass}">${segments}<span class="stacked-bar-capacity" style="left:${markerPct.toFixed(2)}%" title="上限 ${capacity}%"></span></div>`,
        details,
    };
}

function bindTableInteractions(tbody) {
    document.querySelectorAll('[data-member-month]').forEach((element) => {
        element.addEventListener('click', () => {
            const month = element.dataset.memberMonth || null;
            setSelectedMonth(selectedMonth === month ? null : month);
        });
    });

    tbody.querySelectorAll('.toggle-btn').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const memberId = button.dataset.toggle;
            const expanded = button.classList.toggle('expanded');
            button.textContent = expanded ? '▼' : '▶';
            tbody.querySelectorAll(`tr[data-parent="${memberId}"]`).forEach((row) => row.classList.toggle('hidden'));
        });
    });

    tbody.querySelectorAll('td[data-member-cell]').forEach((cell) => {
        cell.addEventListener('mouseenter', (event) => {
            const encoded = cell.dataset.details;
            if (!encoded) return;

            let details;
            try {
                details = JSON.parse(decodeURIComponent(encoded));
            } catch {
                return;
            }

            if (!details || details.length === 0) return;
            const member = allMembers.find((item) => item.member_id === Number.parseInt(cell.dataset.memberId, 10));
            if (!member) return;
            showDetailPopup(event, member, cell.dataset.month, details);
        });

        cell.addEventListener('mouseleave', () => {
            document.querySelectorAll('.member-detail-popup').forEach((popup) => popup.remove());
        });
    });

    tbody.querySelectorAll('.member-theme-cell').forEach((cell) => {
        cell.addEventListener('click', () => {
            if (scale !== 1) return;

            const themeId = Number.parseInt(cell.dataset.theme, 10);
            const memberId = Number.parseInt(cell.dataset.member, 10);
            const month = cell.dataset.month;
            const currentRate = Number.parseInt(cell.dataset.rate || '0', 10);

            openCellEditor(cell, themeId, memberId, month, currentRate, (newRate = 0) => {
                updateThemeCell(cell, memberId, themeId, month, newRate);
            }, (direction, changed, newRate) => {
                if (changed) {
                    updateThemeCell(cell, memberId, themeId, month, newRate);
                }
                moveEditorFocus(cell, direction);
            });
        });
    });
}

function setSelectedMonth(month) {
    selectedMonth = month || null;
    syncSelectedMonthStyles();
}

function syncSelectedMonthStyles() {
    document.querySelectorAll('[data-member-month]').forEach((element) => {
        element.classList.toggle('month-selected', Boolean(selectedMonth) && element.dataset.memberMonth === selectedMonth);
    });
}

function updateThemeCell(cell, memberId, themeId, month, newRate) {
    const rate = Number.parseInt(String(newRate || 0), 10);
    cell.dataset.rate = String(rate);
    const theme = allThemes.find((item) => item.theme_id === themeId);
    const member = allMembers.find((item) => item.member_id === memberId);

    cell.innerHTML = renderMemberThemeCellContent(theme, member, month, rate);

    const allocation = lastAllocations.find((item) => item.member_id === memberId && item.theme_id === themeId && item.month === month);
    if (allocation) {
        allocation.allocation_rate = rate;
    } else {
        lastAllocations.push({ member_id: memberId, theme_id: themeId, month, allocation_rate: rate });
    }

    updateMemberSummaryCell(memberId, month);
}

function updateMemberSummaryCell(memberId, month) {
    const member = allMembers.find((item) => item.member_id === memberId);
    const cell = document.querySelector(`td[data-member-cell="${memberId}-${month}"]`);
    if (!member || !cell) return;

    const memberThemes = buildMemberThemeLoads(lastAllocations)[memberId] || {};
    const total = Object.keys(memberThemes).reduce((sum, themeId) => {
        return sum + aggregateRate(memberThemes[Number.parseInt(themeId, 10)], month, 1);
    }, 0);
    const className = getLoadClass(total, member.capacity, total > member.capacity);
    const { barHtml, details } = buildStackedBar(month, memberThemes, member.capacity);

    cell.dataset.details = details.length > 0 ? encodeURIComponent(JSON.stringify(details)) : '';
    cell.innerHTML = total > 0
        ? `<div class="member-cell-inner"><span class="load-cell ${className}">${total}%</span>${barHtml}</div>`
        : '';
}

function moveEditorFocus(currentCell, direction) {
    if (!direction) return;

    const row = currentCell.closest('tr');
    if (!row) return;

    if (direction === 'ArrowLeft') {
        const previous = currentCell.previousElementSibling;
        if (previous?.classList.contains('member-theme-cell')) previous.click();
        return;
    }

    if (direction === 'ArrowRight') {
        const next = currentCell.nextElementSibling;
        if (next?.classList.contains('member-theme-cell')) next.click();
        return;
    }

    let cursor = direction === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
    while (cursor) {
        if (cursor.classList.contains('theme-row') && !cursor.classList.contains('hidden')) {
            const target = cursor.children[currentCell.cellIndex];
            if (target?.classList.contains('member-theme-cell')) {
                target.click();
                return;
            }
        }
        cursor = direction === 'ArrowUp' ? cursor.previousElementSibling : cursor.nextElementSibling;
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

function renderMemberThemeCellContent(theme, member, month, rate) {
    const themeColor = theme?.color || '#888888';
    const className = getLoadClass(rate, member?.capacity || 100, false);
    const milestones = milestoneBadges(theme, month);
    const devCompleteMarkup = devCompleteBadge(theme, month, rate);
    const hasRate = rate > 0;

    if (!hasRate && !milestones && !devCompleteMarkup) return '';

    const rateMarkup = hasRate
        ? `<span class="theme-row-load ${className}">${rate}%</span><div class="theme-cell-bar" style="width:${Math.min(rate, 100)}%;background:${themeColor}"></div>`
        : '<span class="theme-row-load theme-row-load-empty"></span>';

    return `<div class="theme-cell-inner">${devCompleteMarkup}${rateMarkup}${milestones}</div>`;
}

function monthBucketIncludes(targetMonth, periodStart, step) {
    if (!targetMonth || !periodStart) return false;
    if (step <= 1) return targetMonth === periodStart;

    const periodEnd = addMonths(periodStart, step - 1);
    return targetMonth >= periodStart && targetMonth <= periodEnd;
}

function getThemeMilestones(theme) {
    if (Array.isArray(theme?.milestones) && theme.milestones.length > 0) return theme.milestones;
    if (theme?.milestone_month) {
        return [{ month: theme.milestone_month, label: theme.milestone_label || 'Milestone' }];
    }
    return [];
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
        .filter((item, index, list) => list.findIndex((candidate) => candidate.month === item.month) === index);
}

function milestoneBadges(theme, month) {
    const matches = getThemeMilestones(theme)
        .filter((item) => monthBucketIncludes(item.month, month, scale));
    if (matches.length === 0) return '';

    const [first, ...rest] = matches;
    const firstLabel = escapeHtml(first.label || 'Milestone');
    const firstCompletedClass = first.is_completed ? ' completed' : '';
    const tooltip = escapeHtml(matches
        .map((item) => `${item.is_completed ? '完了: ' : ''}${item.label || 'Milestone'}`)
        .join('\n'));
    const extraCount = rest.length > 0
        ? `<span class="member-theme-milestone member-theme-milestone-count" title="${tooltip}">+${rest.length}</span>`
        : '';

    return `<div class="member-theme-milestones" title="${tooltip}"><span class="member-theme-milestone${firstCompletedClass}" title="${tooltip}">${firstLabel}</span>${extraCount}</div>`;
}

function devCompleteBadge(theme, month, rate) {
    const item = getThemeDevCompleteItems(theme).find((candidate) => monthBucketIncludes(candidate.month, month, scale));
    if (!item) return '';
    const label = rate > 0 ? `★${rate}%` : '★';
    return `<span class="member-theme-dev-complete${item.is_completed ? ' completed' : ''}" title="開発完了月">${label}</span>`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

async function exportCSV() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const headers = ['メンバー', '部署', 'テーマ', 'カテゴリ', 'ステータス', ...months.map((month) => formatMonthHeader(month, scale).replace('\n', ' '))];
    const memberThemeLoads = buildMemberThemeLoads(lastAllocations);

    let csvContent = `${headers.join(',')}\n`;

    allMembers.forEach((member) => {
        const themes = memberThemeLoads[member.member_id] || {};
        const themeIds = Object.keys(themes).map((id) => Number.parseInt(id, 10));

        if (themeIds.length === 0) {
            csvContent += [member.display_name, member.department || '', '', '', '', ...months.map(() => '')].join(',') + '\n';
            return;
        }

        themeIds.forEach((themeId) => {
            const theme = allThemes.find((item) => item.theme_id === themeId);
            csvContent += [
                member.display_name,
                member.department || '',
                theme?.name || `Theme ${themeId}`,
                theme?.category || '',
                theme?.status || '',
                ...months.map((month) => themes[themeId][month] || ''),
            ].join(',') + '\n';
        });
    });

    const filename = `member_load_${months[0]}_${months[months.length - 1]}.csv`;

    try {
        setBusyState(true, 'CSV を出力しています...');
        const response = await fetch('/api/export/csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: csvContent, filename }),
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(url);

        setSaveState('saved', 'メンバー負荷を CSV 出力しました');
        showToast('メンバー負荷を CSV 出力しました。', 'success');
    } catch (error) {
        setSaveState('error', 'CSV 出力に失敗しました');
        showToast(`CSV 出力に失敗しました: ${formatError(error)}`, 'error');
    } finally {
        setBusyState(false);
    }
}

function showDetailPopup(event, member, month, details) {
    document.querySelectorAll('.member-detail-popup').forEach((popup) => popup.remove());

    const total = details.reduce((sum, detail) => sum + detail.rate, 0);
    const isOver = total > member.capacity;

    const popup = document.createElement('div');
    popup.className = 'member-detail-popup';
    popup.innerHTML = `
        <h4>${member.display_name} / ${shortenMonth(month)}</h4>
        ${details.map((detail) => `
            <div class="detail-row">
                <span class="theme-name"><span class="card-color-dot" style="background:${detail.color}"></span>${detail.theme_name}</span>
                <span class="rate">${detail.rate}%</span>
            </div>
        `).join('')}
        <div class="detail-total ${isOver ? 'over' : ''}">
            <span>合計</span>
            <span>${total}%${isOver ? ` (+${total - member.capacity}% 超過)` : ''}</span>
        </div>
    `;
    popup.style.left = `${event.clientX + 12}px`;
    popup.style.top = `${event.clientY}px`;
    document.body.appendChild(popup);

    const rect = popup.getBoundingClientRect();
    if (rect.right > window.innerWidth) popup.style.left = `${event.clientX - rect.width - 12}px`;
    if (rect.bottom > window.innerHeight) popup.style.top = `${event.clientY - rect.height}px`;
}
