import { insights } from './api.js';
import { loadViewState, subscribeViewState, updateViewState } from './shared-state.js';
import { addMonths, getVisibleMonths } from './utils/date-utils.js';
import { formatError, setBusyState } from './ui.js';

let currentState = loadViewState();
let ribbonOverlayInitialized = false;
let activeRibbonData = null;

const HEALTH_CATEGORY_LABELS = {
    resource_operations: '配員運営',
    future_risk: '将来逼迫',
    data_quality: 'データ整合性',
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
        renderFocusPanels(overview.summary || {}, overview.dashboard || {}, overview.health_groups || []);
        renderHealthChecks(overview.health_checks || [], overview.health_groups || []);
        renderRecommendations(overview.recommendations || []);
        renderDashboard(overview.dashboard || {}, overview.health_groups || []);
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
            <div class="summary-label">不足工数</div>
            <div class="summary-value">${summary.total_shortage || 0}%</div>
            <div class="summary-subtext">超過セル ${summary.warning_cell_count || 0} 件</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">余剰工数</div>
            <div class="summary-value">${summary.total_spare || 0}%</div>
            <div class="summary-subtext">低稼働メンバー ${summary.underutilized_member_count || 0} 名</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">逼迫部門</div>
            <div class="summary-value">${summary.bottleneck_department_count || 0}</div>
            <div class="summary-subtext">平均負荷 ${summary.average_member_load || 0}%</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">先行警戒月</div>
            <div class="summary-value">${summary.upcoming_shortage_months || 0}</div>
            <div class="summary-subtext">過負荷メンバー ${summary.overloaded_member_count || 0} 名</div>
        </article>
    `;
}

function renderFocusPanels(summary, dashboard, healthGroups) {
    const forecast = dashboard.forecast || [];
    const departmentLoad = dashboard.department_load || [];

    renderPillList('insights-gap-overview', [
        { label: '不足', value: `${summary.total_shortage || 0}%` },
        { label: '余剰', value: `${summary.total_spare || 0}%` },
        { label: '改善候補', value: `${summary.recommendation_count || 0} 件` },
        { label: '稼働中テーマ', value: `${summary.active_theme_count || 0} 件` },
    ]);

    const imbalancedDepartments = departmentLoad
        .filter((item) => item.overloaded_member_count > 0 || item.spread >= 40 || item.shortage_total > 0)
        .sort((left, right) => (right.shortage_total + right.spread) - (left.shortage_total + left.spread))
        .slice(0, 4)
        .map((item) => ({
            label: item.department,
            value: `不足${item.shortage_total}% / ばらつき${item.spread}%`,
        }));
    renderPillList('insights-department-imbalance', imbalancedDepartments);

    const forecastAlerts = forecast
        .filter((item) => item.shortage > 0 || item.overloaded_member_count > 0)
        .slice(0, 4)
        .map((item) => ({
            label: item.month,
            value: item.shortage > 0
                ? `不足${item.shortage}% / 過負荷${item.overloaded_member_count}名`
                : `過負荷${item.overloaded_member_count}名`,
        }));
    if (!forecastAlerts.length && forecast[0]) {
        forecastAlerts.push({
            label: forecast[0].month,
            value: `余剰${forecast[0].spare}%`,
        });
    }
    renderPillList('insights-forecast-watch', forecastAlerts.length ? forecastAlerts : healthGroups.map((group) => ({
        label: group.label,
        value: `${group.count} 件`,
    })).slice(0, 3));
}

function renderHealthChecks(items, healthGroups) {
    const target = document.getElementById('health-check-list');
    if (!target) return;

    if (items.length === 0) {
        target.innerHTML = '<div class="empty-panel">重大な健全性リスクは見つかりませんでした。</div>';
        return;
    }

    const groupedMarkup = healthGroups.map((group) => `
        <article class="insight-item insight-group-card">
            <div class="insight-header">
                <strong>${escapeHtml(group.label)}</strong>
                <span>${group.count} 件 / 高 ${group.high_count} 件</span>
            </div>
            <div class="candidate-body">
                ${(group.items || []).slice(0, 3).map((item) => `
                    <span class="dashboard-pill">${escapeHtml(item.entity_name || item.code)} / ${labelSeverity(item.severity)}</span>
                `).join('') || '<span class="summary-subtext">該当なし</span>'}
            </div>
        </article>
    `).join('');

    const topItemsMarkup = items.slice(0, 8).map((item) => `
        <article class="insight-item insight-${item.severity}">
            <div class="insight-header">
                <strong>${labelSeverity(item.severity)}</strong>
                <span>${escapeHtml(item.entity_name || item.code)}</span>
            </div>
            <div class="insight-meta-row">
                <span class="dashboard-pill">${escapeHtml(HEALTH_CATEGORY_LABELS[item.category] || item.category || '未分類')}</span>
                <span class="summary-subtext">${escapeHtml(item.code)}</span>
            </div>
            <p>${escapeHtml(item.message || '')}</p>
            <div class="insight-actions">
                ${buildHealthAction(item)}
            </div>
        </article>
    `).join('');

    target.innerHTML = `${groupedMarkup}${topItemsMarkup}`;
    bindActionButtons(target);
}

function renderRecommendations(items) {
    const target = document.getElementById('recommendation-list');
    if (!target) return;

    if (items.length === 0) {
        target.innerHTML = '<div class="empty-panel">現時点では再配置が必要な超過はありません。</div>';
        return;
    }

    target.innerHTML = items.slice(0, 6).map((item) => {
        const best = item.best_option;
        return `
            <article class="insight-item">
                <div class="insight-header">
                    <strong>${escapeHtml(item.display_name)}</strong>
                    <span>${escapeHtml(item.month)} / ${item.load}% / 容量 ${item.capacity}%</span>
                </div>
                <div class="insight-meta-row">
                    <span class="dashboard-pill">超過 ${item.excess}%</span>
                    ${best ? `<span class="dashboard-pill">最大解消 ${best.resolution_ratio}% </span>` : ''}
                </div>
                ${best ? `
                    <p>
                        ${escapeHtml(best.theme_name)} を ${escapeHtml(best.display_name)} に ${best.feasible_shift}% 移すと、
                        元の負荷は ${best.source_load_after_shift}% まで下がります。
                    </p>
                ` : '<p>受け手候補が見つかりませんでした。優先順位の再調整かテーマ分割が必要です。</p>'}
                <div class="candidate-list">
                    ${item.themes.map((theme) => `
                        <div class="candidate-card">
                            <div class="candidate-title">${escapeHtml(theme.theme_name)} / 移管候補 ${theme.suggested_shift}% / 解消率 ${theme.recommended_resolution_ratio}%</div>
                            <div class="candidate-body">
                                ${(theme.candidate_members || []).map((member) => `
                                    <span class="candidate-chip">
                                        ${escapeHtml(member.display_name)}
                                        (${member.current_load}% -> ${member.target_load_after_shift}% / 解消 ${member.resolution_ratio}%)
                                    </span>
                                `).join('') || '<span class="summary-subtext">受け手候補なし</span>'}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="insight-actions">
                    <button class="btn btn-ghost btn-sm" type="button" data-open-view="member-load" data-member-search="${escapeHtmlAttr(item.display_name)}">負荷表で確認</button>
                    ${best ? `<button class="btn btn-ghost btn-sm" type="button" data-open-view="gantt" data-theme-filter="${escapeHtmlAttr(best.theme_name)}">テーマを開く</button>` : ''}
                </div>
            </article>
        `;
    }).join('');

    bindActionButtons(target);
}

function renderDashboard(dashboard, healthGroups) {
    renderSimpleTable(
        'dashboard-monthly-trend',
        ['月', '需要', '余剰', '不足', '稼働テーマ'],
        (dashboard.monthly_trend || []).map((item) => [
            item.month,
            `${item.total_allocation}%`,
            `${item.spare || 0}%`,
            `${item.shortage || 0}%`,
            String(item.active_theme_count),
        ]),
    );

    renderProjectRibbon('dashboard-project-ribbon', dashboard.project_ribbon || {});

    renderSimpleTable(
        'dashboard-department-load',
        ['部門', '平均', '最大', '偏在', '不足', '過負荷人数'],
        (dashboard.department_load || []).map((item) => [
            item.department,
            `${item.average_load}%`,
            `${item.peak_load}%`,
            `${item.spread}%`,
            `${item.shortage_total}%`,
            String(item.overloaded_member_count),
        ]),
    );

    renderSimpleTable(
        'dashboard-impact-themes',
        ['テーマ', '影響', '超過寄与', '集中度', '終了リスク'],
        (dashboard.impact_themes || []).map((item) => [
            item.name,
            String(item.impact_score),
            `${item.overload_contribution}%`,
            `${item.concentration_risk}%`,
            `${item.deadline_risk}%`,
        ]),
    );

    renderSimpleTable(
        'dashboard-forecast-table',
        ['月', '需要', '容量', '不足', '余剰', '過負荷人数'],
        (dashboard.forecast || []).map((item) => [
            item.month,
            `${item.demand}%`,
            `${item.capacity}%`,
            `${item.shortage}%`,
            `${item.spare}%`,
            String(item.overloaded_member_count),
        ]),
    );

    renderSimpleTable(
        'dashboard-health-groups',
        ['分類', '件数', '高優先度', '代表例'],
        (healthGroups || []).map((group) => [
            group.label,
            String(group.count),
            String(group.high_count),
            (group.items || []).slice(0, 1).map((item) => item.entity_name || item.code).join(', ') || '-',
        ]),
    );
}

function buildHealthAction(item) {
    if (item.entity_type === 'member') {
        return `<button class="btn btn-ghost btn-sm" type="button" data-open-view="member-load" data-member-search="${escapeHtmlAttr(item.entity_name || '')}">負荷表で確認</button>`;
    }
    if (item.entity_type === 'theme' || item.entity_type === 'allocation') {
        return `<button class="btn btn-ghost btn-sm" type="button" data-open-view="gantt" data-theme-filter="${escapeHtmlAttr(item.entity_name || '')}">ガントで確認</button>`;
    }
    if (item.entity_type === 'department') {
        return `<button class="btn btn-ghost btn-sm" type="button" data-open-view="member-load">メンバー負荷を見る</button>`;
    }
    return '';
}

function bindActionButtons(root) {
    root.querySelectorAll('[data-open-view]').forEach((button) => {
        button.addEventListener('click', () => {
            const nextState = {};
            if (button.dataset.memberSearch) {
                nextState.memberSearch = button.dataset.memberSearch.trim().toLowerCase();
            }
            if (button.dataset.themeFilter) {
                nextState.ganttSearch = button.dataset.themeFilter;
            }
            updateViewState(nextState);
            document.querySelector(`.nav-item[data-view="${button.dataset.openView}"]`)?.click();
        });
    });
}

function renderProjectRibbon(targetId, ribbonData) {
    const target = document.getElementById(targetId);
    if (!target) return;

    const items = ribbonData.items || [];
    const hasProjects = items.some((item) => (item.projects || []).length > 0);
    if (!hasProjects) {
        target.innerHTML = '<div class="empty-panel">表示できるテーマ負荷データがありません。</div>';
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
        ? { top: 28, right: 24, bottom: 72, left: 56 }
        : { top: 20, right: 24, bottom: 64, left: 48 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const columnWidth = Math.min(fullscreen ? 80 : 68, Math.max(38, innerWidth / Math.max(items.length * 2.6, 1)));
    const plotWidth = Math.max(innerWidth - columnWidth - 12, 0);
    const step = items.length > 1 ? plotWidth / (items.length - 1) : 0;
    const maxTotalLoad = Math.max(ribbonData.max_total_load || 0, 1);

    const monthSegments = [];
    const totalsByTheme = new Map();
    const themeMetaById = new Map();

    items.forEach((item) => {
        (item.projects || []).forEach((project) => {
            totalsByTheme.set(project.theme_id, (totalsByTheme.get(project.theme_id) || 0) + project.load);
            if (!themeMetaById.has(project.theme_id)) {
                themeMetaById.set(project.theme_id, {
                    name: project.name,
                    color: project.color || '#6366f1',
                });
            }
        });
    });

    const themeOrder = Array.from(themeMetaById.keys()).sort((left, right) => {
        const totalDiff = (totalsByTheme.get(right) || 0) - (totalsByTheme.get(left) || 0);
        if (totalDiff !== 0) return totalDiff;
        const leftName = (themeMetaById.get(left)?.name || '').toLowerCase();
        const rightName = (themeMetaById.get(right)?.name || '').toLowerCase();
        if (leftName !== rightName) return leftName.localeCompare(rightName);
        return left - right;
    });
    const themeRank = new Map(themeOrder.map((themeId, index) => [themeId, index]));

    items.forEach((item, index) => {
        const totalLoad = item.total_load || 0;
        const stackHeight = totalLoad > 0 ? (innerHeight * totalLoad) / maxTotalLoad : 0;
        const stackTop = padding.top + innerHeight - stackHeight;
        let cursorY = stackTop;
        const segments = [];
        const projects = [...(item.projects || [])]
            .sort((left, right) => (themeRank.get(left.theme_id) || 0) - (themeRank.get(right.theme_id) || 0));
        const heights = normalizeRibbonHeights(projects, stackHeight);
        const x = padding.left + (columnWidth / 2) + (step * index);

        projects.forEach((project, projectIndex) => {
            const segmentHeight = heights[projectIndex] || 0;
            const segment = {
                ...project,
                month: item.month,
                x,
                y0: cursorY,
                y1: cursorY + segmentHeight,
            };
            cursorY += segmentHeight;
            segments.push(segment);
        });

        monthSegments.push({
            month: item.month,
            totalLoad,
            x,
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

    const axisValues = [0, 25, 50, 75, 100].filter((value) => value <= maxTotalLoad || value === 0);
    if (!axisValues.includes(maxTotalLoad)) axisValues.push(maxTotalLoad);
    const yAxis = axisValues
        .sort((left, right) => left - right)
        .map((value) => {
            const y = padding.top + innerHeight - ((innerHeight * value) / maxTotalLoad);
            return `
                <g>
                    <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="project-ribbon__grid-line"></line>
                    <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" class="project-ribbon__axis-label">${escapeHtml(String(value))}%</text>
                </g>
            `;
        });

    const monthHotspots = monthSegments.map((item) => {
        const details = [...item.segments]
            .sort((left, right) => right.load - left.load || left.name.localeCompare(right.name, 'ja'))
            .map((segment) => `${segment.name}: ${segment.load}%`);
        const tooltip = [`${item.month} 合計 ${item.totalLoad}%`, ...(details.length ? details : ['内訳なし'])].join('\n');
        return `
            <rect
                x="${item.x - (columnWidth / 2)}"
                y="${padding.top}"
                width="${columnWidth}"
                height="${innerHeight}"
                fill="transparent"
                pointer-events="all"
            >
                <title>${escapeHtml(tooltip)}</title>
            </rect>
        `;
    });

    const blocks = monthSegments.flatMap((item) => item.segments.map((segment) => {
        const color = segment.color || '#6366f1';
        const heightValue = Math.max(segment.y1 - segment.y0, 0.5);
        const labelLimit = fullscreen ? 18 : (columnWidth > 52 ? 14 : 10);
        const fontSize = heightValue < 18 ? 9 : (heightValue < 28 ? 10 : 11.5);
        return `
            <g>
                <rect
                    x="${segment.x - (columnWidth / 2)}"
                    y="${segment.y0}"
                    width="${columnWidth}"
                    height="${heightValue}"
                    rx="${Math.min(8, heightValue / 2)}"
                    ry="${Math.min(8, heightValue / 2)}"
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
                        style="font-size:${fontSize}px"
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
            <button class="btn btn-ghost btn-sm project-ribbon__nav" type="button" data-ribbon-nav="prev">前へ</button>
            <button class="btn btn-ghost btn-sm project-ribbon__nav" type="button" data-ribbon-nav="next">次へ</button>
            <span class="project-ribbon__toolbar-hint">横スクロールで推移を確認できます。</span>
        </div>
    ` : '';

    return `
        <div class="project-ribbon ${fullscreen ? 'project-ribbon--fullscreen' : 'project-ribbon--interactive'}" ${fullscreen ? '' : 'role="button" tabindex="0" aria-label="Open project load ribbon fullscreen"'}>
            ${fullscreenControls}
            <div class="project-ribbon__scroll" ${fullscreen ? `data-ribbon-step="${step}" data-ribbon-width="${width}"` : ''}>
                <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="project-ribbon__svg${fullscreen ? ' project-ribbon__svg--fullscreen' : ''}" role="img" aria-label="Project load ribbon chart">
                    <rect x="0" y="0" width="${width}" height="${height}" rx="18" ry="18" class="project-ribbon__bg"></rect>
                    <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerHeight}" class="project-ribbon__axis-line"></line>
                    ${yAxis.join('')}
                    ${ribbons.join('')}
                    ${blocks.join('')}
                    ${monthHotspots.join('')}
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

function normalizeRibbonHeights(projects, stackHeight) {
    if (!projects.length || stackHeight <= 0) return [];

    const totalLoad = projects.reduce((sum, project) => sum + project.load, 0);
    const rawHeights = projects.map((project) => (stackHeight * project.load) / Math.max(totalLoad, 1));
    const minHeight = stackHeight >= projects.length * 2 ? 2 : Math.max(stackHeight / projects.length, 0);
    const seeded = rawHeights.map((height) => Math.max(height, minHeight));
    const seededTotal = seeded.reduce((sum, height) => sum + height, 0);

    if (seededTotal <= stackHeight || seededTotal === 0) {
        return seeded;
    }

    const scale = stackHeight / seededTotal;
    const scaled = seeded.map((height) => height * scale);
    const scaledTotal = scaled.reduce((sum, height) => sum + height, 0);
    const difference = stackHeight - scaledTotal;

    if (!scaled.length) return scaled;
    scaled[scaled.length - 1] += difference;
    return scaled;
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

    if (!items.length) {
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
        'insights-gap-overview',
        'insights-department-imbalance',
        'insights-forecast-watch',
        'health-check-list',
        'recommendation-list',
        'dashboard-monthly-trend',
        'dashboard-project-ribbon',
        'dashboard-department-load',
        'dashboard-impact-themes',
        'dashboard-forecast-table',
        'dashboard-health-groups',
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

function escapeHtmlAttr(value) {
    return escapeHtml(value).replaceAll('`', '&#96;');
}
