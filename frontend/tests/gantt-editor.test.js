// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateSingle = vi.fn(() => Promise.resolve({}));
const setSaveState = vi.fn();
const showToast = vi.fn();
const formatError = vi.fn((error) => error.message);

vi.mock('../js/api.js', () => ({
    allocations: {
        updateSingle,
    },
}));

vi.mock('../js/ui.js', () => ({
    formatError,
    setSaveState,
    showToast,
}));

describe('gantt-editor regressions', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="cell" type="button">20%</button>
            <div id="cell-editor" hidden>
                <input id="cell-editor-input" type="number">
                <button id="cell-editor-save" type="button">save</button>
                <button id="cell-editor-cancel" type="button">cancel</button>
                <button id="cell-editor-clear" type="button">clear</button>
            </div>
        `;

        updateSingle.mockClear();
        setSaveState.mockClear();
        showToast.mockClear();
        formatError.mockClear();

        const cell = document.getElementById('cell');
        cell.getBoundingClientRect = () => ({ left: 12, bottom: 40 });
    });

    it('keeps the editor open after pressing Enter', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const onNavigate = vi.fn();
        const cell = document.getElementById('cell');
        const editor = document.getElementById('cell-editor');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, onNavigate);
        input.value = '35';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await Promise.resolve();

        expect(onSave).toHaveBeenCalledWith(35);
        expect(updateSingle).toHaveBeenCalledWith({
            theme_id: 1,
            member_id: 2,
            month: '2026-04',
            allocation_rate: 35,
        });
        expect(editor.hidden).toBe(false);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('keeps editing flow alive when arrow keys are pressed', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const onNavigate = vi.fn();
        const cell = document.getElementById('cell');
        const editor = document.getElementById('cell-editor');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, onNavigate);
        input.value = '45';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(onNavigate).toHaveBeenCalledWith('ArrowRight', true, 45);
        expect(editor.hidden).toBe(false);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('uses a custom commit handler when provided', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const onNavigate = vi.fn();
        const commitChange = vi.fn(() => Promise.resolve(true));
        const clearChange = vi.fn(() => Promise.resolve(true));
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, onNavigate, { commitChange, clearChange });
        input.value = '50';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await Promise.resolve();

        expect(onSave).toHaveBeenCalledWith(50);
        expect(commitChange).toHaveBeenCalledWith(50);
        expect(updateSingle).not.toHaveBeenCalled();
    });
});
