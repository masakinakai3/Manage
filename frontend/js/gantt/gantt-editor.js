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

// Blank input means "no allocation" (null); an explicit "0" is a real,
// distinct value that must be persisted and displayed as "0%".
function parseRateInput(value) {
    const trimmed = String(value ?? '').trim();
    if (trimmed === '') return null;
    return clampRate(trimmed);
}

function formatRateInputValue(rate) {
    return rate === null || rate === undefined ? '' : String(rate);
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
        allocation_rate: null,
    }));
    const applyCommittedValue = buildSuccessApplier({ optimisticSave, onSave, onCommitSuccess });

    editor.style.left = '0px';
    editor.style.top = '0px';
    editor.hidden = false;

    // Position the editor near the cell, keeping it inside the viewport so the
    // input and its action buttons are never clipped at the right/bottom edge.
    const margin = 8;
    const editorRect = editor.getBoundingClientRect();
    const editorWidth = editorRect.width || 240;
    const editorHeight = editorRect.height || 48;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + editorWidth > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - editorWidth - margin);
    }
    if (top + editorHeight > window.innerHeight - margin) {
        const above = rect.top - editorHeight - 4;
        top = above >= margin ? above : Math.max(margin, window.innerHeight - editorHeight - margin);
    }
    editor.style.left = `${Math.max(margin, left)}px`;
    editor.style.top = `${Math.max(margin, top)}px`;

    // Mark the edited cell so it shows a clean, continuous blinking ring that
    // sits above its neighbours (unlike the inset ring of `is-selected`, which
    // gets partially overpainted by adjacent cells and the month column).
    if (cellEl) {
        cellEl.classList.add('is-editing');
    }

    input.value = formatRateInputValue(initialValue);
    input.focus();
    if (selectOnOpen) {
        input.select();
    } else {
        const end = String(input.value).length;
        input.setSelectionRange(end, end);
    }

    let outsideClickListener = null;

    const readInputRate = () => parseRateInput(input.value);

    const sanitizeInput = () => {
        const digitsOnly = String(input.value || '').replace(/[^\d]/g, '');
        if (input.value !== digitsOnly) {
            input.value = digitsOnly;
        }
    };

    // Clearing (blank input, or the Clear button) removes the allocation
    // entirely, distinct from committing an explicit "0".
    const clearRate = ({ closeAfterSave = false } = {}) => {
        if (!activeEditor) return Promise.resolve(false);
        if (saving) {
            if (closeAfterSave) {
                activeEditor.closeAfterSave = true;
            }
            return pendingCommitPromise || Promise.resolve(false);
        }

        saving = true;
        setSaveState('saving', 'セルをクリアしています...');

        if (optimisticSave && onSave) {
            onSave(null);
        }

        pendingCommitPromise = Promise.resolve(clearChange()).then(() => {
            if (activeEditor) {
                activeEditor.lastCommittedRate = null;
            }
            input.value = '';
            applyCommittedValue(null);
            setSaveState('saved', `${month} の配分をクリアしました`);
            if (closeAfterSave || activeEditor?.closeAfterSave) {
                closeCellEditor();
            } else if (document.activeElement !== input) {
                input.focus();
                input.select();
            } else {
                input.select();
            }
            return true;
        }).catch((err) => {
            console.error('Failed to clear:', err);
            setSaveState('error', 'セルのクリアに失敗しました');
            showToast(`セルのクリアに失敗しました: ${formatError(err)}`, 'error');
            throw err;
        }).finally(() => {
            saving = false;
            pendingCommitPromise = null;
        });

        return pendingCommitPromise;
    };

    const save = ({ closeAfterSave = false } = {}) => {
        if (!activeEditor) return Promise.resolve(false);
        if (saving) {
            if (closeAfterSave) {
                activeEditor.closeAfterSave = true;
            }
            return pendingCommitPromise || Promise.resolve(false);
        }

        const parsedRate = readInputRate();
        if (parsedRate === activeEditor.lastCommittedRate) {
            if (closeAfterSave) closeCellEditor();
            return Promise.resolve(false);
        }

        if (parsedRate === null) {
            return clearRate({ closeAfterSave });
        }

        const clampedRate = parsedRate;
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
            const newRate = readInputRate();
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

    newSaveBtn.addEventListener('click', () => { void save(); });
    newCancelBtn.addEventListener('click', cancel);
    newClearBtn.addEventListener('click', () => { void clearRate({ closeAfterSave: true }); });
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
        lastCommittedRate: currentRate === null || currentRate === undefined ? null : clampRate(currentRate),
        onClose: options.onClose || null,
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

    const parsedRate = parseRateInput(activeEditor.input?.value);
    if (parsedRate === activeEditor.lastCommittedRate) {
        if (close) closeCellEditor();
        return pendingCommitPromise || Promise.resolve(false);
    }

    return activeEditor.save({ closeAfterSave: close });
}

export function getCellEditorState() {
    const pendingRate = activeEditor ? parseRateInput(activeEditor.input?.value) : null;
    return {
        isOpen: Boolean(activeEditor),
        isSaving: saving,
        hasUnsavedChanges: Boolean(activeEditor) && pendingRate !== activeEditor.lastCommittedRate,
        pendingRate,
        committedRate: activeEditor ? activeEditor.lastCommittedRate : null,
    };
}

export function closeCellEditor() {
    const editor = document.getElementById('cell-editor');
    if (editor) {
        editor.hidden = true;
    }
    if (activeEditor) {
        if (activeEditor.cellEl) {
            activeEditor.cellEl.classList.remove('is-editing');
        }
        activeEditor.cleanup();
        activeEditor.onClose?.();
        activeEditor = null;
    }
}

export function isCellEditorOpen() {
    const editor = document.getElementById('cell-editor');
    return Boolean(editor && !editor.hidden);
}
