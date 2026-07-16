/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Gantt D&D Handler
 * Enables drag-and-drop for allocation bars (period/member move).
 */

/**
 * Initialize D&D on the gantt table.
 * Works by detecting drags on member row cells and moving the allocation to
 * the drop target inside the same theme.
 */
export function initGanttDnD({ performMove }) {
    const container = document.getElementById('gantt-container');
    if (!container || container.dataset.dndBound === 'true') return;

    container.dataset.dndBound = 'true';
    let dragState = null;

    container.addEventListener('mousedown', (e) => {
        if (e.detail > 1) {
            dragState?.cell.classList.remove('dragging');
            dragState = null;
            return;
        }

        const cell = e.target.closest('.gantt-row-member .gantt-cell[data-rate]');
        if (!cell || parseInt(cell.dataset.rate) === 0) return;

        const themeId = parseInt(cell.dataset.theme);
        const memberId = parseInt(cell.dataset.member);
        const startMonthStr = cell.dataset.month;

        dragState = {
            themeId,
            memberId,
            startMonth: startMonthStr,
            originX: e.clientX,
            cell,
        };

        cell.classList.add('dragging');
        e.preventDefault();
    });

    container.addEventListener('mousemove', (e) => {
        if (!dragState) return;

        // Find the cell under cursor
        const cellUnder = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gantt-row-member .gantt-cell[data-theme][data-member][data-month]');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (cellUnder && Number.parseInt(cellUnder.dataset.theme, 10) === dragState.themeId) {
            cellUnder.classList.add('drag-over');
        }
    });

    container.addEventListener('mouseup', async (e) => {
        if (!dragState) return;

        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        container.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

        // Find target month/member
        const cellUnder = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gantt-row-member .gantt-cell[data-theme][data-member][data-month]');
        const targetThemeId = Number.parseInt(cellUnder?.dataset.theme || '', 10);
        const targetMemberId = Number.parseInt(cellUnder?.dataset.member || '', 10);
        const targetMonth = cellUnder?.dataset.month;
        const rate = Number.parseInt(dragState.cell.dataset.rate || '0', 10);
        const memo = dragState.cell.dataset.memo || '';
        const isSamePosition = targetMemberId === dragState.memberId && targetMonth === dragState.startMonth;

        if (cellUnder && targetThemeId === dragState.themeId && targetMonth && !isSamePosition) {
            const targetRate = Number.parseInt(cellUnder.dataset.rate || '0', 10);
            const targetMemo = cellUnder.dataset.memo || '';

            try {
                await performMove({
                    redo: [
                        {
                            theme_id: dragState.themeId,
                            member_id: dragState.memberId,
                            month: dragState.startMonth,
                            allocation_rate: 0,
                            memo,
                        },
                        {
                            theme_id: dragState.themeId,
                            member_id: targetMemberId,
                            month: targetMonth,
                            allocation_rate: rate,
                            memo,
                        },
                    ],
                    undo: [
                        {
                            theme_id: dragState.themeId,
                            member_id: dragState.memberId,
                            month: dragState.startMonth,
                            allocation_rate: rate,
                            memo,
                        },
                        {
                            theme_id: dragState.themeId,
                            member_id: targetMemberId,
                            month: targetMonth,
                            allocation_rate: targetRate,
                            memo: targetMemo,
                        },
                    ],
                });
            } catch (err) {
                console.error('D&D save failed:', err);
            }
        }

        dragState = null;
    });
}
