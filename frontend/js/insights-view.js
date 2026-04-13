import { insights } from './api.js';
import { loadViewState, subscribeViewState } from './shared-state.js';
import { addMonths, getVisibleMonths } from './utils/date-utils.js';
import { formatError, setBusyState } from './ui.js';

let currentState = loadViewState();
const STATUS_LABELS = {
    planning: '計画中',
    active: '進行中',
    completed: '完了',
    cancelled: '中止',
};

export async function initInsightsView() {
    subscribeViewState((nextState) => {
        currentState = nextState;
        refreshInsightsView();
    });
    await refreshInsightsView();
}

export async function refreshInsightsView() {
    const months = getVisibleMonths(currentState.startMonth, 14, currentState.scale);
    const from = months[0];
    const to = months[months.length - 1];
    const toEnd = currentState.scale > 1 ? addMonths(to, currentState.scale - 1) : to;

    try {
        setBusyState(true, 'インサイトを読み込み中...');
        const overview = await insights.overview(from, toEnd);
        renderSummary(overview.summary || {});
        renderAggregates(overview.dashboard || {});
        renderHealthChecks(overview.health_checks || []);
        renderRecommendations(overview.recommendations || []);
        renderDashboard(overview.dashboard || {});
    } catch (error) {
        renderError(formatError(error, 'インサイトの読み込みに失敗しました。'));
    } finally {
        setBusyState(false);
    }
}

function renderSummary(summary) {
    const target = document.getElementById('insights-summary');
    if (!target) return;

    target.innerHTML = `
        <article class="summary-card">
            <div class="summary-label">テーマ数</div>
            <div class="summary-value">${summary.theme_count || 0}</div>
            <div class="summary-subtext">進行中 ${summary.active_theme_count || 0} 件</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">平均メンバー負荷</div>
            <div class="summary-value">${summary.average_member_load || 0}%</div>
            <div class="summary-subtext">全メンバー平均</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">警告セル</div>
            <div class="summary-value">${summary.warning_cell_count || 0}</div>
            <div class="summary-subtext">過負荷メンバー ${summary.overloaded_member_count || 0} 名</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">割り当て中メンバー</div>
            <div class="summary-value">${summary.assigned_member_count || 0}</div>
            <div class="summary-subtext">テーマに割当済み</div>
        </article>
    `;
}

function renderAggregates(dashboard) {
    renderPillList(
        'dashboard-category-distribution',
        (dashboard.category_distribution || []).map((item) => ({ label: item.label, value: `${item.count}件` })),
    );
    renderPillList(
        'dashboard-status-distribution',
        (dashboard.status_distribution || []).map((item) => ({ label: localizeStatus(item.label), value: `${item.count}件` })),
    );
    renderPillList(
        'dashboard-department-summary',
        (dashboard.department_load || []).map((item) => ({ label: item.department, value: `${item.average_load}%` })),
    );
}

function renderHealthChecks(items) {
    const target = document.getElementById('health-check-list');
    if (!target) return;

    if (items.length === 0) {
        target.innerHTML = '<div class="empty-panel">選択期間では健全性の問題は見つかりませんでした。</div>';
        return;
    }

    target.innerHTML = items.map((item) => `
        <article class="insight-item insight-${item.severity}">
            <div class="insight-header">
                <strong>${labelSeverity(item.severity)}</strong>
                <span>${escapeHtml(item.entity_name || item.code)}</span>
            </div>
            <p>${escapeHtml(item.message || '')}</p>
            <div class="insight-meta">${escapeHtml(item.code)}</div>
        </article>
    `).join('');
}

function renderRecommendations(items) {
    const target = document.getElementById('recommendation-list');
    if (!target) return;

    if (items.length === 0) {
        target.innerHTML = '<div class="empty-panel">現在は推奨調整案はありません。</div>';
        return;
    }

    target.innerHTML = items.map((item) => `
        <article class="insight-item">
            <div class="insight-header">
                <strong>${escapeHtml(item.display_name)}</strong>
                <span>${escapeHtml(item.month)} / ${item.load}% / 上限 ${item.capacity}%</span>
            </div>
            <p>超過負荷: ${item.excess}%</p>
            <div class="candidate-list">
                ${item.themes.map((theme) => `
                    <div class="candidate-card">
                        <div class="candidate-title">${escapeHtml(theme.theme_name)}: ${theme.suggested_shift}% を移管候補</div>
                        <div class="candidate-body">
                            ${(theme.candidate_members || []).map((member) => `
                                <span class="candidate-chip">
                                    ${escapeHtml(member.display_name)}
                                    (${member.current_load}%/${member.capacity}%)
                                </span>
                            `).join('') || '<span class="summary-subtext">候補者は見つかりませんでした</span>'}
                        </div>
                    </div>
                `).join('')}
            </div>
        </article>
    `).join('');
}

function renderDashboard(dashboard) {
    renderSimpleTable(
        'dashboard-monthly-trend',
        ['月', '配分合計', '稼働テーマ数'],
        (dashboard.monthly_trend || []).map((item) => [item.month, `${item.total_allocation}%`, String(item.active_theme_count)]),
    );
    renderSimpleTable(
        'dashboard-department-load',
        ['部署', '平均負荷', '人数'],
        (dashboard.department_load || []).map((item) => [item.department, `${item.average_load}%`, String(item.member_count)]),
    );
    renderSimpleTable(
        'dashboard-top-themes',
        ['テーマ', 'ステータス', '累計配分'],
        (dashboard.top_themes || []).map((item) => [item.name, localizeStatus(item.status), `${item.total_allocation}%`]),
    );
}

function renderSimpleTable(targetId, headers, rows) {
    const target = document.getElementById(targetId);
    if (!target) return;

    if (rows.length === 0) {
        target.innerHTML = '<div class="empty-panel">表示できるデータがありません。</div>';
        return;
    }

    target.innerHTML = `
        <table class="insight-table">
            <thead>
                <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
            </tbody>
        </table>
    `;
}

function renderPillList(targetId, items) {
    const target = document.getElementById(targetId);
    if (!target) return;
    if (items.length === 0) {
        target.innerHTML = '<div class="empty-panel">表示できるデータがありません。</div>';
        return;
    }
    target.innerHTML = items.map((item) => `
        <span class="dashboard-pill">${escapeHtml(item.label)}: ${escapeHtml(item.value ?? item.count)}</span>
    `).join('');
}

function renderError(message) {
    [
        'insights-summary',
        'health-check-list',
        'recommendation-list',
        'dashboard-monthly-trend',
        'dashboard-department-load',
        'dashboard-top-themes',
        'dashboard-department-summary',
        'dashboard-category-distribution',
        'dashboard-status-distribution',
    ].forEach((targetId) => {
        const target = document.getElementById(targetId);
        if (target) {
            target.innerHTML = `<div class="empty-panel">${escapeHtml(message)}</div>`;
        }
    });
}

function labelSeverity(severity) {
    const labels = {
        high: '高',
        medium: '中',
        low: '低',
    };
    return labels[severity] || severity;
}

function localizeStatus(status) {
    return STATUS_LABELS[status] || status;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
