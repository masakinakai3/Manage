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
                <input id="cell-editor-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off">
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
        const onHistoryShortcut = vi.fn();
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, onNavigate, { commitChange, clearChange, onHistoryShortcut });
        input.value = '50';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await Promise.resolve();

        expect(onSave).toHaveBeenCalledWith(50);
        expect(commitChange).toHaveBeenCalledWith(50);
        expect(updateSingle).not.toHaveBeenCalled();
    });

    it('keeps only digits before keyboard navigation saves the edited value', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onNavigate = vi.fn();
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, vi.fn(), onNavigate);
        input.value = '4a5';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        expect(input.value).toBe('45');
        expect(onNavigate).toHaveBeenCalledWith('ArrowRight', true, 45);
    });

    it('does not apply optimistic UI before commit when optimisticSave is disabled', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const commitChange = vi.fn(() => Promise.resolve(true));
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, vi.fn(), { commitChange, optimisticSave: false });
        input.value = '40';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(onSave).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(commitChange).toHaveBeenCalledWith(40);
    });

    it('applies the saved value after commit success when optimisticSave is disabled', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const onCommitSuccess = vi.fn();
        const commitChange = vi.fn(() => Promise.resolve(true));
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, vi.fn(), {
            commitChange,
            optimisticSave: false,
            onCommitSuccess,
        });
        input.value = '42';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(onSave).not.toHaveBeenCalled();
        expect(onCommitSuccess).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(onCommitSuccess).toHaveBeenCalledWith(42);
    });

    it('routes Ctrl+Z in the inline editor to the history shortcut handler', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onHistoryShortcut = vi.fn();
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, vi.fn(), vi.fn(), { onHistoryShortcut });
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));

        expect(onHistoryShortcut).toHaveBeenCalledWith(
            expect.objectContaining({ isRedo: false }),
        );
    });

    it('flushes unsaved inline edits before closing the editor', async () => {
        const { openCellEditor, flushCellEditorChanges, getCellEditorState, isCellEditorOpen } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const commitChange = vi.fn(() => Promise.resolve(true));
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, vi.fn(), { commitChange });
        input.value = '55';

        expect(getCellEditorState()).toMatchObject({
            isOpen: true,
            isSaving: false,
            hasUnsavedChanges: true,
            pendingRate: 55,
            committedRate: 20,
        });

        await flushCellEditorChanges({ close: true });

        expect(onSave).toHaveBeenCalledWith(55);
        expect(commitChange).toHaveBeenCalledWith(55);
        expect(isCellEditorOpen()).toBe(false);
        expect(getCellEditorState()).toMatchObject({
            isOpen: false,
            isSaving: false,
            hasUnsavedChanges: false,
            pendingRate: null,
            committedRate: null,
        });
    });

    it('saves changed values on outside click instead of discarding them', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const commitChange = vi.fn(() => Promise.resolve(true));
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, vi.fn(), vi.fn(), { commitChange });
        input.value = '65';

        await new Promise((resolve) => setTimeout(resolve, 120));
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(commitChange).toHaveBeenCalledWith(65);
        expect(document.getElementById('cell-editor').hidden).toBe(true);
    });

    it('persists an explicit 0 as a real value instead of clearing it', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const commitChange = vi.fn(() => Promise.resolve(true));
        const clearChange = vi.fn(() => Promise.resolve(true));
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, vi.fn(), { commitChange, clearChange });
        input.value = '0';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await Promise.resolve();

        expect(commitChange).toHaveBeenCalledWith(0);
        expect(clearChange).not.toHaveBeenCalled();
        expect(onSave).toHaveBeenCalledWith(0);
    });

    it('treats a blank input as clearing the cell, not saving 0', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const commitChange = vi.fn(() => Promise.resolve(true));
        const clearChange = vi.fn(() => Promise.resolve(true));
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, vi.fn(), { commitChange, clearChange });
        input.value = '';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await Promise.resolve();

        expect(clearChange).toHaveBeenCalled();
        expect(commitChange).not.toHaveBeenCalled();
        expect(onSave).toHaveBeenCalledWith(null);
    });

    it('opens with a blank input when the cell has no existing allocation', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const cell = document.getElementById('cell');
        const input = document.getElementById('cell-editor-input');

        openCellEditor(cell, 1, 2, '2026-04', null, vi.fn(), vi.fn());

        expect(input.value).toBe('');
    });

    it('clicking Clear removes the allocation rather than saving 0', async () => {
        const { openCellEditor } = await import('../js/gantt/gantt-editor.js');
        const onSave = vi.fn();
        const clearChange = vi.fn(() => Promise.resolve(true));
        const cell = document.getElementById('cell');
        const editor = document.getElementById('cell-editor');

        openCellEditor(cell, 1, 2, '2026-04', 20, onSave, vi.fn(), { clearChange });
        document.getElementById('cell-editor-clear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(clearChange).toHaveBeenCalled();
        expect(onSave).toHaveBeenCalledWith(null);
        expect(editor.hidden).toBe(true);
    });
});
