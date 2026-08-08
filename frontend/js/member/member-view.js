/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

import { openCellEditor } from '../gantt/gantt-editor.js';
import { HistoryManager, refreshGantt } from '../gantt/gantt-renderer.js';
import { allocations, members as membersApi, themes as themesApi } from '../api.js';
import { currentMonth, getVisibleMonths, formatMonthHeader, addMonths, aggregateRate, shortenMonth } from '../utils/date-utils.js';
import { getPresetConfig, loadViewState, subscribeViewState, updateViewState } from '../shared-state.js';
import { formatError, setBusyState, setSaveState, showPromptDialog, showToast } from '../ui.js';
import { getAggregatedMemberCapacity, getMemberCapacity, hasMonthlyCapacityOverride } from './member-capacity.js';

let allMembers = [];
let allThemes = [];
let lastAllocations = [];
let startMonth = addMonths(currentMonth(), -1);
let visibleCount = 14;
let scale = 1;
let rangeMonths = 14;
let memberSearchQuery = '';
let selectedMonth = null;
let memberDecisionFilter = 'all';
let lastMemberLoads = {};
let lastWarnings = [];
let lastVisibleMonths = [];
let memberDensity = 'standard';
let memberSort = 'risk';
let memberGroup = 'none';
let memberViewMode = 'list';
let lastOverloadCellKey = null;
let memberDataDirty = true;
const expandedMemberIds = new Set();
const MEMBER_MONTH_COLUMN_WIDTH = 88;
const MEMBER_MONTH_COLUMN_WIDTH_COMPACT = 72;
const MEMBER_REMOTE_STATE_KEYS = new Set(['startMonth', 'rangeMonths', 'bucketMonths', 'scale', 'visibleCount']);
const MEMBER_LOCAL_STATE_KEYS = new Set([
    'memberSearch', 'memberDensity', 'memberSort', 'memberGroup',
    'memberDecisionFilter', 'focusMonth', 'memberViewMode',
]);

// `null` means "no allocation"; an explicit `0` is a real, distinct value.
function normalizeMemberRate(rate) {
    if (rate === null || rate === undefined || rate === '') return null;
    return Math.max(0, Math.min(100, Number.parseInt(rate, 10) || 0));
}

function buildMemberAllocationSnapshot(themeId, memberId, month) {
    const current = lastAllocations.find((item) => item.theme_id === themeId && item.member_id === memberId && item.month === month);
    return {
        theme_id: themeId,
        member_id: memberId,
        month,
        allocation_rate: current ? current.allocation_rate : null,
        memo: current?.memo || '',
    };
}

async function applyMemberHistoryChange(data) {
    await allocations.bulkUpdate(data);
    await Promise.all([refreshGantt(), refreshMemberView()]);
}

async function commitMemberCellChange(themeId, memberId, month, allocationRate) {
    const nextRate = normalizeMemberRate(allocationRate);
    const undo = buildMemberAllocationSnapshot(themeId, memberId, month);
    const redo = {
        theme_id: themeId,
        member_id: memberId,
        month,
        allocation_rate: nextRate,
        memo: undo.memo || '',
    };

    if (undo.allocation_rate === redo.allocation_rate) {
        return false;
    }

    HistoryManager.push([undo], [redo], { apply: applyMemberHistoryChange });
    try {
        await applyMemberHistoryChange([redo]);
        return true;
    } catch (error) {
        if (HistoryManager.index >= 0) {
            HistoryManager.stack.splice(HistoryManager.index, 1);
            HistoryManager.index -= 1;
        }
        throw error;
    }
}

async function editMonthlyCapacity(member, month) {
    if (scale !== 1) {
        showToast('月別キャパシティは 1M 表示で編集してください。', 'info');
        return;
    }

    const currentCapacity = getMemberCapacity(member, month);
    const value = await showPromptDialog({
        title: `${member.display_name} / ${shortenMonth(month)} のキャパシティ`,
        message: `1〜200の整数で入力してください。空欄にすると通常月の上限 ${member.capacity}% に戻します。`,
        defaultValue: String(currentCapacity),
        confirmText: '保存',
    });
    if (value === null) return;

    const capacity = Number.parseInt(value, 10);
    const isIntegerText = /^\d+$/.test(value);
    const shouldReset = value === '';
    if (!shouldReset && (!isIntegerText || !Number.isInteger(capacity) || capacity < 1 || capacity > 200)) {
        showToast('キャパシティは1〜200の整数で入力してください。', 'error');
        return;
    }

    try {
        setBusyState(true, '月別キャパシティを保存しています...');
        setSaveState('saving', '月別キャパシティを保存しています');
        if (shouldReset) {
            await membersApi.deleteMonthlyCapacity(member.member_id, month);
        } else {
            await membersApi.updateMonthlyCapacity(member.member_id, month, capacity);
        }
        await Promise.all([refreshGantt(), refreshMemberView()]);
        setSaveState('saved', '月別キャパシティを保存しました');
        showToast(shouldReset ? '通常月のキャパシティに戻しました。' : '月別キャパシティを保存しました。', 'success');
    } catch (error) {
        setSaveState('error', '月別キャパシティの保存に失敗しました');
        showToast(`月別キャパシティの保存に失敗しました: ${formatError(error)}`, 'error');
    } finally {
        setBusyState(false);
    }
}

export async function initMemberView() {
    const state = loadViewState();
    startMonth = state.startMonth;
    scale = state.scale;
    visibleCount = state.visibleCount || getPresetConfig(state.preset || 'rolling-6').visibleCount || 8;
    rangeMonths = state.rangeMonths || visibleCount * scale;
    memberSearchQuery = state.memberSearch || '';
    selectedMonth = state.focusMonth || null;
    memberDensity = state.memberDensity === 'compact' ? 'compact' : 'standard';
    memberSort = state.memberSort || 'risk';
    memberGroup = state.memberGroup || 'none';
    memberDecisionFilter = state.memberDecisionFilter || 'all';
    memberViewMode = state.memberViewMode === 'table' ? 'table' : 'list';

    setupControls();
    subscribeViewState((nextState, meta = {}) => {
        startMonth = nextState.startMonth;
        scale = nextState.scale;
        visibleCount = nextState.visibleCount || getPresetConfig(nextState.preset || 'rolling-6').visibleCount || 8;
        rangeMonths = nextState.rangeMonths || visibleCount * scale;
        memberSearchQuery = nextState.memberSearch || '';
        selectedMonth = nextState.focusMonth || null;
        memberDensity = nextState.memberDensity === 'compact' ? 'compact' : 'standard';
        memberSort = nextState.memberSort || 'risk';
        memberGroup = nextState.memberGroup || 'none';
        memberDecisionFilter = nextState.memberDecisionFilter || 'all';
        memberViewMode = nextState.memberViewMode === 'table' ? 'table' : 'list';

        const searchInput = document.getElementById('member-search');
        if (searchInput && searchInput.value !== memberSearchQuery) {
            searchInput.value = memberSearchQuery;
        }

        const presetInput = document.getElementById('member-period-preset');
        if (presetInput) presetInput.value = nextState.preset;

        syncScaleButtons();
        syncMemberSearchControls();
        syncMemberControlValues();
        applyMemberDensity();
        const changedKeys = new Set(meta.changedKeys || []);
        const requiresRemoteRefresh = [...changedKeys].some((key) => MEMBER_REMOTE_STATE_KEYS.has(key));
        const canRenderLocally = [...changedKeys].some((key) => MEMBER_LOCAL_STATE_KEYS.has(key));
        if (requiresRemoteRefresh) memberDataDirty = true;
        if (nextState.activeView !== 'member-load') return;
        if (requiresRemoteRefresh) {
            void refreshMemberView();
        } else if (canRenderLocally) {
            renderMemberLocalView();
        }
    });

    await refreshMemberView();
}

export async function refreshMemberView({ useCache = false } = {}) {
    if (useCache && !memberDataDirty && allMembers.length > 0) {
        renderMemberLocalView();
        return;
    }
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const from = months[0];
    const toEnd = addMonths(startMonth, rangeMonths - 1);

    try {
        setBusyState(true, 'メンバー負荷を読み込んでいます...');
        [allMembers, allThemes] = await Promise.all([membersApi.list(), themesApi.list()]);

        const [memberLoads, warnings, allocationsList] = await Promise.all([
            allocations.memberLoads(from, toEnd),
            allocations.warnings(from, toEnd),
            allocations.list({ from, to: toEnd }),
        ]);

        lastAllocations = allocationsList;
        lastMemberLoads = memberLoads;
        lastWarnings = warnings;
        lastVisibleMonths = months;
        memberDataDirty = false;
        renderSummary(memberLoads, warnings);
        renderTable(months, memberLoads, allocationsList);
    } catch (error) {
        console.error('Failed to load member view:', error);
        showToast(`メンバー負荷の読み込みに失敗しました: ${formatError(error)}`, 'error');
    } finally {
        setBusyState(false);
    }
}

function renderMemberLocalView() {
    if (lastVisibleMonths.length === 0) return;
    renderSummary(lastMemberLoads, lastWarnings);
    renderTable(lastVisibleMonths, lastMemberLoads, lastAllocations);
}

function setupControls() {
    document.getElementById('member-export-csv')?.addEventListener('click', exportCSV);

    const controlsToggle = document.getElementById('member-controls-toggle');
    const controls = document.getElementById('member-load-controls');
    controlsToggle?.addEventListener('click', () => {
        const expanded = controlsToggle.getAttribute('aria-expanded') === 'true';
        controlsToggle.setAttribute('aria-expanded', String(!expanded));
        controlsToggle.textContent = expanded ? '表示条件を開く' : '表示条件を閉じる';
        controls?.classList.toggle('is-open', !expanded);
    });

    document.querySelectorAll('#member-scale-switcher .scale-btn').forEach((button) => {
        button.addEventListener('click', () => {
            scale = Number.parseInt(button.dataset.scale, 10);
            updateViewState({ bucketMonths: scale }, { source: 'member-period' });
        });
    });

    const searchInput = document.getElementById('member-search');
    if (searchInput && !document.getElementById('member-search-tools')) {
        const tools = document.createElement('div');
        tools.className = 'member-search-tools';
        tools.id = 'member-search-tools';
        tools.innerHTML = `
            <span id="member-search-status" class="member-search-status summary-subtext" hidden></span>
            <button class="btn btn-ghost btn-sm" id="member-search-clear" type="button" hidden>検索解除</button>
        `;
        searchInput.insertAdjacentElement('afterend', tools);
    }

    if (searchInput) {
        searchInput.value = memberSearchQuery;
        searchInput.addEventListener('input', (event) => {
            memberSearchQuery = event.target.value.trim().toLowerCase();
            renderMemberLocalView();
            updateViewState({ memberSearch: memberSearchQuery }, { source: 'member-search' });
        });
    }
    document.getElementById('member-search-clear')?.addEventListener('click', () => {
        memberSearchQuery = '';
        if (searchInput) searchInput.value = '';
        renderMemberLocalView();
        updateViewState({ memberSearch: '' }, { source: 'member-search' });
    });
    syncMemberSearchControls();

    const densityInput = document.getElementById('member-density');
    if (densityInput) {
        densityInput.value = memberDensity;
        densityInput.addEventListener('change', () => {
            memberDensity = densityInput.value === 'compact' ? 'compact' : 'standard';
            updateViewState({ memberDensity }, { source: 'member-density' });
        });
    }
    document.getElementById('member-sort')?.addEventListener('change', (event) => {
        memberSort = event.target.value;
        renderMemberLocalView();
        updateViewState({ memberSort }, { source: 'member-sort' });
    });
    document.getElementById('member-group')?.addEventListener('change', (event) => {
        memberGroup = event.target.value;
        renderMemberLocalView();
        updateViewState({ memberGroup }, { source: 'member-group' });
    });
    document.getElementById('member-view-mode-toggle')?.addEventListener('click', () => {
        updateViewState({ memberViewMode: memberViewMode === 'list' ? 'table' : 'list' }, { source: 'member-view-mode' });
    });
    syncMemberControlValues();
    applyMemberDensity();

    const guide = document.querySelector('.member-load-guide');
    if (guide && window.matchMedia?.('(max-width: 720px)').matches) guide.open = false;

    document.getElementById('member-jump-overload')?.addEventListener('click', jumpToNextOverload);

    document.getElementById('member-prev').addEventListener('click', () => {
        startMonth = addMonths(startMonth, -scale * 3);
        updateViewState({ startMonth }, { source: 'member-period' });
    });

    document.getElementById('member-next').addEventListener('click', () => {
        startMonth = addMonths(startMonth, scale * 3);
        updateViewState({ startMonth }, { source: 'member-period' });
    });

    document.getElementById('member-today').addEventListener('click', () => {
        const preset = document.getElementById('member-period-preset').value || 'rolling-6';
        const config = getPresetConfig(preset);
        startMonth = config.startMonth;
        updateViewState({ ...config, bucketMonths: scale, preset }, { source: 'member-period' });
    });
}

function syncMemberControlValues() {
    const densityInput = document.getElementById('member-density');
    const sortInput = document.getElementById('member-sort');
    const groupInput = document.getElementById('member-group');
    if (densityInput) densityInput.value = memberDensity;
    if (sortInput) sortInput.value = memberSort;
    if (groupInput) groupInput.value = memberGroup;
}

function applyMemberDensity() {
    document.getElementById('member-load-container')?.classList.toggle('density-compact', memberDensity === 'compact');
}

function getMemberMonthColumnWidth() {
    return memberDensity === 'compact' ? MEMBER_MONTH_COLUMN_WIDTH_COMPACT : MEMBER_MONTH_COLUMN_WIDTH;
}

function jumpToNextOverload() {
    const buttons = [...document.querySelectorAll('.member-detail-button[data-overloaded="true"]')];
    if (buttons.length === 0) {
        showToast('表示期間内に過負荷はありません。', 'info');
        return;
    }

    const currentIndex = buttons.findIndex((button) => button.dataset.memberCellKey === lastOverloadCellKey);
    const target = buttons[(currentIndex + 1) % buttons.length];
    lastOverloadCellKey = target.dataset.memberCellKey;
    target.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
    target.focus({ preventScroll: true });
}

function syncScaleButtons() {
    document.querySelectorAll('#member-scale-switcher .scale-btn').forEach((button) => {
        button.classList.toggle('active', Number.parseInt(button.dataset.scale, 10) === scale);
    });
}

function renderSummary(memberLoads, warnings) {
    const summary = document.getElementById('member-load-summary');
    if (!summary) return;
    const membersWithData = allMembers.length;
    let overloadedMembers = 0;
    let nearLimitMembers = 0;
    let unassignedMembers = 0;
    let averageUtilization = 0;

    allMembers.forEach((member) => {
        const stats = getMemberPeriodStats(member, memberLoads[member.member_id] || {});
        averageUtilization += stats.averageUtilization;

        if (stats.overloaded) overloadedMembers += 1;
        if (!stats.hasLoad) {
            unassignedMembers += 1;
        } else if (stats.nearLimit) nearLimitMembers += 1;
    });

    const avgUtilizationDisplay = membersWithData > 0 ? Math.round((averageUtilization / membersWithData) * 100) : 0;

    const rangeLabel = lastVisibleMonths.length
        ? (selectedMonth ? `${shortenMonth(selectedMonth)} フォーカス` : `${shortenMonth(lastVisibleMonths[0])}〜${shortenMonth(lastVisibleMonths[lastVisibleMonths.length - 1])}`)
        : '表示期間';
    const warningCount = selectedMonth
        ? warnings.filter((warning) => monthBucketIncludes(warning.month, selectedMonth, getBucketSize(selectedMonth))).length
        : warnings.length;

    summary.innerHTML = `
        <button class="summary-card member-load-summary-card member-summary-action${memberDecisionFilter === 'all' ? ' active' : ''}" type="button" data-member-filter="all" aria-pressed="${memberDecisionFilter === 'all'}">
            <div class="summary-label">平均キャパ利用率</div>
            <div class="summary-value">${avgUtilizationDisplay}%</div>
            <div class="summary-subtext">${rangeLabel}・全${membersWithData}名</div>
        </button>
        <button class="summary-card member-load-summary-card member-summary-action${memberDecisionFilter === 'overloaded' ? ' active' : ''}" type="button" data-member-filter="overloaded" aria-pressed="${memberDecisionFilter === 'overloaded'}">
            <div class="summary-label">超過</div>
            <div class="summary-value">${overloadedMembers}</div>
            <div class="summary-subtext">警告セル ${warningCount}件</div>
        </button>
        <button class="summary-card member-load-summary-card member-summary-action${memberDecisionFilter === 'near-limit' ? ' active' : ''}" type="button" data-member-filter="near-limit" aria-pressed="${memberDecisionFilter === 'near-limit'}">
            <div class="summary-label">上限付近</div>
            <div class="summary-value">${nearLimitMembers}</div>
            <div class="summary-subtext">利用率 90〜100%</div>
        </button>
        <button class="summary-card member-load-summary-card member-summary-action${memberDecisionFilter === 'unassigned' ? ' active' : ''}" type="button" data-member-filter="unassigned" aria-pressed="${memberDecisionFilter === 'unassigned'}">
            <div class="summary-label">未割当</div>
            <div class="summary-value">${unassignedMembers}</div>
            <div class="summary-subtext">全期間で配分なし</div>
        </button>
    `;

    summary.querySelectorAll('[data-member-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            const next = button.dataset.memberFilter;
            const value = next === 'all' || memberDecisionFilter === next ? 'all' : next;
            memberDecisionFilter = value;
            renderMemberLocalView();
            updateViewState({ memberDecisionFilter: value }, { source: 'member-kpi' });
        });
    });
}

function renderTable(months, memberLoads, allocationsList) {
    renderHeader(months);

    const tbody = document.getElementById('member-load-tbody');
    const current = currentMonth();
    const memberThemeLoads = buildMemberThemeLoads(allocationsList);

    const filteredMembers = sortMembers(allMembers.filter((member) => (
        matchesMemberSearch(member, memberThemeLoads[member.member_id] || {})
        && matchesMemberDecisionFilter(member, memberLoads[member.member_id] || {})
    )), memberLoads);
    syncMemberSearchControls(filteredMembers.length);

    let html = '';
    let previousGroup = null;
    filteredMembers.forEach((member) => {
        const groupLabel = member.department || '部署未設定';
        if (memberGroup === 'department' && groupLabel !== previousGroup) {
            html += `<tr class="member-group-row"><th colspan="${months.length + 1}" scope="rowgroup">${escapeHtml(groupLabel)}</th></tr>`;
            previousGroup = groupLabel;
        }
        const loads = memberLoads[member.member_id] || {};
        const memberThemes = memberThemeLoads[member.member_id] || {};
        const themeIds = Object.keys(memberThemes).map((id) => Number.parseInt(id, 10));
        const hasThemes = themeIds.length > 0;
        const isExpanded = hasThemes && expandedMemberIds.has(member.member_id);

        html += `<tr class="member-row" data-member-row="${member.member_id}">`;
        html += `<td><div class="member-row-header">`;
        html += hasThemes ? `<button class="toggle-btn${isExpanded ? ' expanded' : ''}" data-toggle="${member.member_id}" type="button" aria-expanded="${isExpanded}" aria-label="${escapeHtml(member.display_name)}のテーマ内訳を展開"></button>` : '<span class="toggle-placeholder" aria-hidden="true"></span>';
        html += `<div class="member-identity"><strong>${escapeHtml(member.display_name)}</strong><span class="member-department${member.department ? '' : ' missing'}">${escapeHtml(member.department || '部署未設定')}</span></div>`;
        html += `<span class="member-capacity" title="月別指定がない月に適用">通常 ${member.capacity}%</span>`;
        html += `</div></td>`;

        months.forEach((month) => {
            const bucketSize = getBucketSize(month);
            const load = aggregateRate(loads, month, bucketSize);
            const capacity = getAggregatedMemberCapacity(member, month, bucketSize);
            const isOver = load > capacity;
            const className = getLoadClass(load, capacity, isOver);
            const { barHtml, details } = buildStackedBar(month, memberThemes, capacity);
            const detailsJson = details.length > 0 ? encodeURIComponent(JSON.stringify(details)) : '';

            const excess = Math.max(0, load - capacity);
            const stateLabel = load === 0 ? '未割当' : (isOver ? `上限超過 ${excess}%` : `上限 ${capacity}%`);
            html += `<td class="${month === current ? 'month-current' : ''}${load === 0 ? ' member-cell-empty' : ''}" data-member-month="${month}" data-member-cell="${member.member_id}-${month}" data-member-id="${member.member_id}" data-month="${month}" data-details="${detailsJson}">`;
            if (load > 0) {
                html += renderMemberSummaryButton(member, month, load, stateLabel, className, barHtml, isOver, excess);
            } else {
                html += '<span class="member-empty-mark" aria-hidden="true">—</span>';
            }
            html += renderCapacityButton(member, month, capacity);
            html += `</td>`;
        });

        html += '</tr>';

        themeIds.forEach((themeId) => {
            const theme = allThemes.find((item) => item.theme_id === themeId);
            const themeName = theme ? theme.name : `テーマ ${themeId}`;
            const themeColor = theme ? theme.color : '#888888';
            const themeLoads = memberThemes[themeId];

            html += `<tr class="theme-row${isExpanded ? '' : ' hidden'}" data-parent="${member.member_id}">`;
            html += `<td><div class="theme-row-content"><span class="card-color-dot" style="background:${themeColor};width:8px;height:8px" aria-hidden="true"></span><span class="theme-row-label">${escapeHtml(themeName)}</span><span class="theme-row-kind">テーマ内訳</span></div></td>`;

            months.forEach((month) => {
                const rate = aggregateRate(themeLoads, month, getBucketSize(month));
                const editable = scale === 1;
                const semantics = editable
                    ? `tabindex="0" role="button" data-editable="true" aria-label="${escapeHtml(member.display_name)} ${escapeHtml(themeName)} ${shortenMonth(month)} ${rate}%を編集"`
                    : `aria-label="${escapeHtml(member.display_name)} ${escapeHtml(themeName)} ${formatMonthHeader(month, getBucketSize(month)).replace('\n', ' ')} ${rate}%、集計値"`;
                html += `<td class="member-theme-cell${editable ? '' : ' is-readonly'} ${month === current ? 'month-current' : ''}" ${semantics} data-member-month="${month}" data-member="${member.member_id}" data-theme="${themeId}" data-month="${month}" data-rate="${rate}">`;
                html += renderMemberThemeCellContent(theme, member, month, rate);
                html += `</td>`;
            });

            html += `</tr>`;
        });
    });

    const emptyMessage = memberSearchQuery
        ? '検索条件に一致するメンバーがありません。'
        : '表示するメンバーがありません。';
    tbody.innerHTML = html || `<tr><td colspan="${months.length + 1}" class="summary-subtext">${emptyMessage}</td></tr>`;

    bindTableInteractions(tbody);
    syncSelectedMonthStyles();
    renderMobileMemberList(months, filteredMembers, memberLoads, memberThemeLoads);
}

function renderMobileMemberList(months, members, memberLoads, memberThemeLoads) {
    const list = document.getElementById('member-mobile-list');
    const table = document.getElementById('member-load-container');
    const toggle = document.getElementById('member-view-mode-toggle');
    const focusLabel = document.getElementById('member-mobile-focus-label');
    if (!list || !table) return;
    const focusMonth = selectedMonth && months.includes(selectedMonth)
        ? selectedMonth
        : (months.includes(currentMonth()) ? currentMonth() : months[0]);
    document.getElementById('view-member-load')?.classList.toggle('member-mobile-table-mode', memberViewMode === 'table');
    if (toggle) toggle.textContent = memberViewMode === 'table' ? 'リスト表示' : '表表示';
    if (focusLabel) focusLabel.textContent = `${shortenMonth(focusMonth)} の負荷判断`;

    list.innerHTML = members.map((member) => {
        const focusBucketSize = getBucketSize(focusMonth);
        const load = aggregateRate(memberLoads[member.member_id] || {}, focusMonth, focusBucketSize);
        const capacity = getAggregatedMemberCapacity(member, focusMonth, focusBucketSize);
        const utilization = capacity > 0 ? Math.round((load / capacity) * 100) : 0;
        const details = buildStackedBar(focusMonth, memberThemeLoads[member.member_id] || {}, capacity).details
            .sort((left, right) => right.rate - left.rate);
        const className = getLoadClass(load, capacity);
        const reason = load > capacity
            ? `上限を ${load - capacity}% 超過。${details[0] ? `${details[0].theme_name}の寄与が最大です。` : ''}`
            : (load === 0 ? 'この月の割当はありません。' : `上限まで ${capacity - load}% の余力があります。`);
        const primaryThemes = details.slice(0, 3).map((detail) => `<span>${escapeHtml(detail.theme_name)} ${detail.rate}%</span>`).join('');
        const editAction = scale === 1 && details[0]
            ? `<button class="btn btn-ghost btn-sm" type="button" data-mobile-edit-member="${member.member_id}" data-mobile-edit-theme="${details[0].theme_id || ''}" data-mobile-edit-month="${focusMonth}">主要テーマを修正</button>`
            : '';
        return `<article class="member-mobile-card">
            <header><div><strong>${escapeHtml(member.display_name)}</strong><span>${escapeHtml(member.department || '部署未設定')}</span></div><span class="load-cell ${className}">${load}% / ${capacity}%</span></header>
            <div class="member-mobile-utilization"><span style="width:${Math.min(utilization, 100)}%"></span><i style="left:100%"></i></div>
            <p>${utilization}%利用・${escapeHtml(reason)}</p>
            <div class="member-mobile-themes">${primaryThemes || '<span>主要テーマなし</span>'}</div>
            ${editAction}
        </article>`;
    }).join('') || '<p class="summary-subtext">条件に一致するメンバーはいません。</p>';

    list.querySelectorAll('[data-mobile-edit-member]').forEach((button) => button.addEventListener('click', () => {
        const memberId = button.dataset.mobileEditMember;
        const themeId = button.dataset.mobileEditTheme;
        const month = button.dataset.mobileEditMonth;
        updateViewState({ memberViewMode: 'table' }, { source: 'member-mobile-edit' });
        document.querySelector(`.member-theme-cell[data-member="${memberId}"][data-theme="${themeId}"][data-month="${month}"]`)?.click();
    }));
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
    const monthColumnWidth = getMemberMonthColumnWidth();
    months.forEach((month) => {
        const label = formatMonthHeader(month, getBucketSize(month));
        html += `<th class="${month === current ? 'month-current' : ''}" tabindex="0" role="button" aria-label="${shortenMonth(month)}列を強調" data-member-month="${month}" style="width:${monthColumnWidth}px;min-width:${monthColumnWidth}px;max-width:${monthColumnWidth}px;">${label.replace('\n', '<br>')}${month === current ? '<span class="current-month-label">現在</span>' : ''}</th>`;
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
            expandedMemberIds.add(Number.parseInt(button.dataset.toggle, 10));
            button.classList.add('expanded');
            button.setAttribute('aria-expanded', 'true');
        });
    });

    document.getElementById('member-collapse-all')?.addEventListener('click', (event) => {
        event.stopPropagation();
        expandedMemberIds.clear();
        document.querySelectorAll('.theme-row').forEach((row) => row.classList.add('hidden'));
        document.querySelectorAll('.toggle-btn').forEach((button) => {
            button.classList.remove('expanded');
            button.setAttribute('aria-expanded', 'false');
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

function matchesMemberDecisionFilter(member, loadsByMonth) {
    if (memberDecisionFilter === 'all') return true;
    const stats = getMemberPeriodStats(member, loadsByMonth);
    if (memberDecisionFilter === 'overloaded') return stats.overloaded;
    if (memberDecisionFilter === 'unassigned') return !stats.hasLoad;
    if (memberDecisionFilter === 'slack') return stats.hasLoad && stats.maxUtilization < 0.5;
    if (memberDecisionFilter === 'near-limit') return stats.nearLimit;
    return true;
}

function getMemberPeriodStats(member, loadsByMonth) {
    const periods = selectedMonth
        ? [selectedMonth]
        : (lastVisibleMonths.length > 0 ? lastVisibleMonths : Object.keys(loadsByMonth || {}));
    const rows = periods.map((month) => {
        const bucketSize = getBucketSize(month);
        const load = aggregateRate(loadsByMonth || {}, month, bucketSize);
        const capacity = getAggregatedMemberCapacity(member, month, bucketSize);
        return { load, capacity, utilization: capacity > 0 ? load / capacity : 0 };
    });
    const loads = rows.map((row) => row.load);
    return {
        hasLoad: loads.some((load) => load > 0),
        overloaded: rows.some((row) => row.load > row.capacity),
        nearLimit: rows.some((row) => row.utilization >= 0.9 && row.utilization <= 1),
        maxUtilization: Math.max(0, ...rows.map((row) => row.utilization)),
        averageUtilization: rows.length ? rows.reduce((sum, row) => sum + row.utilization, 0) / rows.length : 0,
        averageLoad: loads.length ? Math.round(loads.reduce((sum, load) => sum + load, 0) / loads.length) : 0,
    };
}

function sortMembers(source, memberLoads) {
    const statsById = new Map(source.map((member) => [member.member_id, getMemberPeriodStats(member, memberLoads[member.member_id] || {})]));
    const riskRank = (stats) => {
        if (stats.overloaded) return 0;
        if (stats.nearLimit) return 1;
        if (stats.hasLoad) return 2;
        return 3;
    };
    return [...source].sort((left, right) => {
        const leftStats = statsById.get(left.member_id);
        const rightStats = statsById.get(right.member_id);
        if (memberSort === 'name') return left.display_name.localeCompare(right.display_name, 'ja');
        if (memberSort === 'department') return (left.department || '部署未設定').localeCompare(right.department || '部署未設定', 'ja') || left.display_name.localeCompare(right.display_name, 'ja');
        if (memberSort === 'max-utilization') return rightStats.maxUtilization - leftStats.maxUtilization || left.display_name.localeCompare(right.display_name, 'ja');
        if (memberSort === 'average-utilization') return rightStats.averageUtilization - leftStats.averageUtilization || left.display_name.localeCompare(right.display_name, 'ja');
        return riskRank(leftStats) - riskRank(rightStats)
            || rightStats.maxUtilization - leftStats.maxUtilization
            || left.display_name.localeCompare(right.display_name, 'ja');
    });
}

function syncMemberSearchControls(filteredCount = allMembers.length) {
    const clearButton = document.getElementById('member-search-clear');
    const status = document.getElementById('member-search-status');
    if (!clearButton || !status) return;

    const hasSearch = Boolean(memberSearchQuery);
    clearButton.hidden = !hasSearch;
    clearButton.disabled = !hasSearch;

    if (!hasSearch) {
        status.hidden = true;
        status.textContent = '';
        return;
    }

    status.hidden = false;
    status.textContent = `${filteredCount} / ${allMembers.length} 名を表示`;
}

function buildStackedBar(month, memberThemes, capacity) {
    const details = [];

    Object.keys(memberThemes).forEach((themeId) => {
        const parsedThemeId = Number.parseInt(themeId, 10);
        const rate = aggregateRate(memberThemes[parsedThemeId], month, getBucketSize(month));
        if (rate <= 0) return;

        const theme = allThemes.find((item) => item.theme_id === parsedThemeId);
        details.push({
            theme_id: parsedThemeId,
            theme_name: theme ? theme.name : `テーマ ${parsedThemeId}`,
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
    document.querySelectorAll('#member-load-thead [data-member-month]').forEach((element) => {
        element.addEventListener('click', () => {
            const month = element.dataset.memberMonth || null;
            setSelectedMonth(selectedMonth === month ? null : month);
        });
        element.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            element.click();
        });
    });

    tbody.querySelectorAll('.toggle-btn').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const memberId = button.dataset.toggle;
            const expanded = button.classList.toggle('expanded');
            const parsedMemberId = Number.parseInt(memberId, 10);
            if (expanded) expandedMemberIds.add(parsedMemberId);
            else expandedMemberIds.delete(parsedMemberId);
            button.setAttribute('aria-expanded', String(expanded));
            tbody.querySelectorAll(`tr[data-parent="${memberId}"]`).forEach((row) => row.classList.toggle('hidden'));
        });
    });

    tbody.querySelectorAll('td[data-member-cell]').forEach((cell) => {
        bindMemberDetailCell(cell);
        cell.addEventListener('mouseenter', (event) => {
            if (document.querySelector('.member-detail-popup.is-pinned')) return;
            const details = parseCellDetails(cell);
            if (!details || details.length === 0) return;
            const member = allMembers.find((item) => item.member_id === Number.parseInt(cell.dataset.memberId, 10));
            if (!member) return;
            showDetailPopup(event, member, cell.dataset.month, details);
        });

        cell.addEventListener('mouseleave', () => {
            document.querySelectorAll('.member-detail-popup:not(.is-pinned)').forEach((popup) => popup.remove());
        });
    });

    tbody.querySelectorAll('[data-edit-member-capacity]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const member = allMembers.find((item) => item.member_id === Number.parseInt(button.dataset.editMemberCapacity, 10));
            if (member) editMonthlyCapacity(member, button.dataset.month);
        });
    });

    tbody.querySelectorAll('.member-theme-cell[data-editable="true"]').forEach((cell) => {
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
            }, {
                optimisticSave: false,
                onCommitSuccess: (newRate = 0) => {
                    updateThemeCell(cell, memberId, themeId, month, newRate);
                },
                commitChange: (nextRate) => commitMemberCellChange(themeId, memberId, month, nextRate),
                clearChange: () => commitMemberCellChange(themeId, memberId, month, null),
            });
        });
        cell.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            cell.click();
        });
    });
}

function bindMemberDetailCell(cell) {
    const button = cell.querySelector('.member-detail-button');
    if (!button) return;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        const details = parseCellDetails(cell);
        const member = allMembers.find((item) => item.member_id === Number.parseInt(cell.dataset.memberId, 10));
        if (!member || details.length === 0) return;
        showDetailPopup(event, member, cell.dataset.month, details, { anchor: button, pinned: true });
    });
}

function parseCellDetails(cell) {
    const encoded = cell.dataset.details;
    if (!encoded) return [];
    try {
        return JSON.parse(decodeURIComponent(encoded));
    } catch {
        return [];
    }
}

function setSelectedMonth(month) {
    selectedMonth = month || null;
    syncSelectedMonthStyles();
    renderMemberLocalView();
    updateViewState({ focusMonth: selectedMonth }, { source: 'member-focus-month' });
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
    const capacity = getMemberCapacity(member, month);
    const isOver = total > capacity;
    const className = getLoadClass(total, capacity, isOver);
    const { barHtml, details } = buildStackedBar(month, memberThemes, capacity);

    cell.dataset.details = details.length > 0 ? encodeURIComponent(JSON.stringify(details)) : '';
    cell.innerHTML = `${total > 0
        ? renderMemberSummaryButton(member, month, total, isOver ? `上限超過 ${total - capacity}%` : `上限 ${capacity}%`, className, barHtml, isOver, Math.max(0, total - capacity))
        : '<span class="member-empty-mark" aria-hidden="true">—</span>'}${renderCapacityButton(member, month, capacity)}`;
    bindMemberDetailCell(cell);
}

function renderMemberSummaryButton(member, month, load, stateLabel, className, barHtml, isOver, excess) {
    const label = `${member.display_name} ${shortenMonth(month)} ${load}% ${stateLabel}。テーマ別内訳を表示`;
    const capacity = getAggregatedMemberCapacity(member, month, getBucketSize(month));
    const utilization = capacity > 0 ? Math.round((load / capacity) * 100) : 0;
    return `<button class="member-detail-button" type="button" aria-label="${escapeHtml(label)}" aria-haspopup="dialog" aria-expanded="false" data-overloaded="${isOver}" data-member-cell-key="${member.member_id}-${month}"><span class="member-cell-inner"><span class="member-load-primary"><span class="load-cell ${className}">${load}%</span><span class="member-utilization">${utilization}%</span></span>${barHtml}${isOver ? `<small class="member-excess">超過 +${excess}%</small>` : ''}<span class="member-detail-button-label">内訳</span></span></button>`;
}

function renderCapacityButton(member, month, capacity) {
    const overridden = scale === 1 && hasMonthlyCapacityOverride(member, month);
    if (scale !== 1) return `<span class="member-capacity-readonly" aria-label="平均上限 ${capacity}%">上限 ${capacity}</span>`;
    const label = `上限 ${capacity}%${overridden ? '・月別' : ''}`;
    const title = `${shortenMonth(month)}のキャパシティを編集${overridden ? '（月別指定あり）' : ''}`;
    return `<button class="member-capacity-button${overridden ? ' is-overridden' : ''}" type="button" data-edit-member-capacity="${member.member_id}" data-month="${month}" aria-label="${escapeHtml(`${member.display_name} ${title}`)}" title="${escapeHtml(title)}">${label}</button>`;
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

export function getLoadClass(load, capacity) {
    if (load === 0) return 'load-none';
    const utilization = capacity > 0 ? (load / capacity) * 100 : 0;
    if (utilization < 70) return 'load-low';
    if (utilization < 90) return 'load-mid';
    if (utilization <= 100) return 'load-near';
    if (utilization < 120) return 'load-over';
    return 'load-critical';
}

function renderMemberThemeCellContent(theme, member, month, rate) {
    const themeColor = theme?.color || '#888888';
    const className = getLoadClass(rate, member?.capacity || 100);
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

function getBucketSize(periodStart) {
    const index = getVisibleMonths(startMonth, visibleCount, scale).indexOf(periodStart);
    if (index < 0) return scale;
    return Math.max(1, Math.min(scale, rangeMonths - index * scale));
}

function getThemeMilestones(theme) {
    if (Array.isArray(theme?.milestones) && theme.milestones.length > 0) return theme.milestones;
    if (theme?.milestone_month) {
        return [{ month: theme.milestone_month, label: theme.milestone_label || 'マイルストーン' }];
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
        .filter((item) => monthBucketIncludes(item.month, month, getBucketSize(month)));
    if (matches.length === 0) return '';

    const [first, ...rest] = matches;
    const firstLabel = escapeHtml(first.label || 'マイルストーン');
    const firstCompletedClass = first.is_completed ? ' completed' : '';
    const tooltip = escapeHtml(matches
        .map((item) => `${item.is_completed ? '完了: ' : ''}${item.label || 'マイルストーン'}`)
        .join('\n'));
    const extraCount = rest.length > 0
        ? `<span class="member-theme-milestone member-theme-milestone-count" title="${tooltip}">+${rest.length}</span>`
        : '';

    return `<div class="member-theme-milestones" title="${tooltip}"><span class="member-theme-milestone${firstCompletedClass}" title="${tooltip}">${firstLabel}</span>${extraCount}</div>`;
}

function devCompleteBadge(theme, month, rate) {
    const item = getThemeDevCompleteItems(theme).find((candidate) => monthBucketIncludes(candidate.month, month, getBucketSize(month)));
    if (!item) return '';
    const rateLabel = rate > 0 ? `<span>${rate}%</span>` : '';
    return `<span class="member-theme-dev-complete${item.is_completed ? ' completed' : ''}" title="開発完了月"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 16.53l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3Z"/></svg>${rateLabel}<span class="sr-only">開発完了月</span></span>`;
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
    const headers = ['メンバー', '部署', 'テーマ', 'カテゴリ', 'ステータス', ...months.map((month) => formatMonthHeader(month, getBucketSize(month)).replace('\n', ' '))];
    const memberThemeLoads = buildMemberThemeLoads(lastAllocations);

    let csvContent = `${headers.join(',')}\n`;

    const scope = document.getElementById('member-export-scope')?.value || 'visible';
    const exportMembers = scope === 'all'
        ? allMembers
        : sortMembers(allMembers.filter((member) => (
            matchesMemberSearch(member, memberThemeLoads[member.member_id] || {})
            && matchesMemberDecisionFilter(member, lastMemberLoads[member.member_id] || {})
        )), lastMemberLoads);

    exportMembers.forEach((member) => {
        const themes = memberThemeLoads[member.member_id] || {};
        const themeIds = Object.keys(themes).map((id) => Number.parseInt(id, 10));

        csvContent += [
            member.display_name,
            member.department || '',
            'キャパシティ',
            '',
            '',
            ...months.map((month) => getAggregatedMemberCapacity(member, month, getBucketSize(month))),
        ].join(',') + '\n';

        if (themeIds.length === 0) {
            return;
        }

        themeIds.forEach((themeId) => {
            const theme = allThemes.find((item) => item.theme_id === themeId);
            csvContent += [
                member.display_name,
                member.department || '',
                theme?.name || `テーマ ${themeId}`,
                theme?.category || '',
                theme?.status || '',
                ...months.map((month) => themes[themeId][month] || ''),
            ].join(',') + '\n';
        });
    });

    const filename = `member_load_${scope}_${months[0]}_${months[months.length - 1]}.csv`;

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

function showDetailPopup(event, member, month, details, options = {}) {
    closeMemberDetailPopups();

    const total = details.reduce((sum, detail) => sum + detail.rate, 0);
    const capacity = getAggregatedMemberCapacity(member, month, getBucketSize(month));
    const isOver = total > capacity;
    const pinned = Boolean(options.pinned);
    const anchor = options.anchor || null;

    const popup = document.createElement('div');
    popup.className = `member-detail-popup${pinned ? ' is-pinned' : ''}`;
    popup.setAttribute('role', pinned ? 'dialog' : 'tooltip');
    popup.setAttribute('aria-label', `${member.display_name} ${shortenMonth(month)}の負荷内訳`);
    popup.innerHTML = `
        <div class="member-detail-popup-header">
            <h4>${escapeHtml(member.display_name)} / ${escapeHtml(shortenMonth(month))}</h4>
            ${pinned ? '<button class="member-detail-popup-close" type="button" aria-label="内訳を閉じる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>' : ''}
        </div>
        ${[...details].sort((left, right) => right.rate - left.rate).map((detail) => `
            <div class="detail-row">
                <span class="theme-name"><span class="card-color-dot" style="background:${safeThemeColor(detail.color)}"></span>${escapeHtml(detail.theme_name)}</span>
                <span class="rate">${detail.rate}% <small>${total > 0 ? Math.round((detail.rate / total) * 100) : 0}%寄与</small></span>
            </div>
        `).join('')}
        <div class="detail-total ${isOver ? 'over' : ''}">
            <span>合計</span>
            <span>${total}% / 上限 ${capacity}%${isOver ? ` (+${total - capacity}% 超過)` : ''}</span>
        </div>
        <button class="btn btn-primary btn-sm member-adjust-gantt" type="button">Ganttで調整</button>
    `;
    if (anchor) {
        anchor.setAttribute('aria-expanded', 'true');
        const anchorRect = anchor.getBoundingClientRect();
        popup.style.left = `${anchorRect.left}px`;
        popup.style.top = `${anchorRect.bottom + 8}px`;
    } else {
        popup.style.left = `${event.clientX + 12}px`;
        popup.style.top = `${event.clientY}px`;
    }
    document.body.appendChild(popup);
    popup.querySelector('.member-adjust-gantt')?.addEventListener('click', () => {
        updateViewState({ focusMonth: month }, { source: 'member-drilldown' });
        document.dispatchEvent(new CustomEvent('manage:navigate', { detail: { view: 'gantt' } }));
        closeMemberDetailPopups();
    });

    const rect = popup.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) popup.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    if (rect.bottom > window.innerHeight - 8) {
        const fallbackTop = anchor ? anchor.getBoundingClientRect().top - rect.height - 8 : event.clientY - rect.height;
        popup.style.top = `${Math.max(8, fallbackTop)}px`;
    }

    if (pinned) {
        const closeButton = popup.querySelector('.member-detail-popup-close');
        const close = () => {
            closeMemberDetailPopups();
            anchor?.focus();
        };
        closeButton?.addEventListener('click', close);
        popup.addEventListener('keydown', (keyboardEvent) => {
            if (keyboardEvent.key !== 'Escape') return;
            keyboardEvent.preventDefault();
            close();
        });
        closeButton?.focus();
    }
}

function closeMemberDetailPopups() {
    document.querySelectorAll('.member-detail-popup').forEach((popup) => popup.remove());
    document.querySelectorAll('.member-detail-button[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
}

function safeThemeColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '#73768c';
}
