import { insights } from './api.js';
import { clearScenarioPreview, showScenarioPreview } from './gantt/gantt-renderer.js';
import { loadViewState, subscribeViewState, updateViewState } from './shared-state.js';
import { addMonths, getVisibleMonths } from './utils/date-utils.js';
import { formatError, setBusyState } from './ui.js';

let currentState = loadViewState();
let ribbonOverlayInitialized = false;
let activeRibbonData = null;
let ribbonXAxisScale = Number.parseFloat(localStorage.getItem('project_ribbon_x_scale') || '1');
let ribbonRedrawFrame = null;
let ribbonDetailMonth = null;
let ribbonReturnFocusElement = null;
let currentOverview = null;
let currentScenarioResult = null;
let currentScenarioCandidates = [];
const SMALL_RIBBON_LOAD_THRESHOLD = 30;

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
        renderSummary(overview.summary || {});
        renderScenarioPlanner(overview);
        if (currentScenarioResult) {
            renderScenarioResults(currentScenarioResult);
        }
        renderProjectRibbon('dashboard-project-ribbon', overview.dashboard?.project_ribbon || {});
    } catch (error) {
        currentScenarioResult = null;
        currentScenarioCandidates = [];
        renderError(formatError(error, 'インサイトの読み込みに失敗しました。'));
        updateScenarioClearButton();
    } finally {
        setBusyState(false);
    }
}

function renderSummary(summary) {
    const target = document.getElementById('insights-summary');
    if (!target) return;

    const overloadedMembers = Number(summary.overloaded_member_count || 0);
    const warningCells = Number(summary.warning_cell_count || 0);
    const urgentCount = overloadedMembers + warningCells;
    const shortage = Number(summary.total_shortage || 0);

    target.innerHTML = `
        <article class="summary-card">
            <div class="summary-label">優先対応件数</div>
            <div class="summary-value${urgentCount > 0 ? ' summary-value--alert' : ''}">${urgentCount}</div>
            <div class="summary-subtext">過負荷メンバー ${overloadedMembers} 名 / 警告セル ${warningCells} 件</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">不足見込み</div>
            <div class="summary-value${shortage > 0 ? ' summary-value--alert' : ''}">${formatPersonMonths(shortage / 100)} 人月</div>
            <div class="summary-subtext">期間内合計 / 逼迫見込み月 ${Number(summary.upcoming_shortage_months || 0)} か月</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">余剰工数</div>
            <div class="summary-value">${formatPersonMonths(Number(summary.total_spare || 0) / 100)} 人月</div>
            <div class="summary-subtext">期間内合計 / 低稼働メンバー ${Number(summary.underutilized_member_count || 0)} 名</div>
        </article>
        <article class="summary-card">
            <div class="summary-label">稼働中テーマ</div>
            <div class="summary-value">${Number(summary.active_theme_count || 0)}</div>
            <div class="summary-subtext">改善候補 ${Number(summary.recommendation_count || 0)} 件</div>
        </article>
    `;
}

function renderError(message) {
    const html = `<div class="empty-panel">${escapeHtml(message)}</div>`;
    const summaryTarget = document.getElementById('insights-summary');
    if (summaryTarget) {
        summaryTarget.innerHTML = html;
    }
    const ribbonTarget = document.getElementById('dashboard-project-ribbon');
    if (ribbonTarget) {
        ribbonTarget.innerHTML = html;
    }

    closeRibbonFullscreen();
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
    const baseWidth = Math.max(target.clientWidth - 4, 640);
    target.innerHTML = buildProjectRibbonMarkup(ribbonData, { fullscreen: false, baseWidth });
    bindRibbonScaleControls(target);
    bindRibbonDetailInteractions(target, ribbonData);
    target.querySelector('[data-ribbon-expand]')?.addEventListener('click', () => {
        openRibbonFullscreen(ribbonData);
    });

    if (ribbonDetailMonth) {
        showRibbonDetail(target, ribbonData, ribbonDetailMonth, { toggle: false });
    }
}

function buildProjectRibbonMarkup(ribbonData, { fullscreen = false, baseWidth = 0 } = {}) {
    const items = trimRibbonItems(ribbonData.items || []);
    const xScale = Math.min(1.4, Math.max(0.45, ribbonXAxisScale || 1));
    const minWidth = fullscreen ? 1120 : Math.max(baseWidth, 640);
    const width = Math.max(minWidth, items.length * (fullscreen ? 220 : 140) * xScale);
    const height = fullscreen ? 760 : 340;
    const padding = fullscreen
        ? { top: 28, right: 24, bottom: 72, left: 56 }
        : { top: 20, right: 24, bottom: 64, left: 48 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const columnWidth = Math.min(fullscreen ? 80 : 68, Math.max(38, innerWidth / Math.max(items.length * 2.6, 1)));
    const plotWidth = Math.max(innerWidth - columnWidth - 12, 0);
    const step = items.length > 1 ? plotWidth / (items.length - 1) : 0;
    // 高さの基準は月合計負荷の最大値。総容量は負荷がその近辺(1.2倍以内)に達した月がある場合のみ
    // 目盛りに取り込み、赤破線として描画する。
    const maxLoad = Math.max(ribbonData.max_total_load || 0, 1);
    const nearbyCapacities = items
        .map((item) => Number(item.capacity || 0))
        .filter((value) => value > 0 && value <= maxLoad * 1.2);
    const maxTotalLoad = Math.max(maxLoad, ...nearbyCapacities, 1);

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
            capacity: Number(item.capacity || 0),
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

    const tickStep = maxTotalLoad <= 150 ? 25 : (maxTotalLoad <= 400 ? 50 : 100);
    const axisValues = [];
    for (let value = 0; value <= maxTotalLoad; value += tickStep) {
        axisValues.push(value);
    }
    if (axisValues[axisValues.length - 1] !== maxTotalLoad) {
        axisValues.push(maxTotalLoad);
    }
    const yAxis = axisValues
        .map((value) => {
            const y = padding.top + innerHeight - ((innerHeight * value) / maxTotalLoad);
            return `
                <g>
                    <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="project-ribbon__grid-line"></line>
                    <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" class="project-ribbon__axis-label">${escapeHtml(String(value))}%</text>
                </g>
            `;
        });

    const capacityPoints = monthSegments.filter((segment) => segment.capacity > 0 && segment.capacity <= maxTotalLoad);
    const capacityLine = capacityPoints.length ? (() => {
        const yFor = (value) => padding.top + innerHeight - ((innerHeight * value) / maxTotalLoad);
        const halfSpan = Math.max(step / 2, columnWidth / 2);
        const path = capacityPoints.map((segment, index) => {
            const y = yFor(segment.capacity);
            const xStart = Math.max(segment.x - halfSpan, padding.left);
            const xEnd = Math.min(segment.x + halfSpan, width - padding.right);
            return `${index === 0 ? `M ${xStart} ${y}` : `L ${xStart} ${y}`} L ${xEnd} ${y}`;
        }).join(' ');
        const last = capacityPoints[capacityPoints.length - 1];
        return `
            <path d="${path}" fill="none" class="project-ribbon__capacity-line"></path>
            <text x="${width - padding.right}" y="${yFor(last.capacity) - 6}" text-anchor="end" class="project-ribbon__capacity-label">総容量 ${escapeHtml(String(last.capacity))}%</text>
        `;
    })() : '';

    const monthHotspots = monthSegments.map((item) => {
        const details = [...item.segments]
            .sort((left, right) => right.load - left.load || left.name.localeCompare(right.name, 'ja'))
            .map((segment) => `${segment.name}: ${segment.load}%`);
        const tooltip = [
            `${item.month} 合計 ${item.totalLoad}%${item.capacity > 0 ? ` / 総容量 ${item.capacity}%` : ''}`,
            ...(details.length ? details : ['内訳なし']),
            'クリックで内訳を固定表示',
        ].join('\n');
        return `
            <rect
                x="${item.x - (columnWidth / 2)}"
                y="${padding.top}"
                width="${columnWidth}"
                height="${innerHeight}"
                fill="transparent"
                pointer-events="all"
                class="project-ribbon__hotspot"
                data-ribbon-month="${escapeHtmlAttr(item.month)}"
            >
                <title>${escapeHtml(tooltip)}</title>
            </rect>
        `;
    });

    const segmentHotspots = monthSegments.flatMap((item) => item.segments.map((segment) => {
        const tooltipLines = [
            `${segment.month} | ${segment.name} | ${segment.load}%`,
            ...formatRibbonMemberBreakdown(segment),
            'クリックで内訳を固定表示',
        ];
        return `
            <rect
                x="${segment.x - (columnWidth / 2)}"
                y="${segment.y0}"
                width="${columnWidth}"
                height="${Math.max(segment.y1 - segment.y0, 0.5)}"
                fill="transparent"
                pointer-events="all"
                class="project-ribbon__hotspot"
                data-ribbon-month="${escapeHtmlAttr(segment.month)}"
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
            ? (fullscreen ? 10 : 9)
            : (heightValue < 18 ? 10 : (heightValue < 28 ? 11 : 12));
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
                        style="font-size:${fontSize}px;fill:${pickRibbonLabelColor(color)}"
                    >${escapeHtml(truncateLabel(segment.name, labelLimit))}</text>
                ` : ''}
            </g>
        `;
    }));

    const monthLabels = monthSegments.map((item) => {
        const isOverCapacity = item.capacity > 0 ? item.totalLoad > item.capacity : item.totalLoad > 100;
        return `
        <g>
            <text x="${item.x}" y="${height - 28}" text-anchor="middle" class="project-ribbon__month-label">${escapeHtml(formatRibbonMonth(item.month))}</text>
            <text x="${item.x}" y="${height - 10}" text-anchor="middle" class="project-ribbon__total-label${isOverCapacity ? ' project-ribbon__total-label--over' : ''}">Total ${escapeHtml(String(item.totalLoad))}%</text>
        </g>
    `;
    });

    const orderedThemeTotals = Array.from(totalsByTheme.entries())
        .sort((left, right) => right[1] - left[1]);
    const topThemes = orderedThemeTotals
        .slice(0, 6)
        .map(([themeId]) => themeMetaById.get(themeId))
        .filter(Boolean);
    const remainingThemeCount = Math.max(orderedThemeTotals.length - topThemes.length, 0);

    const scaleControl = `
        <label class="project-ribbon__scale-control">
            <span>横ズーム</span>
            <input type="range" min="45" max="140" step="5" value="${Math.round(xScale * 100)}" data-ribbon-x-scale aria-label="リボンの横方向ズーム">
            <span data-ribbon-x-scale-value>${Math.round(xScale * 100)}%</span>
        </label>
    `;
    const expandControl = fullscreen ? '' : `
        <button class="btn btn-ghost btn-sm" type="button" data-ribbon-expand>全画面で表示</button>
    `;
    const fullscreenControls = fullscreen ? `
        <div class="project-ribbon__toolbar">
            <button class="btn btn-ghost btn-sm project-ribbon__nav" type="button" data-ribbon-nav="prev">前へ</button>
            <button class="btn btn-ghost btn-sm project-ribbon__nav" type="button" data-ribbon-nav="next">次へ</button>
            <span class="project-ribbon__toolbar-hint">横スクロールで推移を確認できます。</span>
        </div>
    ` : '';

    return `
        <div class="project-ribbon${fullscreen ? ' project-ribbon--fullscreen' : ''}">
            ${fullscreenControls}
            <div class="project-ribbon__toolbar project-ribbon__toolbar--scale">${expandControl}${scaleControl}</div>
            <div class="project-ribbon__scroll" ${fullscreen ? `data-ribbon-step="${step}" data-ribbon-width="${width}"` : ''}>
                <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="project-ribbon__svg${fullscreen ? ' project-ribbon__svg--fullscreen' : ''}" role="img" aria-label="テーマ負荷の推移チャート">
                    <rect x="0" y="0" width="${width}" height="${height}" rx="18" ry="18" class="project-ribbon__bg"></rect>
                    <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerHeight}" class="project-ribbon__axis-line"></line>
                    ${yAxis.join('')}
                    ${capacityLine}
                    ${ribbons.join('')}
                    ${blocks.join('')}
                    ${monthHotspots.join('')}
                    ${segmentHotspots.join('')}
                    ${monthLabels.join('')}
                </svg>
            </div>
            <div class="project-ribbon__detail" data-ribbon-detail hidden></div>
            <div class="project-ribbon__legend">
                ${topThemes.map((theme) => `
                    <span class="project-ribbon__legend-item">
                        <span class="project-ribbon__legend-swatch" style="background:${escapeHtml(theme.color || '#6366f1')}"></span>
                        ${escapeHtml(theme.name)}
                    </span>
                `).join('')}
                ${remainingThemeCount > 0 ? `<span class="project-ribbon__legend-item">他 ${remainingThemeCount} テーマ</span>` : ''}
            </div>
        </div>
    `;
}

function pickRibbonLabelColor(color) {
    let hex = String(color || '').trim().replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        hex = hex.split('').map((char) => char + char).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
        return 'rgba(255, 255, 255, 0.92)';
    }
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const luminance = ((0.299 * r) + (0.587 * g) + (0.114 * b)) / 255;
    return luminance > 0.6 ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.92)';
}

function bindRibbonDetailInteractions(container, ribbonData) {
    container.querySelectorAll('[data-ribbon-month]').forEach((element) => {
        element.addEventListener('click', () => {
            const month = element.getAttribute('data-ribbon-month');
            if (!month) return;
            showRibbonDetail(container, ribbonData, month, { toggle: true });
        });
    });
}

function showRibbonDetail(container, ribbonData, month, { toggle = false } = {}) {
    const detail = container.querySelector('[data-ribbon-detail]');
    if (!detail) return;

    if (toggle && !detail.hidden && detail.dataset.month === month) {
        hideRibbonDetail(detail);
        return;
    }

    const item = (ribbonData.items || []).find((entry) => entry.month === month);
    if (!item) return;

    ribbonDetailMonth = month;
    detail.dataset.month = month;
    const projects = [...(item.projects || [])].sort((left, right) => (right.load || 0) - (left.load || 0));
    detail.innerHTML = `
        <div class="project-ribbon__detail-header">
            <strong>${escapeHtml(formatRibbonMonth(month))} の内訳(合計 ${escapeHtml(String(item.total_load || 0))}%${Number(item.capacity || 0) > 0 ? ` / 総容量 ${escapeHtml(String(item.capacity))}%` : ''})</strong>
            <button class="btn btn-ghost btn-sm" type="button" data-ribbon-detail-close>閉じる</button>
        </div>
        ${projects.length ? projects.map((project) => `
            <div class="project-ribbon__detail-row">
                <span class="project-ribbon__legend-swatch" style="background:${escapeHtml(project.color || '#6366f1')}"></span>
                <span class="project-ribbon__detail-name">${escapeHtml(project.name)}</span>
                <span class="project-ribbon__detail-load">${escapeHtml(String(project.load))}%</span>
                <span class="project-ribbon__detail-members">${(project.member_breakdown || []).map((member) => `${escapeHtml(member.display_name)} ${escapeHtml(String(member.load))}%`).join(' / ') || '担当内訳なし'}</span>
            </div>
        `).join('') : '<div class="empty-panel">この月の配分はありません。</div>'}
    `;
    detail.hidden = false;
    detail.querySelector('[data-ribbon-detail-close]')?.addEventListener('click', () => {
        hideRibbonDetail(detail);
    });
}

function hideRibbonDetail(detail) {
    detail.hidden = true;
    detail.dataset.month = '';
    detail.innerHTML = '';
    ribbonDetailMonth = null;
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

function trimRibbonItems(items) {
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
    bindRibbonDetailInteractions(content, ribbonData);
    overlay.hidden = false;
    ribbonReturnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.getElementById('ribbon-fullscreen-close')?.focus();
}

function closeRibbonFullscreen() {
    const overlay = document.getElementById('ribbon-fullscreen-overlay');
    const content = document.getElementById('ribbon-fullscreen-content');
    if (!overlay || !content) return;

    overlay.hidden = true;
    content.innerHTML = '';
    if (ribbonReturnFocusElement) {
        ribbonReturnFocusElement.focus();
        ribbonReturnFocusElement = null;
    }
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
        input.addEventListener('input', () => {
            ribbonXAxisScale = Math.min(1.4, Math.max(0.45, Number(input.value) / 100));
            localStorage.setItem('project_ribbon_x_scale', String(ribbonXAxisScale));
            const valueLabel = input.closest('.project-ribbon__scale-control')?.querySelector('[data-ribbon-x-scale-value]');
            if (valueLabel) {
                valueLabel.textContent = `${Math.round(ribbonXAxisScale * 100)}%`;
            }
            if (!activeRibbonData) return;

            if (ribbonRedrawFrame) {
                cancelAnimationFrame(ribbonRedrawFrame);
            }
            ribbonRedrawFrame = requestAnimationFrame(() => {
                ribbonRedrawFrame = null;
                renderProjectRibbon('dashboard-project-ribbon', activeRibbonData);

                const overlay = document.getElementById('ribbon-fullscreen-overlay');
                const content = document.getElementById('ribbon-fullscreen-content');
                if (overlay && content && !overlay.hidden) {
                    content.innerHTML = buildProjectRibbonMarkup(activeRibbonData, { fullscreen: true });
                    bindRibbonScaleControls(content);
                    bindRibbonFullscreenNavigation(content);
                    bindRibbonDetailInteractions(content, activeRibbonData);
                }
            });
        });
    });
}

function initScenarioPlanner() {
    const form = document.getElementById('insight-scenario-form');
    const modeSelect = document.getElementById('insight-scenario-mode');
    const clearButton = document.getElementById('insight-scenario-clear');
    const toggleButton = document.getElementById('insight-scenario-toggle');
    const body = document.getElementById('insight-scenario-body');
    if (!form) return;

    if (toggleButton && body && !toggleButton.dataset.bound) {
        toggleButton.dataset.bound = 'true';
        toggleButton.addEventListener('click', () => {
            const expanded = toggleButton.getAttribute('aria-expanded') === 'true';
            toggleButton.setAttribute('aria-expanded', String(!expanded));
            body.hidden = expanded;
            const icon = toggleButton.querySelector('.insight-scenario-toggle-icon');
            if (icon) icon.textContent = expanded ? '▸' : '▾';
        });
    }

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

    if (clearButton && !clearButton.dataset.bound) {
        clearButton.dataset.bound = 'true';
        clearButton.addEventListener('click', clearScenarioPlanner);
    }

    updateScenarioHint();
    updateScenarioClearButton();
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

function updateScenarioClearButton() {
    const clearButton = document.getElementById('insight-scenario-clear');
    if (!clearButton) return;
    clearButton.disabled = !currentScenarioResult;
}

function clearScenarioPlanner() {
    currentScenarioResult = null;
    currentScenarioCandidates = [];
    clearScenarioPreview();

    const target = document.getElementById('insight-scenario-results');
    if (target) {
        target.innerHTML = '';
    }

    updateScenarioClearButton();
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
        updateScenarioClearButton();
    } catch (error) {
        currentScenarioResult = null;
        currentScenarioCandidates = [];
        renderScenarioMessage(formatError(error, '候補の計算に失敗しました。'));
        updateScenarioClearButton();
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

function renderScenarioMessage(message) {
    const target = document.getElementById('insight-scenario-results');
    if (!target) return;
    target.innerHTML = `<div class="empty-panel">${escapeHtml(message)}</div>`;
}

function buildCandidateSignature(candidate) {
    return JSON.stringify({
        start: candidate.start_month || '',
        coverage: candidate.coverage_ratio || 0,
        uncovered: candidate.uncovered_person_months || 0,
        plan: (candidate.monthly_plan || []).map((monthPlan) => ({
            month: monthPlan.month,
            assignments: (monthPlan.assignments || []).map((assignment) => [
                assignment.member_id,
                assignment.assigned_person_months,
            ]),
            shift: monthPlan.shift_supported_person_months || 0,
        })),
        shifts: (candidate.shift_suggestions || []).map((suggestion) => [
            suggestion.theme_id,
            suggestion.member_id,
            suggestion.from_month,
            suggestion.to_month,
        ]),
    });
}

function dedupeScenarioCandidates(candidates) {
    const bySignature = new Map();
    const result = [];
    candidates.forEach((candidate) => {
        const signature = buildCandidateSignature(candidate);
        const existing = bySignature.get(signature);
        if (existing) {
            if (candidate.title) existing.mergedTitles.push(candidate.title);
            existing.recommended = existing.recommended || candidate.recommended;
        } else {
            const entry = { ...candidate, mergedTitles: [] };
            bySignature.set(signature, entry);
            result.push(entry);
        }
    });
    return result;
}

function renderScenarioResults(result) {
    const target = document.getElementById('insight-scenario-results');
    if (!target) return;

    const candidates = dedupeScenarioCandidates(result?.candidates || []);
    currentScenarioCandidates = candidates;
    if (!candidates.length) {
        updateScenarioClearButton();
        target.innerHTML = '<div class="empty-panel">候補は見つかりませんでした。</div>';
        return;
    }

    target.innerHTML = candidates.map((candidate, index) => `
        <article class="insight-scenario-card${candidate.recommended ? ' is-recommended' : ''}">
            <div class="insight-scenario-header">
                <div>
                    <div class="candidate-body">
                        <span class="dashboard-pill">案 ${escapeHtml(getScenarioCandidateLabel(index))}</span>
                    </div>
                    <strong>${escapeHtml(candidate.title || `候補 ${index + 1}`)}</strong>
                    <p class="summary-subtext">${escapeHtml(candidate.summary || '')}</p>
                    ${candidate.mergedTitles.length ? `
                        <p class="summary-subtext">同一内容の候補を統合: ${escapeHtml(candidate.mergedTitles.join(' / '))}</p>
                    ` : ''}
                </div>
                <div class="insight-scenario-meta">
                    ${candidate.recommended ? '<span class="dashboard-pill dashboard-pill--recommended">おすすめ</span>' : ''}
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
                ${(candidate.monthly_plan || []).map((monthPlan) => {
                    const shiftSupported = Number(monthPlan.shift_supported_person_months || 0);
                    const uncovered = Number(monthPlan.remaining_uncovered_person_months ?? monthPlan.uncovered_person_months ?? 0);
                    return `
                    <div class="insight-scenario-month">
                        <strong>${escapeHtml(monthPlan.month)}</strong>
                        <div class="candidate-body">
                            <span class="candidate-chip">必要 ${escapeHtml(formatPersonMonths(monthPlan.required_person_months))} 人月</span>
                            <span class="candidate-chip">割当 ${escapeHtml(formatPersonMonths(monthPlan.assigned_person_months))} 人月</span>
                            ${shiftSupported > 0
                                ? `<span class="candidate-chip">後ろ倒しで補完 ${escapeHtml(formatPersonMonths(shiftSupported))} 人月</span>`
                                : ''}
                            ${uncovered > 0
                                ? `<span class="candidate-chip candidate-chip--alert">不足 ${escapeHtml(formatPersonMonths(uncovered))} 人月</span>`
                                : ''}
                        </div>
                        <div class="candidate-body">
                            ${(monthPlan.assignments || []).map((assignment) => `
                                <span class="candidate-chip">${escapeHtml(assignment.display_name)} ${escapeHtml(formatPersonMonths(assignment.assigned_person_months))} 人月</span>
                            `).join('') || '<span class="summary-subtext">割当候補なし</span>'}
                        </div>
                    </div>
                `;
                }).join('')}
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
    const candidates = currentScenarioCandidates.length
        ? currentScenarioCandidates
        : (currentScenarioResult?.candidates || []);
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
