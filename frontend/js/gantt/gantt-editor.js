/**
 * Gantt Cell Editor
 * Opens an inline editor for changing allocation rates.
 */

import { allocations } from '../api.js';

let activeEditor = null;

export function openCellEditor(cellEl, themeId, memberId, month, currentRate, onSave) {
    closeCellEditor();

    const editor = document.getElementById('cell-editor');
    const input = document.getElementById('cell-editor-input');
    const rect = cellEl.getBoundingClientRect();

    editor.style.left = `${rect.left}px`;
    editor.style.top = `${rect.bottom + 4}px`;
    editor.hidden = false;
    input.value = currentRate;
    input.focus();
    input.select();

    const save = async () => {
        const newRate = parseInt(input.value) || 0;
        const clampedRate = Math.max(0, Math.min(100, newRate));
        try {
            await allocations.updateSingle({
                theme_id: themeId,
                member_id: memberId,
                month: month,
                allocation_rate: clampedRate,
            });
            closeCellEditor();
            onSave();
        } catch (err) {
            console.error('Failed to save:', err);
        }
    };

    const cancel = () => closeCellEditor();

    const handleKeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { cancel(); }
    };

    // Clean up previous listeners
    const saveBtn = document.getElementById('cell-editor-save');
    const cancelBtn = document.getElementById('cell-editor-cancel');

    const newSaveBtn = saveBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newSaveBtn.addEventListener('click', save);
    newCancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', handleKeydown);

    activeEditor = { cleanup: () => input.removeEventListener('keydown', handleKeydown) };

    // Close on outside click
    setTimeout(() => {
        const outsideClick = (e) => {
            if (!editor.contains(e.target)) {
                closeCellEditor();
                document.removeEventListener('mousedown', outsideClick);
            }
        };
        document.addEventListener('mousedown', outsideClick);
    }, 100);
}

export function closeCellEditor() {
    const editor = document.getElementById('cell-editor');
    editor.hidden = true;
    if (activeEditor) {
        activeEditor.cleanup();
        activeEditor = null;
    }
}
