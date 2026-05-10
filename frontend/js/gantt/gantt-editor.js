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
import { formatError, setSaveState, showToast } from '../ui.js';

let activeEditor = null;
let saving = false;
let pendingCommitPromise = null;

function clampRate(value) {
    const parsed = Number.parseInt(String(value || '0'), 10) || 0;
    return Math.max(0, Math.min(100, parsed));
}

function buildSuccessApplier({ optimisticSave, onSave, onCommitSuccess }) {
    return (rate) => {
        if (optimisticSave) return;
        if (onCommitSuccess) {
            onCommitSuccess(rate);
            return;
        }
        if (onSave) {
            onSave(rate);
        }
    };
}

export function openCellEditor(cellEl, themeId, memberId, month, currentRate, onSave, onNavigate, options = {}) {
    closeCellEditor();

    const editor = document.getElementById('cell-editor');
    const input = document.getElementById('cell-editor-input');
    const rect = cellEl.getBoundingClientRect();
    const initialValue = options.initialValue ?? currentRate;
    const selectOnOpen = options.selectOnOpen !== false;
    const optimisticSave = options.optimisticSave !== false;
    const onCommitSuccess = options.onCommitSuccess || null;
    const onHistoryShortcut = options.onHistoryShortcut || null;
    const commitChange = options.commitChange || ((allocationRate) => allocations.updateSingle({
        theme_id: themeId,
        member_id: memberId,
        month,
        allocation_rate: allocationRate,
    }));
    const clearChange = options.clearChange || (() => allocations.updateSingle({
        theme_id: themeId,
        member_id: memberId,
        month,
        allocation_rate: 0,
    }));
    const applyCommittedValue = buildSuccessApplier({ optimisticSave, onSave, onCommitSuccess });

    editor.style.left = `${rect.left}px`;
    editor.style.top = `${rect.bottom + 4}px`;
    editor.hidden = false;
    input.value = initialValue;
    input.focus();
    if (selectOnOpen) {
        input.select();
    } else {
        const end = String(input.value).length;
        input.setSelectionRange(end, end);
    }

    let outsideClickListener = null;

    const readClampedRate = () => clampRate(input.value);

    const sanitizeInput = () => {
        const digitsOnly = String(input.value || '').replace(/[^\d]/g, '');
        if (input.value !== digitsOnly) {
            input.value = digitsOnly;
        }
    };

    const save = ({ closeAfterSave = false } = {}) => {
        if (!activeEditor) return Promise.resolve(false);
        if (saving) {
            if (closeAfterSave) {
                activeEditor.closeAfterSave = true;
            }
            return pendingCommitPromise || Promise.resolve(false);
        }

        const clampedRate = readClampedRate();
        if (clampedRate === activeEditor.lastCommittedRate) {
            if (closeAfterSave) closeCellEditor();
            return Promise.resolve(false);
        }

        saving = true;
        activeEditor.closeAfterSave = activeEditor.closeAfterSave || closeAfterSave;
        setSaveState('saving', 'セルを保存しています...');

        if (optimisticSave && onSave) {
            onSave(clampedRate);
        }

        pendingCommitPromise = Promise.resolve(commitChange(clampedRate)).then(() => {
            if (activeEditor) {
                activeEditor.lastCommittedRate = clampedRate;
            }
            applyCommittedValue(clampedRate);
            setSaveState('saved', `${month} の配分を保存しました`);
            return true;
        }).catch((err) => {
            console.error('Failed to save:', err);
            setSaveState('error', 'セル保存に失敗しました');
            showToast(`セル保存に失敗しました: ${formatError(err)}`, 'error');
            throw err;
        }).finally(() => {
            const shouldClose = Boolean(activeEditor?.closeAfterSave);
            saving = false;
            pendingCommitPromise = null;
            if (shouldClose) {
                closeCellEditor();
                return;
            }

            if (document.activeElement !== input) {
                input.focus();
            }
            input.select();
        });

        return pendingCommitPromise;
    };

    const cancel = () => {
        closeCellEditor();
        cellEl.focus();
    };

    const handleKeydown = (e) => {
        const key = String(e.key || '').toLowerCase();
        if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (onHistoryShortcut) {
                onHistoryShortcut({
                    isRedo: key === 'y' || (key === 'z' && e.shiftKey),
                    originalEvent: e,
                });
            }
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            sanitizeInput();
            void save();
        }
        if (e.key === 'Escape') {
            cancel();
        }
        if (onNavigate && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            sanitizeInput();
            const newRate = readClampedRate();
            const hasChanged = newRate !== activeEditor.lastCommittedRate;
            onNavigate(e.key, hasChanged, newRate);
        }
    };

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
        setSaveState('saving', 'セルをクリアしています...');
        try {
            await Promise.resolve(clearChange());
            closeCellEditor();
            if (onCommitSuccess) {
                onCommitSuccess(0);
            } else if (onSave) {
                onSave(0);
            }
            setSaveState('saved', `${month} の配分をクリアしました`);
        } catch (err) {
            console.error('Failed to clear:', err);
            setSaveState('error', 'セルのクリアに失敗しました');
            showToast(`セルのクリアに失敗しました: ${formatError(err)}`, 'error');
        } finally {
            saving = false;
            pendingCommitPromise = null;
        }
    };

    newSaveBtn.addEventListener('click', () => { void save(); });
    newCancelBtn.addEventListener('click', cancel);
    newClearBtn.addEventListener('click', clearRate);
    input.addEventListener('input', sanitizeInput);
    input.addEventListener('keydown', handleKeydown);

    activeEditor = {
        cleanup: () => {
            input.removeEventListener('input', sanitizeInput);
            input.removeEventListener('keydown', handleKeydown);
            if (outsideClickListener) {
                document.removeEventListener('mousedown', outsideClickListener);
                outsideClickListener = null;
            }
        },
        cellEl,
        input,
        save,
        closeAfterSave: false,
        lastCommittedRate: clampRate(currentRate),
    };

    setTimeout(() => {
        outsideClickListener = (e) => {
            if (!editor.contains(e.target)) {
                void flushCellEditorChanges({ close: true });
            }
        };
        document.addEventListener('mousedown', outsideClickListener);
    }, 100);
}

export function flushCellEditorChanges(options = {}) {
    const { close = false } = options;

    if (!activeEditor) {
        return pendingCommitPromise || Promise.resolve(false);
    }

    const clampedRate = clampRate(activeEditor.input?.value);
    if (clampedRate === activeEditor.lastCommittedRate) {
        if (close) closeCellEditor();
        return pendingCommitPromise || Promise.resolve(false);
    }

    return activeEditor.save({ closeAfterSave: close });
}

export function getCellEditorState() {
    return {
        isOpen: Boolean(activeEditor),
        isSaving: saving,
        hasUnsavedChanges: Boolean(activeEditor) && clampRate(activeEditor.input?.value) !== activeEditor.lastCommittedRate,
        pendingRate: activeEditor ? clampRate(activeEditor.input?.value) : null,
        committedRate: activeEditor ? activeEditor.lastCommittedRate : null,
    };
}

export function closeCellEditor() {
    const editor = document.getElementById('cell-editor');
    if (editor) {
        editor.hidden = true;
    }
    if (activeEditor) {
        activeEditor.cleanup();
        activeEditor = null;
    }
}

export function isCellEditorOpen() {
    const editor = document.getElementById('cell-editor');
    return Boolean(editor && !editor.hidden);
}
