// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

function renderReorderDom() {
    document.body.innerHTML = `
        <div id="gantt-container">
            <table>
                <tbody>
                    <tr class="gantt-row-summary" data-theme-id="1">
                        <td><div class="theme-label-cell">
                            <span class="theme-drag-handle" draggable="true">⠿</span>
                        </div></td>
                    </tr>
                    <tr class="gantt-row-summary" data-theme-id="2">
                        <td><div class="theme-label-cell">
                            <span class="theme-drag-handle" draggable="true">⠿</span>
                        </div></td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

function dispatchDrag(type, target, clientY, dataTransfer) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    event.clientY = clientY;
    event.dataTransfer = dataTransfer;
    target.dispatchEvent(event);
    return event;
}

describe('gantt theme reorder', () => {
    beforeEach(() => {
        vi.resetModules();
        renderReorderDom();
    });

    it('calls onDrop with placeBefore based on cursor position', async () => {
        const onDrop = vi.fn();
        const { initGanttThemeReorder } = await import('../js/gantt/gantt-theme-reorder.js');
        initGanttThemeReorder({ onDrop });

        const handle1 = document.querySelector('.gantt-row-summary[data-theme-id="1"] .theme-drag-handle');
        const row2 = document.querySelector('.gantt-row-summary[data-theme-id="2"]');
        row2.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140 });
        const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

        dispatchDrag('dragstart', handle1, 10, dataTransfer);
        // Drop in the lower half of row 2 -> place after.
        dispatchDrag('drop', row2, 130, dataTransfer);

        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop).toHaveBeenCalledWith({ draggedId: 1, targetId: 2, placeBefore: false });
    });

    it('does not fire onDrop when dropping onto itself', async () => {
        const onDrop = vi.fn();
        const { initGanttThemeReorder } = await import('../js/gantt/gantt-theme-reorder.js');
        initGanttThemeReorder({ onDrop });

        const handle1 = document.querySelector('.gantt-row-summary[data-theme-id="1"] .theme-drag-handle');
        const row1 = document.querySelector('.gantt-row-summary[data-theme-id="1"]');
        const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

        dispatchDrag('dragstart', handle1, 10, dataTransfer);
        dispatchDrag('drop', row1, 10, dataTransfer);

        expect(onDrop).not.toHaveBeenCalled();
    });
});
