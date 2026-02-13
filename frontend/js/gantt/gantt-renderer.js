/**
 * Gantt Chart Renderer
 * Renders theme-based gantt chart with collapsible member rows,
 * allocation rate display, and warning indicators.
 */

import { allocations, themes as themesApi, members as membersApi } from '../api.js';
import {
    currentMonth, getVisibleMonths, formatMonthHeader, addMonths, aggregateRate,
    shortenMonth
} from '../utils/date-utils.js';
import { openCellEditor } from './gantt-editor.js';

let allThemes = [];
let allMembers = [];
let allAllocations = [];
let warningsMap = {};
let memberLoadsMap = {};
let collapsedThemes = new Set();
let startMonth = addMonths(currentMonth(), -1);
let visibleCount = 14;
let scale = 1;

export async function initGantt() {
    setupControls();
    await refreshGantt();
}

export async function refreshGantt() {
    const months = getVisibleMonths(startMonth, visibleCount, scale);
    const from = months[0];
    const to = months[months.length - 1];
    const toEnd = scale > 1 ? addMonths(to, scale - 1) : to;

    try {
        [allThemes, allMembers, allAllocations] = await Promise.all([
            themesApi.list(),
            membersApi.list(),
            allocations.list({ from, to: toEnd }),
        ]);

        // Build warnings map: { "member_id-month": excess }
        const warns = await allocations.warnings(from, toEnd);
        warningsMap = {};
        warns.forEach(w => { warningsMap[`${w.member_id}-${w.month}`] = w; });

        // Build member loads map
        const mLoads = await allocations.memberLoads(from, toEnd);
        memberLoadsMap = mLoads;

        render(months);
    } catch (err) {
        console.error('Failed to load gantt data:', err);
    }
}

function setupControls() {
    // Scale switcher
    document.querySelectorAll('#scale-switcher .scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelector('#scale-switcher .scale-btn.active')?.classList.remove('active');
            btn.classList.add('active');
            scale = parseInt(btn.dataset.scale);
            refreshGantt();
        });
    });

    // Navigation
    document.getElementById('gantt-prev').addEventListener('click', () => {
        startMonth = addMonths(startMonth, -scale * 3);
        refreshGantt();
    });
    document.getElementById('gantt-next').addEventListener('click', () => {
        startMonth = addMonths(startMonth, scale * 3);
        refreshGantt();
    });
    document.getElementById('gantt-today').addEventListener('click', () => {
        startMonth = addMonths(currentMonth(), -1);
        refreshGantt();
    });

    // Expand / Collapse all
    document.getElementById('gantt-expand-all').addEventListener('click', () => {
        collapsedThemes.clear();
        refreshGantt();
    });
    document.getElementById('gantt-collapse-all').addEventListener('click', () => {
        allThemes.forEach(t => collapsedThemes.add(t.theme_id));
        refreshGantt();
    });

    // CSV Export
    document.getElementById('gantt-export-csv').addEventListener('click', () => {
        handleExportCSV();
    });
}

function render(months) {
    renderHeader(months);
    renderBody(months);
}

function renderHeader(months) {
    const thead = document.getElementById('gantt-thead');
    const cur = currentMonth();
    let html = '<tr><th>テーマ / メンバー</th>';
    months.forEach(m => {
        const isCurrent = m === cur;
        const label = formatMonthHeader(m, scale);
        html += `<th class="${isCurrent ? 'month-current' : ''}">${label.replace('\n', '<br>')}</th>`;
    });
    html += '</tr>';
    thead.innerHTML = html;
}

function renderBody(months) {
    const tbody = document.getElementById('gantt-tbody');
    const cur = currentMonth();

    // Build allocation lookup: { "theme-member": { month: rate } }
    const allocMap = {};
    allAllocations.forEach(a => {
        const key = `${a.theme_id}-${a.member_id}`;
        if (!allocMap[key]) allocMap[key] = {};
        allocMap[key][a.month] = a.allocation_rate;
    });

    let html = '';

    allThemes.forEach(theme => {
        const isCollapsed = collapsedThemes.has(theme.theme_id);

        // Find members assigned to this theme OR with allocations
        const assignedIds = new Set(theme.member_ids || []);
        const themeMemberRates = {};
        const themeMembers = [];

        // Pre-fill themeMemberRates and identify members with allocations
        allMembers.forEach(member => {
            const key = `${theme.theme_id}-${member.member_id}`;
            if (allocMap[key]) {
                assignedIds.add(member.member_id);
                themeMemberRates[member.member_id] = allocMap[key];
            }
        });

        // Filter and sort members assigned to this theme
        allMembers.forEach(member => {
            if (assignedIds.has(member.member_id)) {
                themeMembers.push(member);
            }
        });
        themeMembers.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'));

        // Summary row (theme total)
        const statusLabel = { planning: '計画中', active: '進行中', completed: '完了', cancelled: '中止' }[theme.status] || theme.status;
        html += `<tr class="gantt-row-summary" data-theme-id="${theme.theme_id}">`;
        html += `<td><div class="theme-label-cell">`;
        html += `<span class="theme-toggle" data-theme-id="${theme.theme_id}">`;
        html += `<span class="theme-toggle-icon ${isCollapsed ? '' : 'expanded'}">▶</span>`;
        html += `<span class="theme-color-bar" style="background:${theme.color}"></span>`;
        html += `<span class="theme-name">${theme.name}</span></span>`;

        const periodText = (theme.start_month && theme.end_month)
            ? `${shortenMonth(theme.start_month)} 〜 ${shortenMonth(theme.end_month)}`
            : '期間未設定';
        html += `<span class="theme-period ${theme.start_month ? '' : 'empty'}" data-theme-id="${theme.theme_id}">${periodText}</span>`;

        html += `<span class="theme-status status-${theme.status}" data-theme-id="${theme.theme_id}" data-status="${theme.status}">${statusLabel}</span>`;
        html += `<button class="btn-assign-member" data-theme-id="${theme.theme_id}" title="メンバーを追加">＋</button>`;
        html += `</div></td>`;

        months.forEach(m => {
            let total = 0;
            themeMembers.forEach(member => {
                total += aggregateRate(themeMemberRates[member.member_id] || {}, m, scale);
            });
            const cls = getCellClass(total, false);
            const isCurrent = m === cur;
            html += `<td class="${isCurrent ? 'month-current' : ''}">`;
            html += `<div class="gantt-cell">${total > 0 ? total + '%' : ''}</div>`;
            html += `</td>`;
        });
        html += '</tr>';

        // Member detail rows
        themeMembers.forEach(member => {
            const rates = themeMemberRates[member.member_id] || {};
            html += `<tr class="gantt-row-member ${isCollapsed ? 'hidden-row' : ''}" data-theme-id="${theme.theme_id}" data-member-id="${member.member_id}">`;
            html += `<td><div class="member-label-cell">`;
            html += `<span>${member.display_name}</span>`;
            html += `<button class="btn-unassign-member" data-theme-id="${theme.theme_id}" data-member-id="${member.member_id}" title="アサイン解除">×</button>`;
            html += `</div></td>`;

            months.forEach(m => {
                const rate = aggregateRate(rates, m, scale);
                const warnKey = `${member.member_id}-${m}`;
                const hasWarning = warningsMap[warnKey];
                const cls = getCellClass(rate, !!hasWarning);
                const isCurrent = m === cur;

                html += `<td class="${isCurrent ? 'month-current' : ''}">`;
                html += `<div class="gantt-cell ${cls}" data-rate="${rate}" data-theme="${theme.theme_id}" data-member="${member.member_id}" data-month="${m}">`;
                if (rate > 0) html += `${rate}%`;
                if (hasWarning) html += `<span class="warning-icon">⚠</span>`;
                html += `</div></td>`;
            });
            html += '</tr>';
        });
    });

    tbody.innerHTML = html;

    // Bind events
    tbody.querySelectorAll('.btn-assign-member').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const themeId = parseInt(btn.dataset.themeId);
            showAssignMemberModal(themeId);
        });
    });

    tbody.querySelectorAll('.theme-status').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const themeId = parseInt(badge.dataset.themeId);
            showStatusDropdown(badge, themeId, badge.dataset.status);
        });
    });

    tbody.querySelectorAll('.theme-period').forEach(period => {
        period.addEventListener('click', (e) => {
            e.stopPropagation();
            const themeId = parseInt(period.dataset.themeId);
            showPeriodEditor(period, themeId);
        });
    });

    tbody.querySelectorAll('.btn-unassign-member').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('このテーマからメンバーのアサインを解除しますか？（入力済みの割当データは保持されますが、この一覧からは消えます）')) return;
            const themeId = parseInt(btn.dataset.themeId);
            const memberId = parseInt(btn.dataset.memberId);
            try {
                await themesApi.unassignMember(themeId, memberId);
                refreshGantt();
            } catch (err) {
                alert('解除に失敗しました: ' + err.message);
            }
        });
    });

    tbody.querySelectorAll('.theme-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const themeId = parseInt(toggle.dataset.themeId);
            if (collapsedThemes.has(themeId)) {
                collapsedThemes.delete(themeId);
            } else {
                collapsedThemes.add(themeId);
            }
            refreshGantt();
        });
    });

    // Cell click → edit (suppress if drag occurred)
    let isDragging = false;
    tbody.querySelectorAll('.gantt-row-member .gantt-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (isDragging) { isDragging = false; return; }
            const themeId = parseInt(cell.dataset.theme);
            const memberId = parseInt(cell.dataset.member);
            const month = cell.dataset.month;
            const currentRate = parseInt(cell.dataset.rate) || 0;
            if (scale === 1) {
                openCellEditor(e.target, themeId, memberId, month, currentRate, refreshGantt);
            }
        });

        // Tooltip on hover
        cell.addEventListener('mouseenter', (e) => {
            const memberId = parseInt(cell.dataset.member);
            const month = cell.dataset.month;
            const warnKey = `${memberId}-${month}`;
            const w = warningsMap[warnKey];
            if (w) {
                showTooltip(e, `合計 ${w.load}% (+${w.excess}% 超過)`);
            }
        });
        cell.addEventListener('mouseleave', hideTooltip);
    });

    // Drag & drop for allocation transfer
    setupDragAndDrop(tbody, () => { isDragging = true; });
}

// Module-level drag state
let _dragState = null;
let _dragCells = [];
let _dragOnStart = null;
let _saving = false;

function setupDragAndDrop(tbody, onDragStart) {
    if (scale !== 1) return; // Only allow D&D at 1M scale

    const DRAG_THRESHOLD = 5;
    _dragCells = Array.from(tbody.querySelectorAll('.gantt-row-member .gantt-cell'));
    _dragOnStart = onDragStart;

    // handlers (defined per scope to access closure if needed, but here we use module state)
    const onMouseMove = (e) => {
        if (!_dragState) return;

        const dx = e.clientX - _dragState.startX;
        const dy = e.clientY - _dragState.startY;

        if (!_dragState.started) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            _dragState.started = true;
            if (_dragOnStart) _dragOnStart();
            _dragState.srcCell.classList.add('dragging');

            const ghost = document.createElement('div');
            ghost.className = 'drag-ghost';
            ghost.textContent = `${_dragState.rate}%`;
            ghost.style.cssText = `
                position: fixed; z-index: 9999;
                padding: 4px 14px; background: #6366f1; color: #fff;
                border-radius: 6px; font-size: 13px; font-weight: 600;
                pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transform: translate(-50%, -50%);
            `;
            document.body.appendChild(ghost);
            _dragState.ghost = ghost;
        }

        if (_dragState.ghost) {
            _dragState.ghost.style.left = `${e.clientX}px`;
            _dragState.ghost.style.top = `${e.clientY}px`;
        }

        // Highlight valid drop targets:
        // - Same theme, different member (transfer)
        // - Same theme, same member, different month (period move)
        _dragCells.forEach(c => {
            c.classList.remove('drag-over');
            if (c.dataset.theme !== _dragState.themeId) return;
            // Skip the exact source cell
            if (c === _dragState.srcCell) return;

            const rect = c.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                c.classList.add('drag-over');
            }
        });
    };

    const onMouseUp = async (e) => {
        // Cleanup listeners immediately
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (!_dragState) return;
        const state = _dragState;
        _dragState = null;

        // Cleanup visuals
        state.srcCell.classList.remove('dragging');
        if (state.ghost && state.ghost.parentNode) {
            document.body.removeChild(state.ghost);
        }
        _dragCells.forEach(c => c.classList.remove('drag-over'));

        if (!state.started) return;
        if (_saving) return; // Prevent double-submit

        // Find drop target (same theme, but not the exact source cell)
        const target = _dragCells.find(c => {
            if (c === state.srcCell) return false;
            if (c.dataset.theme !== state.themeId) return false;
            const rect = c.getBoundingClientRect();
            return e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom;
        });

        if (!target) return;

        const isSameMember = target.dataset.member === state.memberId;
        const targetRate = parseInt(target.dataset.rate) || 0;

        _saving = true;
        try {
            if (isSameMember) {
                // Period move: move allocation to different month
                await allocations.bulkUpdate([
                    {
                        theme_id: parseInt(state.themeId),
                        member_id: parseInt(state.memberId),
                        month: state.month,
                        allocation_rate: 0,
                    },
                    {
                        theme_id: parseInt(state.themeId),
                        member_id: parseInt(state.memberId),
                        month: target.dataset.month,
                        allocation_rate: state.rate,
                    },
                ]);
            } else {
                // Transfer: move allocation to different member
                const newTargetRate = Math.min(100, targetRate + state.rate);
                await allocations.bulkUpdate([
                    {
                        theme_id: parseInt(state.themeId),
                        member_id: parseInt(state.memberId),
                        month: state.month,
                        allocation_rate: 0,
                    },
                    {
                        theme_id: parseInt(target.dataset.theme),
                        member_id: parseInt(target.dataset.member),
                        month: target.dataset.month,
                        allocation_rate: newTargetRate,
                    },
                ]);
            }
            refreshGantt();
        } catch (err) {
            console.error('Drag transfer failed:', err);
            alert('負荷率の移動に失敗しました: ' + err.message);
        } finally {
            _saving = false;
        }
    };

    // Attach mousedown
    _dragCells.forEach(cell => {
        cell.addEventListener('mousedown', (e) => {
            const rate = parseInt(cell.dataset.rate) || 0;
            if (rate === 0) return;
            if (e.button !== 0) return;

            _dragState = {
                srcCell: cell,
                themeId: cell.dataset.theme,
                memberId: cell.dataset.member,
                month: cell.dataset.month,
                rate: rate,
                startX: e.clientX,
                startY: e.clientY,
                started: false,
                ghost: null,
            };
            e.preventDefault();

            // Attach dynamic listeners
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

function getCellClass(rate, isOver) {
    if (isOver) return 'rate-over';
    if (rate === 0) return '';
    if (rate <= 30) return 'rate-low';
    if (rate <= 60) return 'rate-mid';
    if (rate < 100) return 'rate-high';
    if (rate === 100) return 'rate-full';
    return 'rate-over';
}

function showTooltip(e, text) {
    const tooltip = document.getElementById('tooltip');
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY - 8}px`;
}

function hideTooltip() {
    document.getElementById('tooltip').hidden = true;
}

async function showAssignMemberModal(themeId) {
    const theme = allThemes.find(t => t.theme_id === themeId);
    if (!theme) return;

    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalFooter = document.getElementById('modal-footer');
    const modalOverlay = document.getElementById('modal-overlay');

    modalTitle.textContent = `${theme.name} にメンバーを追加`;

    // Filter out members already assigned
    const assignedIds = new Set(theme.member_ids || []);
    const availableMembers = allMembers.filter(m => m.is_active && !assignedIds.has(m.member_id));
    availableMembers.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'));

    if (availableMembers.length === 0) {
        modalBody.innerHTML = '<p>追加可能な有効なメンバーがいません。</p>';
        modalFooter.innerHTML = '<button class="btn btn-ghost" id="modal-cancel">閉じる</button>';
    } else {
        let html = '<div class="member-selection-list">';
        availableMembers.forEach(m => {
            html += `
                <div class="member-selection-item" data-member-id="${m.member_id}">
                    <span class="member-name">${m.display_name}</span>
                    <span class="member-dept">${m.department || ''}</span>
                </div>
            `;
        });
        html += '</div>';
        modalBody.innerHTML = html;
        modalFooter.innerHTML = '<button class="btn btn-ghost" id="modal-cancel">キャンセル</button>';

        // Bind selection events
        modalBody.querySelectorAll('.member-selection-item').forEach(item => {
            item.addEventListener('click', async () => {
                const memberId = parseInt(item.dataset.memberId);
                try {
                    await themesApi.assignMember(themeId, memberId);
                    modalOverlay.hidden = true;
                    refreshGantt();
                } catch (err) {
                    alert('追加に失敗しました: ' + err.message);
                }
            });
        });
    }

    document.getElementById('modal-close').onclick = () => { modalOverlay.hidden = true; };
    const cancelBtn = document.getElementById('modal-cancel');
    if (cancelBtn) cancelBtn.onclick = () => { modalOverlay.hidden = true; };
    modalOverlay.hidden = false;
}

const STATUS_OPTIONS = [
    { value: 'planning', label: '計画中' },
    { value: 'active', label: '進行中' },
    { value: 'completed', label: '完了' },
    { value: 'cancelled', label: '中止' },
];

function showStatusDropdown(badge, themeId, currentStatus) {
    // Remove any existing dropdown
    document.querySelector('.status-dropdown')?.remove();

    const dropdown = document.createElement('div');
    dropdown.className = 'status-dropdown';

    STATUS_OPTIONS.forEach(opt => {
        const item = document.createElement('div');
        item.className = `status-dropdown-item status-${opt.value}${opt.value === currentStatus ? ' current' : ''}`;
        item.textContent = opt.label;
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.remove();
            if (opt.value === currentStatus) return;
            try {
                await themesApi.update(themeId, { status: opt.value });
                refreshGantt();
            } catch (err) {
                alert('ステータス変更に失敗しました: ' + err.message);
            }
        });
        dropdown.appendChild(item);
    });

    // Position below the badge
    const rect = badge.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(dropdown);

    // Close on outside click
    const closeHandler = (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function showPeriodEditor(pElement, themeId) {
    // Remove any existing editor
    document.querySelector('.period-editor')?.remove();

    const theme = allThemes.find(t => t.theme_id === themeId);
    if (!theme) return;

    const editor = document.createElement('div');
    editor.className = 'period-editor';
    editor.innerHTML = `
        <div class="period-editor-fields">
            <input type="month" id="period-start" value="${theme.start_month || ''}">
            <span>〜</span>
            <input type="month" id="period-end" value="${theme.end_month || ''}">
        </div>
        <div class="period-editor-actions">
            <button class="btn btn-primary btn-sm" id="period-save">保存</button>
            <button class="btn btn-ghost btn-sm" id="period-cancel">キャンセル</button>
        </div>
    `;

    const rect = pElement.getBoundingClientRect();
    editor.style.left = `${rect.left}px`;
    editor.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(editor);

    const closeEditor = () => {
        editor.remove();
        document.removeEventListener('mousedown', onOutsideClick);
    };

    const onOutsideClick = (e) => {
        if (!editor.contains(e.target)) closeEditor();
    };

    editor.querySelector('#period-cancel').onclick = closeEditor;
    editor.querySelector('#period-save').onclick = async () => {
        const start = editor.querySelector('#period-start').value;
        const end = editor.querySelector('#period-end').value;
        try {
            await themesApi.update(themeId, { start_month: start, end_month: end });
            closeEditor();
            refreshGantt();
        } catch (err) {
            alert('保存に失敗しました: ' + err.message);
        }
    };

    setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
}

/**
 * Handle CSV Export - sends CSV data to server endpoint for proper file download
 */
async function handleExportCSV() {
    try {
        const months = getVisibleMonths(startMonth, visibleCount, scale);

        // CSV Header Labels
        const getCSVHeaderLabel = (m, s) => {
            const [y, mm] = m.split('-').map(Number);
            const shortY = String(y).slice(2);
            if (s === 1) return `${shortY}-${String(mm).padStart(2, '0')}`;
            if (s === 3) return `${shortY}-Q${Math.ceil(mm / 3)}`;
            if (s === 6) return `${shortY}-${mm <= 6 ? 'H1' : 'H2'}`;
            return `${y}`;
        };

        const escape = (val) => {
            const str = String(val || '');
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // CSV Header Row
        const headers = ['\u30c6\u30fc\u30de', '\u5185\u8a33', '\u30b9\u30c6\u30fc\u30bf\u30b9'];
        months.forEach(m => headers.push(getCSVHeaderLabel(m, scale)));
        const csvRows = [headers.map(escape).join(',')];

        // Allocation lookup
        const allocMap = {};
        allAllocations.forEach(a => {
            const key = `${a.theme_id}-${a.member_id}`;
            if (!allocMap[key]) allocMap[key] = {};
            allocMap[key][a.month] = a.allocation_rate;
        });

        allThemes.forEach(theme => {
            const statusLabel = { planning: '\u8a08\u753b\u4e2d', active: '\u9032\u884c\u4e2d', completed: '\u5b8c\u4e86', cancelled: '\u4e2d\u6b62' }[theme.status] || theme.status;

            const assignedIds = new Set(theme.member_ids || []);
            const themeMemberRates = {};
            const themeMembers = [];

            allMembers.forEach(member => {
                const key = `${theme.theme_id}-${member.member_id}`;
                if (allocMap[key]) {
                    assignedIds.add(member.member_id);
                    themeMemberRates[member.member_id] = allocMap[key];
                }
            });

            assignedIds.forEach(mid => {
                const member = allMembers.find(m => m.member_id === mid);
                if (member) {
                    themeMembers.push(member);
                    if (!themeMemberRates[mid]) themeMemberRates[mid] = allocMap[`${theme.theme_id}-${mid}`] || {};
                }
            });

            const summaryRow = [theme.name, '\u5408\u7b97', statusLabel];
            months.forEach(m => {
                let total = 0;
                themeMembers.forEach(member => {
                    total += aggregateRate(themeMemberRates[member.member_id] || {}, m, scale);
                });
                summaryRow.push(total > 0 ? `${total}%` : '');
            });
            csvRows.push(summaryRow.map(escape).join(','));

            themeMembers.forEach(member => {
                const memberRow = ['', member.display_name, ''];
                months.forEach(m => {
                    const rate = aggregateRate(themeMemberRates[member.member_id] || {}, m, scale);
                    memberRow.push(rate > 0 ? `${rate}%` : '');
                });
                csvRows.push(memberRow.map(escape).join(','));
            });
        });

        // Use hidden form POST so browser natively handles Content-Disposition filename
        const csvContent = csvRows.join('\r\n');
        const fileName = `gantt_export_${currentMonth().replace('-', '')}.csv`;

        // Create a hidden iframe as the form target
        let iframe = document.getElementById('csv-download-frame');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'csv-download-frame';
            iframe.name = 'csv-download-frame';
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
        }

        // Create and submit a hidden form
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/api/export/csv';
        form.target = 'csv-download-frame';
        form.style.display = 'none';

        const contentInput = document.createElement('input');
        contentInput.type = 'hidden';
        contentInput.name = 'content';
        contentInput.value = csvContent;
        form.appendChild(contentInput);

        const filenameInput = document.createElement('input');
        filenameInput.type = 'hidden';
        filenameInput.name = 'filename';
        filenameInput.value = fileName;
        form.appendChild(filenameInput);

        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
    } catch (err) {
        console.error('CSV Export Error:', err);
        alert('CSV\u51fa\u529b\u4e2d\u306b\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f: ' + err.message);
    }
}
