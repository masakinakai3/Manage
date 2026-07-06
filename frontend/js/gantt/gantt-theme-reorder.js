/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Gantt theme reorder handler.
 * Enables drag-and-drop reordering of theme rows via the drag handle.
 *
 * The handler only manages DOM interactions; it delegates the actual order
 * mutation to the caller through `onDrop({ draggedId, targetId, placeBefore })`
 * so the renderer can keep filtered-out themes in place.
 */
export function initGanttThemeReorder({ onDrop }) {
    const container = document.getElementById('gantt-container');
    if (!container || container.dataset.themeReorderBound === 'true') return;

    container.dataset.themeReorderBound = 'true';
    let draggedId = null;

    const summaryRow = (target) => target?.closest?.('.gantt-row-summary[data-theme-id]') || null;

    const clearIndicators = () => {
        container.querySelectorAll('.theme-reorder-before, .theme-reorder-after').forEach((el) => {
            el.classList.remove('theme-reorder-before', 'theme-reorder-after');
        });
    };

    container.addEventListener('dragstart', (event) => {
        const handle = event.target.closest?.('.theme-drag-handle');
        if (!handle) return;
        const row = summaryRow(handle);
        if (!row) return;
        draggedId = Number.parseInt(row.dataset.themeId, 10);
        row.classList.add('theme-reorder-dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            // Firefox requires data to be set for the drag to start.
            event.dataTransfer.setData('text/plain', String(draggedId));
        }
    });

    container.addEventListener('dragover', (event) => {
        if (draggedId === null) return;
        const row = summaryRow(event.target);
        if (!row) return;
        const targetId = Number.parseInt(row.dataset.themeId, 10);
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        clearIndicators();
        if (targetId === draggedId) return;
        const rect = row.getBoundingClientRect();
        const placeBefore = event.clientY < rect.top + rect.height / 2;
        row.classList.add(placeBefore ? 'theme-reorder-before' : 'theme-reorder-after');
    });

    container.addEventListener('drop', (event) => {
        if (draggedId === null) return;
        const row = summaryRow(event.target);
        clearIndicators();
        if (row) {
            const targetId = Number.parseInt(row.dataset.themeId, 10);
            if (Number.isFinite(targetId) && targetId !== draggedId) {
                event.preventDefault();
                const rect = row.getBoundingClientRect();
                const placeBefore = event.clientY < rect.top + rect.height / 2;
                onDrop({ draggedId, targetId, placeBefore });
            }
        }
        draggedId = null;
    });

    container.addEventListener('dragend', () => {
        container.querySelectorAll('.theme-reorder-dragging').forEach((el) => el.classList.remove('theme-reorder-dragging'));
        clearIndicators();
        draggedId = null;
    });
}
