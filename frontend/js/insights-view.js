import { insights } from './api.js';
import { showScenarioPreview } from './gantt/gantt-renderer.js';
import { loadViewState, subscribeViewState, updateViewState } from './shared-state.js';
import { addMonths, getVisibleMonths } from './utils/date-utils.js';
import { formatError, setBusyState } from './ui.js';

let currentState = loadViewState();
let ribbonOverlayInitialized = false;
let activeRibbonData = null;
let ribbonXAxisScale = Number.parseFloat(localStorage.getItem('project_ribbon_x_scale') || '1');
let currentOverview = null;
let currentScenarioResult = null;
const SMALL_RIBBON_LOAD_THRESHOLD = 30;

const HEALTH_CATEGORY_LABELS = {
    resource_operations: '配員運営',
    future_risk: '将来逼迫',
    data_quality: 'データ整合性',
};

export async function initInsightsView() {
    initRibbonFullscreen();
    initScenarioPlanner();
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
        currentOverview = overview;
        renderFocusPanels(overview.summary || {}, overview.dashboard || {}, overview.health_groups || []);
        renderDashboard(overview.dashboard || {}, overview.health_groups || []);
        renderScenarioPlanner(overview);
        if (currentScenarioResult) {
            renderScenarioResults(currentScenarioResult);
        }
        renderProjectRibbon('dashboard-project-ribbon', overview.dashboard?.project_ribbon || {});
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
    bindRibbonScaleControls(target);

    const interactiveRibbon = target.querySelector('.project-ribbon--interactive');
    interactiveRibbon?.addEventListener('click', (event) => {
        if (event.target?.closest?.('.project-ribbon__toolbar')) return;
        openRibbonFullscreen(ribbonData);
    });
    interactiveRibbon?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openRibbonFullscreen(ribbonData);
        }
    });
}

function buildProjectRibbonMarkup(ribbonData, { fullscreen = false } = {}) {
    const items = fullscreen ? trimRibbonItemsForFullscreen(ribbonData.items || []) : (ribbonData.items || []);
    const xScale = Math.min(1.4, Math.max(0.45, ribbonXAxisScale || 1));
    const width = Math.max(fullscreen ? 1120 : 640, items.length * (fullscreen ? 220 : 140) * xScale);
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

    const explicitThemeOrder = (ribbonData.theme_order || []).filter((themeId) => themeMetaById.has(themeId));
    const fallbackThemeOrder = Array.from(themeMetaById.keys()).sort((left, right) => {
        const totalDiff = (totalsByTheme.get(right) || 0) - (totalsByTheme.get(left) || 0);
        if (totalDiff !== 0) return totalDiff;
        const leftName = (themeMetaById.get(left)?.name || '').toLowerCase();
        const rightName = (themeMetaById.get(right)?.name || '').toLowerCase();
        if (leftName !== rightName) return leftName.localeCompare(rightName);
        return left - right;
    });
    const themeOrder = explicitThemeOrder.length
        ? [...explicitThemeOrder, ...fallbackThemeOrder.filter((themeId) => !explicitThemeOrder.includes(themeId))]
        : fallbackThemeOrder;
    const themeRank = new Map(themeOrder.map((themeId, index) => [themeId, index]));
    const formatRibbonMemberBreakdown = (segment) => {
        if (!segment) return ['担当内訳なし'];
        if ((segment.member_breakdown || []).length) {
            return segment.member_breakdown.map((member) => `${member.display_name}: ${member.load}%`);
        }
        return ['担当内訳なし'];
    };

    items.forEach((item, index) => {
        const totalLoad = item.total_load || 0;
        const stackHeight = totalLoad > 0 ? (innerHeight * totalLoad) / maxTotalLoad : 0;
        const stackTop = padding.top + innerHeight - stackHeight;
        let cursorY = stackTop;
        const segments = [];
        const projects = [...(item.projects || [])]
            .sort((left, right) => {
                const loadDiff = (right.load || 0) - (left.load || 0);
                if (loadDiff !== 0) return loadDiff;
                return (themeRank.get(left.theme_id) || 0) - (themeRank.get(right.theme_id) || 0);
            });
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
            const tooltipLines = [
                `${segment.name}`,
                `${segment.month}: ${segment.load}%`,
                ...formatRibbonMemberBreakdown(segment),
                `${nextSegment.month}: ${nextSegment.load}%`,
                ...formatRibbonMemberBreakdown(nextSegment),
            ];
            ribbons.push(`
                <path
                    d="${buildRibbonPath(segment, nextSegment, columnWidth)}"
                    fill="${escapeHtml(color)}"
                    fill-opacity="0.42"
                    stroke="${escapeHtml(color)}"
                    stroke-opacity="0.6"
                    stroke-width="1"
                >
                    <title>${escapeHtml(tooltipLines.join('\n'))}</title>
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

    const segmentHotspots = monthSegments.flatMap((item) => item.segments.map((segment) => {
        const tooltipLines = [
            `${segment.month} | ${segment.name} | ${segment.load}%`,
            ...formatRibbonMemberBreakdown(segment),
        ];
        return `
            <rect
                x="${segment.x - (columnWidth / 2)}"
                y="${segment.y0}"
                width="${columnWidth}"
                height="${Math.max(segment.y1 - segment.y0, 0.5)}"
                fill="transparent"
                pointer-events="all"
            >
                <title>${escapeHtml(tooltipLines.join('\n'))}</title>
            </rect>
        `;
    }));

    const blocks = monthSegments.flatMap((item) => item.segments.map((segment) => {
        const color = segment.color || '#6366f1';
        const heightValue = Math.max(segment.y1 - segment.y0, 0.5);
        const isSmallLoad = (segment.load || 0) <= SMALL_RIBBON_LOAD_THRESHOLD;
        const labelLimit = isSmallLoad
            ? (fullscreen ? 12 : 8)
            : (fullscreen ? 18 : (columnWidth > 52 ? 14 : 10));
        const fontSize = isSmallLoad
            ? (fullscreen ? 8.5 : 7.5)
            : (heightValue < 18 ? 9 : (heightValue < 28 ? 10 : 11.5));
        const shouldRenderLabel = heightValue >= (isSmallLoad ? 10 : 18);
        const tooltipLines = [
            `${segment.month} | ${segment.name} | ${segment.load}%`,
            ...formatRibbonMemberBreakdown(segment),
        ];
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
                    <title>${escapeHtml(tooltipLines.join('\n'))}</title>
                </rect>
                ${shouldRenderLabel ? `
                    <text
                        x="${segment.x}"
                        y="${segment.y0 + (heightValue / 2) + 4}"
                        text-anchor="middle"
                        class="project-ribbon__block-label"
                        data-small-load="${isSmallLoad ? 'true' : 'false'}"
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

    const scaleControl = `
        <label class="project-ribbon__scale-control">
            <span>時間軸</span>
            <input type="range" min="45" max="140" step="5" value="${Math.round(xScale * 100)}" data-ribbon-x-scale>
            <span>${Math.round(xScale * 100)}%</span>
        </label>
    `;
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
            <div class="project-ribbon__toolbar project-ribbon__toolbar--scale">${scaleControl}</div>
            <div class="project-ribbon__scroll" ${fullscreen ? `data-ribbon-step="${step}" data-ribbon-width="${width}"` : ''}>
                <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="project-ribbon__svg${fullscreen ? ' project-ribbon__svg--fullscreen' : ''}" role="img" aria-label="Project load ribbon chart">
                    <rect x="0" y="0" width="${width}" height="${height}" rx="18" ry="18" class="project-ribbon__bg"></rect>
                    <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerHeight}" class="project-ribbon__axis-line"></line>
                    ${yAxis.join('')}
                    ${ribbons.join('')}
                    ${blocks.join('')}
                    ${monthHotspots.join('')}
                    ${segmentHotspots.join('')}
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
    bindRibbonScaleControls(content);
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

function bindRibbonScaleControls(container) {
    container.querySelectorAll('[data-ribbon-x-scale]').forEach((input) => {
        input.addEventListener('click', (event) => event.stopPropagation());
        input.addEventListener('input', () => {
            ribbonXAxisScale = Math.min(1.4, Math.max(0.45, Number(input.value) / 100));
            localStorage.setItem('project_ribbon_x_scale', String(ribbonXAxisScale));
            if (!activeRibbonData) return;

            renderProjectRibbon('dashboard-project-ribbon', activeRibbonData);

            const overlay = document.getElementById('ribbon-fullscreen-overlay');
            const content = document.getElementById('ribbon-fullscreen-content');
            if (overlay && content && !overlay.hidden) {
                content.innerHTML = buildProjectRibbonMarkup(activeRibbonData, { fullscreen: true });
                bindRibbonScaleControls(content);
                bindRibbonFullscreenNavigation(content);
            }
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

function initScenarioPlanner() {
    const form = document.getElementById('insight-scenario-form');
    const modeSelect = document.getElementById('insight-scenario-mode');
    if (!form) return;

    if (!form.dataset.bound) {
        form.dataset.bound = 'true';
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            await submitScenarioPlanner();
        });
    }

    if (modeSelect && !modeSelect.dataset.bound) {
        modeSelect.dataset.bound = 'true';
        modeSelect.addEventListener('change', updateScenarioHint);
    }
}

function renderScenarioPlanner(overview) {
    const dashboard = overview?.dashboard || {};
    const themeSelect = document.getElementById('insight-scenario-theme');
    const departmentSelect = document.getElementById('insight-scenario-department');
    const startMonthInput = document.getElementById('insight-scenario-start-month');

    if (themeSelect) {
        const currentValue = themeSelect.value;
        const options = [{ theme_id: '', name: '新規プロジェクトとして検討' }, ...(dashboard.theme_options || [])];
        themeSelect.innerHTML = options.map((item) => `
            <option value="${escapeHtmlAttr(item.theme_id ?? '')}">${escapeHtml(item.name)}</option>
        `).join('');
        if ([...themeSelect.options].some((option) => option.value === currentValue)) {
            themeSelect.value = currentValue;
        }
    }

    if (departmentSelect) {
        const currentValue = departmentSelect.value;
        const options = [''].concat(dashboard.department_options || []);
        departmentSelect.innerHTML = options.map((item) => `
            <option value="${escapeHtmlAttr(item)}">${item ? escapeHtml(item) : 'こだわらない'}</option>
        `).join('');
        if ([...departmentSelect.options].some((option) => option.value === currentValue)) {
            departmentSelect.value = currentValue;
        }
    }

    if (startMonthInput && !startMonthInput.value) {
        startMonthInput.value = currentState.startMonth || '';
    }

    updateScenarioHint();
}

function updateScenarioHint() {
    const mode = document.getElementById('insight-scenario-mode')?.value || 'start_fixed';
    const hint = document.getElementById('insight-scenario-hint');
    if (!hint) return;
    hint.textContent = mode === 'keep_schedule'
        ? '既存スケジュールを動かさず、最短で入れられる開始月と担当候補を返します。'
        : '開始月を固定して、割当候補と必要なら後ろ倒し候補を返します。';
}

async function submitScenarioPlanner() {
    const submitButton = document.getElementById('insight-scenario-submit');
    const payload = {
        mode: document.getElementById('insight-scenario-mode')?.value || 'start_fixed',
        target_theme_id: document.getElementById('insight-scenario-theme')?.value || '',
        start_month: normalizeMonthInput(document.getElementById('insight-scenario-start-month')?.value),
        duration_months: Number.parseInt(document.getElementById('insight-scenario-duration')?.value || '0', 10),
        effort_person_months: Number.parseFloat(document.getElementById('insight-scenario-effort')?.value || '0'),
        preferred_department: document.getElementById('insight-scenario-department')?.value || '',
    };

    if (!payload.start_month || !payload.duration_months || !payload.effort_person_months) {
        renderScenarioMessage('開始月・期間・必要工数を入力してください。');
        return;
    }

    try {
        if (submitButton) submitButton.disabled = true;
        renderScenarioMessage('候補を計算しています...');
        currentScenarioResult = await insights.scenarioSuggestions(payload);
        renderScenarioResults(currentScenarioResult);
    } catch (error) {
        renderScenarioMessage(formatError(error, '候補の計算に失敗しました。'));
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

function renderScenarioMessage(message) {
    const target = document.getElementById('insight-scenario-results');
    if (!target) return;
    target.innerHTML = `<div class="empty-panel">${escapeHtml(message)}</div>`;
}

function renderScenarioResults(result) {
    const target = document.getElementById('insight-scenario-results');
    if (!target) return;

    const candidates = result?.candidates || [];
    if (!candidates.length) {
        target.innerHTML = '<div class="empty-panel">候補は見つかりませんでした。</div>';
        return;
    }

    target.innerHTML = candidates.map((candidate, index) => `
        <article class="insight-scenario-card${candidate.recommended ? ' is-recommended' : ''}">
            <div class="insight-scenario-header">
                <div>
                    <div class="candidate-body">
                        <span class="dashboard-pill">${escapeHtml(getScenarioCandidateLabel(index))}</span>
                    </div>
                    <strong>${escapeHtml(candidate.title || `候補 ${index + 1}`)}</strong>
                    <p class="summary-subtext">${escapeHtml(candidate.summary || '')}</p>
                </div>
                <div class="insight-scenario-meta">
                    ${candidate.recommended ? '<span class="dashboard-pill">おすすめ</span>' : ''}
                    <span class="dashboard-pill">開始 ${escapeHtml(candidate.start_month || '-')}</span>
                    <span class="dashboard-pill">充足率 ${escapeHtml(String(candidate.coverage_ratio || 0))}%</span>
                </div>
            </div>
            <div class="insight-scenario-grid">
                <div class="insight-scenario-stat">
                    <span class="summary-subtext">不足工数</span>
                    <strong>${escapeHtml(formatPersonMonths(candidate.uncovered_person_months))} 人月</strong>
                </div>
                <div class="insight-scenario-stat">
                    <span class="summary-subtext">関与人数</span>
                    <strong>${escapeHtml(String(candidate.affected_member_count || 0))} 人</strong>
                </div>
                <div class="insight-scenario-stat">
                    <span class="summary-subtext">同部門比率</span>
                    <strong>${escapeHtml(String(candidate.same_department_ratio || 0))}%</strong>
                </div>
                <div class="insight-scenario-stat">
                    <span class="summary-subtext">影響テーマ数</span>
                    <strong>${escapeHtml(String(candidate.impacted_theme_count || 0))}</strong>
                </div>
            </div>
            <div class="insight-scenario-months">
                ${(candidate.monthly_plan || []).map((monthPlan) => `
                    <div class="insight-scenario-month">
                        <strong>${escapeHtml(monthPlan.month)}</strong>
                        <div class="candidate-body">
                            <span class="candidate-chip">必要 ${escapeHtml(formatPersonMonths(monthPlan.required_person_months))} 人月</span>
                            <span class="candidate-chip">割当 ${escapeHtml(formatPersonMonths(monthPlan.assigned_person_months))} 人月</span>
                            ${typeof monthPlan.shift_supported_person_months === 'number'
                                ? `<span class="candidate-chip">後ろ倒しで補完 ${escapeHtml(formatPersonMonths(monthPlan.shift_supported_person_months))} 人月</span>`
                                : ''}
                            <span class="candidate-chip">不足 ${escapeHtml(formatPersonMonths(monthPlan.remaining_uncovered_person_months ?? monthPlan.uncovered_person_months))} 人月</span>
                        </div>
                        <div class="candidate-body">
                            ${(monthPlan.assignments || []).map((assignment) => `
                                <span class="candidate-chip">${escapeHtml(assignment.display_name)} ${escapeHtml(formatPersonMonths(assignment.assigned_person_months))} 人月</span>
                            `).join('') || '<span class="summary-subtext">割当候補なし</span>'}
                        </div>
                    </div>
                `).join('')}
            </div>
            ${(candidate.shift_suggestions || []).length ? `
                <div class="candidate-list">
                    ${(candidate.shift_suggestions || []).map((suggestion) => `
                        <div class="candidate-card">
                            <div class="candidate-title">${escapeHtml(suggestion.theme_name)} を ${escapeHtml(suggestion.from_month)} から ${escapeHtml(suggestion.to_month)} へ</div>
                            <div class="candidate-body">
                                <span class="candidate-chip">${escapeHtml(suggestion.display_name)}</span>
                                <span class="candidate-chip">解放 ${escapeHtml(formatPersonMonths(suggestion.released_person_months))} 人月</span>
                                <span class="candidate-chip">部門 ${escapeHtml(suggestion.department || '未設定')}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            <div class="insight-actions">
                <button class="btn btn-ghost btn-sm" type="button" data-scenario-preview-index="${index}">ガントで見る</button>
            </div>
        </article>
    `).join('');

    target.querySelectorAll('[data-scenario-preview-index]').forEach((button) => {
        button.addEventListener('click', () => {
            const candidateIndex = Number.parseInt(button.dataset.scenarioPreviewIndex || '-1', 10);
            const candidate = candidates[candidateIndex];
            if (!candidate) return;
            openCandidateInGantt(candidate, candidateIndex);
        });
    });
}

function normalizeMonthInput(value) {
    return String(value || '').trim().slice(0, 7);
}

function formatPersonMonths(value) {
    const number = Number.parseFloat(value || 0);
    if (!Number.isFinite(number)) return '0';
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function getScenarioCandidateLabel(index) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return alphabet[index] || String(index + 1);
}

function buildScenarioPreviewCandidate(candidate, candidateIndex, scenarioInput, targetTheme) {
    const candidateLabel = getScenarioCandidateLabel(candidateIndex);
    return {
        scenarioLabel: candidateLabel,
        title: `[${candidateLabel}] ${candidate.title || '提案プレビュー'}`,
        startMonth: candidate.start_month || scenarioInput.start_month || '',
        previewThemeName: targetTheme?.name ? `[${candidateLabel}] 提案追加: ${targetTheme.name}` : `[${candidateLabel}] 提案案件`,
        assignments: (candidate.monthly_plan || []).flatMap((monthPlan) => (monthPlan.assignments || []).map((assignment) => ({
            month: monthPlan.month,
            memberId: assignment.member_id,
            displayName: assignment.display_name,
            department: assignment.department || '',
            rate: Number.parseInt(String(assignment.assigned_points ?? Math.round((assignment.assigned_person_months || 0) * 100)), 10) || 0,
        }))),
        shiftSuggestions: (candidate.shift_suggestions || []).map((suggestion) => ({
            themeId: suggestion.theme_id,
            memberId: suggestion.member_id,
            fromMonth: suggestion.from_month,
            toMonth: suggestion.to_month,
            rate: Number.parseInt(String(suggestion.released_points ?? Math.round((suggestion.released_person_months || 0) * 100)), 10) || 0,
        })),
    };
}

function openCandidateInGantt(candidate, candidateIndex = 0) {
    const scenarioInput = currentScenarioResult?.input || {};
    const candidates = currentScenarioResult?.candidates || [];
    const themeOptions = currentOverview?.dashboard?.theme_options || [];
    const targetThemeId = Number.parseInt(String(scenarioInput.target_theme_id || ''), 10);
    const targetTheme = themeOptions.find((item) => item.theme_id === targetThemeId);
    const previews = candidates.length
        ? candidates.map((item, index) => buildScenarioPreviewCandidate(item, index, scenarioInput, targetTheme))
        : [buildScenarioPreviewCandidate(candidate, candidateIndex, scenarioInput, targetTheme)];

    showScenarioPreview({
        previews,
        selectedIndex: candidateIndex,
    });
    updateViewState({
        startMonth: candidate.start_month || currentState.startMonth,
        scale: 1,
    });
    document.querySelector('.nav-item[data-view="gantt"]')?.click();
}

function simplifyInsightsLayout() {
    const aggregatePanel = document.querySelector('#view-insights .aggregate-panels');
    if (aggregatePanel) {
        aggregatePanel.hidden = true;
        aggregatePanel.style.display = 'none';
    }

    [
        'insights-gap-overview',
        'insights-department-imbalance',
        'insights-forecast-watch',
        'dashboard-monthly-trend',
        'dashboard-department-load',
        'dashboard-impact-themes',
        'dashboard-forecast-table',
        'dashboard-health-groups',
    ].forEach((id) => {
        const target = document.getElementById(id);
        const card = target?.closest('.summary-card');
        if (card) {
            card.hidden = true;
            card.style.display = 'none';
        }
    });

    const labels = document.querySelectorAll('#view-insights .insight-layout .summary-label');
    if (labels[0]) labels[0].textContent = '優先アラート';
    if (labels[1]) labels[1].textContent = '対応候補';

    document.querySelectorAll('#view-insights .insight-layout--dashboard .summary-card').forEach((card) => {
        card.hidden = !card.querySelector('#dashboard-project-ribbon');
    });
}

function severityRank(severity) {
    return { high: 3, medium: 2, low: 1 }[severity] || 0;
}

renderSummary = function(summary) {
    const target = document.getElementById('insights-summary');
    if (!target) return;

    const urgentCount = Number(summary.overloaded_member_count || 0) + Number(summary.warning_cell_count || 0);
    target.innerHTML = `
        <article class="summary-card">
            <div class="summary-label">優先対応件数</div>
            <div class="summary-value">${urgentCount}</div>
            <div class="summary-subtext">過負荷メンバー ${summary.overloaded_member_count || 0} 名 / 警告セル ${summary.warning_cell_count || 0} 件</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">不足見込み</div>
            <div class="summary-value">${summary.total_shortage || 0}%</div>
            <div class="summary-subtext">逼迫見込み月 ${summary.upcoming_shortage_months || 0} か月</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">稼働中テーマ</div>
            <div class="summary-value">${summary.active_theme_count || 0}</div>
            <div class="summary-subtext">提案候補 ${summary.recommendation_count || 0} 件</div>
        </article>
    `;
};


function renderError(message) {
    const target = document.getElementById('dashboard-project-ribbon');
    if (target) {
        target.innerHTML = `<div class="empty-panel">${escapeHtml(message)}</div>`;
    }

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
