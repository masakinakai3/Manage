/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Gantt D&D Handler
 * Enables drag-and-drop for allocation bars (period move & extend).
 */

import { allocations } from '../api.js';
import { addMonths } from '../utils/date-utils.js';

/**
 * Initialize D&D on the gantt table.
 * Works by detecting drags on member row cells and computing month offsets.
 */
export function initGanttDnD(refreshCallback) {
    const container = document.getElementById('gantt-container');
    let dragState = null;

    container.addEventListener('mousedown', (e) => {
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
        const cellUnder = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gantt-cell');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (cellUnder && cellUnder.dataset.month) {
            cellUnder.classList.add('drag-over');
        }
    });

    container.addEventListener('mouseup', async (e) => {
        if (!dragState) return;

        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        container.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

        // Find target month
        const cellUnder = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gantt-cell');
        if (cellUnder && cellUnder.dataset.month && cellUnder.dataset.month !== dragState.startMonth) {
            const targetMonth = cellUnder.dataset.month;
            const rate = parseInt(dragState.cell.dataset.rate);

            try {
                // Move: delete from old, add to new
                await allocations.bulkUpdate([
                    {
                        theme_id: dragState.themeId,
                        member_id: dragState.memberId,
                        month: dragState.startMonth,
                        allocation_rate: 0,
                    },
                    {
                        theme_id: dragState.themeId,
                        member_id: dragState.memberId,
                        month: targetMonth,
                        allocation_rate: rate,
                    },
                ]);
                refreshCallback();
            } catch (err) {
                console.error('D&D save failed:', err);
            }
        }

        dragState = null;
    });
}
