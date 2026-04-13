import { insights } from './api.js';
import { loadViewState, subscribeViewState } from './shared-state.js';
import { addMonths, getVisibleMonths } from './utils/date-utils.js';
import { formatError, setBusyState } from './ui.js';

let currentState = loadViewState();

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
        setBusyState(true, 'Loading insights...');
        const overview = await insights.overview(from, toEnd);
        renderSummary(overview.summary || {});
        renderHealthChecks(overview.health_checks || []);
        renderRecommendations(overview.recommendations || []);
        renderDashboard(overview.dashboard || {});
    } catch (error) {
        renderError(formatError(error, 'Failed to load insights.'));
    } finally {
        setBusyState(false);
    }
}

function renderSummary(summary) {
    const target = document.getElementById('insights-summary');
    if (!target) return;

    target.innerHTML = `
        <article class="summary-card">
            <div class="summary-label">Health Issues</div>
            <div class="summary-value">${summary.health_issue_count || 0}</div>
            <div class="summary-subtext">Detected data quality risks</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">Recommendations</div>
            <div class="summary-value">${summary.recommendation_count || 0}</div>
            <div class="summary-subtext">Rebalancing suggestions</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">Tracked Themes</div>
            <div class="summary-value">${summary.theme_count || 0}</div>
            <div class="summary-subtext">Visible in current horizon</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">Tracked Members</div>
            <div class="summary-value">${summary.member_count || 0}</div>
            <div class="summary-subtext">Available for review</div>
        </article>
    `;
}

function renderHealthChecks(items) {
    const target = document.getElementById('health-check-list');
    if (!target) return;

    if (items.length === 0) {
        target.innerHTML = '<div class="empty-panel">No health issues detected in the selected period.</div>';
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
        target.innerHTML = '<div class="empty-panel">No rebalancing recommendation is needed right now.</div>';
        return;
    }

    target.innerHTML = items.map((item) => `
        <article class="insight-item">
            <div class="insight-header">
                <strong>${escapeHtml(item.display_name)}</strong>
                <span>${escapeHtml(item.month)} / ${item.load}% of ${item.capacity}%</span>
            </div>
            <p>Excess load: ${item.excess}%</p>
            <div class="candidate-list">
                ${item.themes.map((theme) => `
                    <div class="candidate-card">
                        <div class="candidate-title">${escapeHtml(theme.theme_name)}: move about ${theme.suggested_shift}%</div>
                        <div class="candidate-body">
                            ${(theme.candidate_members || []).map((member) => `
                                <span class="candidate-chip">
                                    ${escapeHtml(member.display_name)}
                                    (${member.current_load}%/${member.capacity}%)
                                </span>
                            `).join('') || '<span class="summary-subtext">No candidate found</span>'}
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
        ['Month', 'Allocation', 'Active Themes'],
        (dashboard.monthly_trend || []).map((item) => [item.month, `${item.total_allocation}%`, String(item.active_theme_count)]),
    );
    renderSimpleTable(
        'dashboard-department-load',
        ['Department', 'Avg Load', 'Members'],
        (dashboard.department_load || []).map((item) => [item.department, `${item.average_load}%`, String(item.member_count)]),
    );
    renderSimpleTable(
        'dashboard-top-themes',
        ['Theme', 'Status', 'Total Allocation'],
        (dashboard.top_themes || []).map((item) => [item.name, item.status, `${item.total_allocation}%`]),
    );
    renderPillList(
        'dashboard-category-distribution',
        dashboard.category_distribution || [],
    );
    renderPillList(
        'dashboard-status-distribution',
        dashboard.status_distribution || [],
    );
}

function renderSimpleTable(targetId, headers, rows) {
    const target = document.getElementById(targetId);
    if (!target) return;

    if (rows.length === 0) {
        target.innerHTML = '<div class="empty-panel">No data available.</div>';
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
        target.innerHTML = '<div class="empty-panel">No data available.</div>';
        return;
    }
    target.innerHTML = items.map((item) => `
        <span class="dashboard-pill">${escapeHtml(item.label)}: ${item.count}</span>
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
        high: 'High',
        medium: 'Medium',
        low: 'Low',
    };
    return labels[severity] || severity;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
