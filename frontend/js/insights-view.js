import { insights } from './api.js';
import { loadViewState, subscribeViewState } from './shared-state.js';
import { addMonths, getVisibleMonths } from './utils/date-utils.js';
import { formatError, setBusyState } from './ui.js';

let currentState = loadViewState();
let ribbonOverlayInitialized = false;
let activeRibbonData = null;

const STATUS_LABELS = {
    planning: '計画中',
    active: '進行中',
    completed: '完了',
    cancelled: '中止',
};

export async function initInsightsView() {
    initRibbonFullscreen();
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
            <div class="summary-subtext">超過メンバー ${summary.overloaded_member_count || 0} 名</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">配分中メンバー</div>
            <div class="summary-value">${summary.assigned_member_count || 0}</div>
            <div class="summary-subtext">テーマに配分あり</div>
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
        target.innerHTML = '<div class="empty-panel">重大な整合性エラーは見つかりませんでした。</div>';
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
        target.innerHTML = '<div class="empty-panel">現時点では再配分候補はありません。</div>';
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
                            `).join('') || '<span class="summary-subtext">移管候補は見つかりませんでした</span>'}
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
        ['月度', '総配分率', '稼働テーマ数'],
        (dashboard.monthly_trend || []).map((item) => [item.month, `${item.total_allocation}%`, String(item.active_theme_count)]),
    );
    renderProjectRibbon('dashboard-project-ribbon', dashboard.project_ribbon || {});
    renderSimpleTable(
        'dashboard-department-load',
        ['部署', '平均負荷', '人数'],
        (dashboard.department_load || []).map((item) => [item.department, `${item.average_load}%`, String(item.member_count)]),
    );
    renderSimpleTable(
        'dashboard-top-themes',
        ['テーマ', 'ステータス', '総負荷'],
        (dashboard.top_themes || []).map((item) => [item.name, localizeStatus(item.status), `${item.total_allocation}%`]),
    );
}

function renderProjectRibbon(targetId, ribbonData) {
    const target = document.getElementById(targetId);
    if (!target) return;

    const items = ribbonData.items || [];
    const hasProjects = items.some((item) => (item.projects || []).length > 0);
    if (!hasProjects) {
        target.innerHTML = '<div class="empty-panel">表示できるプロジェクト負荷データがありません。</div>';
        return;
    }

    activeRibbonData = ribbonData;
    target.innerHTML = buildProjectRibbonMarkup(ribbonData, { fullscreen: false });

    const interactiveRibbon = target.querySelector('.project-ribbon--interactive');
    interactiveRibbon?.addEventListener('click', () => openRibbonFullscreen(ribbonData));
    interactiveRibbon?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openRibbonFullscreen(ribbonData);
        }
    });
}

function buildProjectRibbonMarkup(ribbonData, { fullscreen = false } = {}) {
    const items = fullscreen ? trimRibbonItemsForFullscreen(ribbonData.items || []) : (ribbonData.items || []);
    const width = Math.max(fullscreen ? 1120 : 640, items.length * (fullscreen ? 220 : 140));
    const height = fullscreen ? 760 : 340;
    const padding = fullscreen
        ? { top: 28, right: 24, bottom: 72, left: 24 }
        : { top: 20, right: 24, bottom: 64, left: 24 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const columnWidth = Math.min(fullscreen ? 80 : 68, Math.max(38, innerWidth / Math.max(items.length * 2.6, 1)));
    const step = items.length > 1 ? innerWidth / (items.length - 1) : 0;
    const maxTotalLoad = Math.max(ribbonData.max_total_load || 0, 1);

    const monthSegments = [];
    const totalsByTheme = new Map();

    items.forEach((item, index) => {
        const totalLoad = item.total_load || 0;
        const stackHeight = totalLoad > 0 ? (innerHeight * totalLoad) / maxTotalLoad : 0;
        const stackTop = padding.top + innerHeight - stackHeight;
        let cursorY = stackTop;
        const segments = [];

        (item.projects || []).forEach((project) => {
            const rawHeight = totalLoad > 0 ? (stackHeight * project.load) / totalLoad : 0;
            const segmentHeight = Math.max(rawHeight, 2);
            const segment = {
                ...project,
                month: item.month,
                x: padding.left + (step * index),
                y0: cursorY,
                y1: cursorY + segmentHeight,
            };
            cursorY += segmentHeight;
            segments.push(segment);
            totalsByTheme.set(project.theme_id, (totalsByTheme.get(project.theme_id) || 0) + project.load);
        });

        monthSegments.push({
            month: item.month,
            totalLoad,
            x: padding.left + (step * index),
            segments,
        });
    });

    const ribbons = [];
    for (let index = 0; index < monthSegments.length - 1; index += 1) {
        const current = monthSegments[index];
        const next = monthSegments[index + 1];
        const nextMap = new Map(next.segments.map((segment) => [segment.theme_id, segment]));

        current.segments.forEach((segment) => {
            const nextSegment = nextMap.get(segment.theme_id);
            if (!nextSegment) return;
            const color = segment.color || '#6366f1';
            ribbons.push(`
                <path
                    d="${buildRibbonPath(segment, nextSegment, columnWidth)}"
                    fill="${escapeHtml(color)}"
                    fill-opacity="0.42"
                    stroke="${escapeHtml(color)}"
                    stroke-opacity="0.6"
                    stroke-width="1"
                >
                    <title>${escapeHtml(`${segment.name}: ${segment.month} ${segment.load}% -> ${nextSegment.month} ${nextSegment.load}%`)}</title>
                </path>
            `);
        });
    }

    const blocks = monthSegments.flatMap((item) => item.segments.map((segment) => {
        const color = segment.color || '#6366f1';
        const heightValue = Math.max(segment.y1 - segment.y0, 2);
        const labelLimit = fullscreen ? 18 : (columnWidth > 52 ? 14 : 10);
        return `
            <g>
                <rect
                    x="${segment.x - (columnWidth / 2)}"
                    y="${segment.y0}"
                    width="${columnWidth}"
                    height="${heightValue}"
                    rx="8"
                    ry="8"
                    fill="${escapeHtml(color)}"
                    fill-opacity="0.85"
                >
                    <title>${escapeHtml(`${segment.month} | ${segment.name} | ${segment.load}%`)}</title>
                </rect>
                ${heightValue >= 18 ? `
                    <text
                        x="${segment.x}"
                        y="${segment.y0 + (heightValue / 2) + 4}"
                        text-anchor="middle"
                        class="project-ribbon__block-label"
                    >${escapeHtml(truncateLabel(segment.name, labelLimit))}</text>
                ` : ''}
            </g>
        `;
    }));

    const monthLabels = monthSegments.map((item) => `
        <g>
            <text x="${item.x}" y="${height - 28}" text-anchor="middle" class="project-ribbon__month-label">${escapeHtml(formatRibbonMonth(item.month))}</text>
            <text x="${item.x}" y="${height - 10}" text-anchor="middle" class="project-ribbon__total-label">Total ${escapeHtml(String(item.totalLoad))}%</text>
        </g>
    `);

    const topThemes = Array.from(totalsByTheme.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 6)
        .map(([themeId]) => monthSegments.flatMap((item) => item.segments).find((segment) => segment.theme_id === themeId))
        .filter(Boolean);

    const fullscreenControls = fullscreen ? `
        <div class="project-ribbon__toolbar">
            <button class="btn btn-ghost btn-sm project-ribbon__nav" type="button" data-ribbon-nav="prev">前の月</button>
            <button class="btn btn-ghost btn-sm project-ribbon__nav" type="button" data-ribbon-nav="next">次の月</button>
            <span class="project-ribbon__toolbar-hint">横スクロールでも移動できます</span>
        </div>
    ` : '';

    return `
        <div class="project-ribbon ${fullscreen ? 'project-ribbon--fullscreen' : 'project-ribbon--interactive'}" ${fullscreen ? '' : 'role="button" tabindex="0" aria-label="Open project load ribbon fullscreen"'}>
            ${fullscreenControls}
            <div class="project-ribbon__scroll" ${fullscreen ? `data-ribbon-step="${step}" data-ribbon-width="${width}"` : ''}>
                <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="project-ribbon__svg${fullscreen ? ' project-ribbon__svg--fullscreen' : ''}" role="img" aria-label="Project load ribbon chart">
                    <rect x="0" y="0" width="${width}" height="${height}" rx="18" ry="18" class="project-ribbon__bg"></rect>
                    ${ribbons.join('')}
                    ${blocks.join('')}
                    ${monthLabels.join('')}
                </svg>
            </div>
            <div class="project-ribbon__legend">
                ${topThemes.map((project) => `
                    <span class="project-ribbon__legend-item">
                        <span class="project-ribbon__legend-swatch" style="background:${escapeHtml(project.color || '#6366f1')}"></span>
                        ${escapeHtml(project.name)}
                    </span>
                `).join('')}
            </div>
        </div>
    `;
}

function trimRibbonItemsForFullscreen(items) {
    if (!items.length) return items;

    const activeIndexes = items
        .map((item, index) => (((item.projects || []).length > 0 || (item.total_load || 0) > 0) ? index : -1))
        .filter((index) => index >= 0);

    if (!activeIndexes.length) return items;

    const firstIndex = Math.max(0, activeIndexes[0] - 1);
    const lastIndex = Math.min(items.length - 1, activeIndexes[activeIndexes.length - 1] + 1);
    return items.slice(firstIndex, lastIndex + 1);
}

function initRibbonFullscreen() {
    if (ribbonOverlayInitialized) return;
    ribbonOverlayInitialized = true;

    const overlay = document.getElementById('ribbon-fullscreen-overlay');
    const closeButton = document.getElementById('ribbon-fullscreen-close');

    closeButton?.addEventListener('click', closeRibbonFullscreen);
    overlay?.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeRibbonFullscreen();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && overlay && !overlay.hidden) {
            event.preventDefault();
            closeRibbonFullscreen();
        }
    });
}

function openRibbonFullscreen(ribbonData = activeRibbonData) {
    const overlay = document.getElementById('ribbon-fullscreen-overlay');
    const content = document.getElementById('ribbon-fullscreen-content');
    if (!overlay || !content || !ribbonData) return;

    activeRibbonData = ribbonData;
    content.innerHTML = buildProjectRibbonMarkup(ribbonData, { fullscreen: true });
    bindRibbonFullscreenNavigation(content);
    overlay.hidden = false;
}

function closeRibbonFullscreen() {
    const overlay = document.getElementById('ribbon-fullscreen-overlay');
    const content = document.getElementById('ribbon-fullscreen-content');
    if (!overlay || !content) return;

    overlay.hidden = true;
    content.innerHTML = '';
}

function buildRibbonPath(source, target, columnWidth) {
    const startX = source.x + (columnWidth / 2);
    const endX = target.x - (columnWidth / 2);
    const controlOffset = Math.max((endX - startX) * 0.45, 24);

    return [
        `M ${startX} ${source.y0}`,
        `C ${startX + controlOffset} ${source.y0}, ${endX - controlOffset} ${target.y0}, ${endX} ${target.y0}`,
        `L ${endX} ${target.y1}`,
        `C ${endX - controlOffset} ${target.y1}, ${startX + controlOffset} ${source.y1}, ${startX} ${source.y1}`,
        'Z',
    ].join(' ');
}

function bindRibbonFullscreenNavigation(container) {
    const scrollEl = container.querySelector('.project-ribbon__scroll');
    if (!scrollEl) return;

    container.querySelectorAll('[data-ribbon-nav]').forEach((button) => {
        button.addEventListener('click', () => {
            const direction = button.dataset.ribbonNav === 'prev' ? -1 : 1;
            const svg = scrollEl.querySelector('.project-ribbon__svg');
            const viewWidth = Number(scrollEl.dataset.ribbonWidth) || 1;
            const viewStep = Number(scrollEl.dataset.ribbonStep) || 0;
            const scale = svg ? svg.clientWidth / viewWidth : 1;
            const amount = Math.max(viewStep * scale, scrollEl.clientWidth * 0.4, 160);
            scrollEl.scrollBy({ left: direction * amount, behavior: 'smooth' });
        });
    });
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
        'dashboard-project-ribbon',
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

    closeRibbonFullscreen();
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

function formatRibbonMonth(month) {
    if (!month || month.length < 7) return month;
    return `${month.slice(0, 4)}/${month.slice(5, 7)}`;
}

function truncateLabel(value, maxLength) {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(maxLength - 1, 1))}…`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
