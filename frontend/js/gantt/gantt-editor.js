/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Gantt Cell Editor
 * Opens an inline editor for changing allocation rates.
 */

import { allocations } from '../api.js';

let activeEditor = null;
let saving = false;

export function openCellEditor(cellEl, themeId, memberId, month, currentRate, onSave, onNavigate) {
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

    const save = () => {
        if (saving) return;
        saving = true;
        const newRate = parseInt(input.value) || 0;
        const clampedRate = Math.max(0, Math.min(100, newRate));

        // Optimistic: Update UI immediately via callback
        if (onSave) onSave(clampedRate);

        // Background save
        allocations.updateSingle({
            theme_id: themeId,
            member_id: memberId,
            month: month,
            allocation_rate: clampedRate,
        }).catch(err => {
            console.error('Failed to save:', err);
            // Optionally notify user
        }).finally(() => {
            saving = false;
        });

        // Editor stays open — only Esc closes it
        input.select();
    };

    const cancel = () => {
        closeCellEditor();
        cellEl.focus();
    };

    const handleKeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { cancel(); }
        if (onNavigate && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            // Check if saving is needed
            const newRate = parseInt(input.value) || 0;
            const hasChanged = newRate !== currentRate;
            onNavigate(e.key, hasChanged, newRate);
        }
    };

    // Clean up previous listeners
    const saveBtn = document.getElementById('cell-editor-save');
    const cancelBtn = document.getElementById('cell-editor-cancel');
    const clearBtn = document.getElementById('cell-editor-clear');

    const newSaveBtn = saveBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    const newClearBtn = clearBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);

    const clearRate = async () => {
        if (saving) return;
        saving = true;
        try {
            await allocations.updateSingle({
                theme_id: themeId,
                member_id: memberId,
                month: month,
                allocation_rate: 0,
            });
            closeCellEditor();
            onSave();
        } catch (err) {
            console.error('Failed to clear:', err);
        } finally {
            saving = false;
        }
    };

    newSaveBtn.addEventListener('click', save);
    newCancelBtn.addEventListener('click', cancel);
    newClearBtn.addEventListener('click', clearRate);
    input.addEventListener('keydown', handleKeydown);

    activeEditor = { 
        cleanup: () => input.removeEventListener('keydown', handleKeydown),
        cellEl: cellEl
    };

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
