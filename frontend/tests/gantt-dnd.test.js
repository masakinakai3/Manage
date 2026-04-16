// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

function renderDnDDom() {
    document.body.innerHTML = `
        <div id="gantt-container">
            <table>
                <tbody>
                    <tr class="gantt-row-member">
                        <td>
                            <button
                                id="source-cell"
                                class="gantt-cell"
                                data-theme="1"
                                data-member="10"
                                data-month="2026-04"
                                data-rate="40"
                                data-memo="Source memo"
                                type="button"
                            >40%</button>
                        </td>
                        <td>
                            <button
                                id="target-cell"
                                class="gantt-cell"
                                data-theme="1"
                                data-member="11"
                                data-month="2026-05"
                                data-rate="20"
                                data-memo="Target memo"
                                type="button"
                            >20%</button>
                        </td>
                    </tr>
                    <tr class="gantt-row-member">
                        <td>
                            <button
                                id="other-theme-cell"
                                class="gantt-cell"
                                data-theme="2"
                                data-member="11"
                                data-month="2026-05"
                                data-rate="10"
                                data-memo="Other theme"
                                type="button"
                            >10%</button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

describe('gantt dnd history payloads', () => {
    beforeEach(() => {
        vi.resetModules();
        renderDnDDom();
    });

    it('builds undo and redo payloads for month/member moves in the same theme', async () => {
        const performMove = vi.fn(async () => {});
        const { initGanttDnD } = await import('../js/gantt/gantt-dnd.js');
        const source = document.getElementById('source-cell');
        const target = document.getElementById('target-cell');
        const container = document.getElementById('gantt-container');

        document.elementFromPoint = vi.fn(() => target);

        initGanttDnD({ performMove });

        source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
        container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20 }));
        container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 20, clientY: 20 }));
        await Promise.resolve();

        expect(performMove).toHaveBeenCalledTimes(1);
        expect(performMove).toHaveBeenCalledWith({
            redo: [
                {
                    theme_id: 1,
                    member_id: 10,
                    month: '2026-04',
                    allocation_rate: 0,
                    memo: 'Source memo',
                },
                {
                    theme_id: 1,
                    member_id: 11,
                    month: '2026-05',
                    allocation_rate: 40,
                    memo: 'Source memo',
                },
            ],
            undo: [
                {
                    theme_id: 1,
                    member_id: 10,
                    month: '2026-04',
                    allocation_rate: 40,
                    memo: 'Source memo',
                },
                {
                    theme_id: 1,
                    member_id: 11,
                    month: '2026-05',
                    allocation_rate: 20,
                    memo: 'Target memo',
                },
            ],
        });
    });

    it('ignores drops onto a different theme', async () => {
        const performMove = vi.fn(async () => {});
        const { initGanttDnD } = await import('../js/gantt/gantt-dnd.js');
        const source = document.getElementById('source-cell');
        const otherThemeCell = document.getElementById('other-theme-cell');
        const container = document.getElementById('gantt-container');

        document.elementFromPoint = vi.fn(() => otherThemeCell);

        initGanttDnD({ performMove });

        source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
        container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 20, clientY: 20 }));
        await Promise.resolve();

        expect(performMove).not.toHaveBeenCalled();
    });
});
