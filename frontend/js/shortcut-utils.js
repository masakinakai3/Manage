const UNDO_REDO_KEYS = new Set(['z', 'y']);
const HISTORY_FIELD_SELECTOR = '#cell-editor-input, #detail-rate, #detail-bulk-rate';
const TEXT_INPUT_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

function isUndoRedoShortcut(event) {
    const key = String(event.key || '').toLowerCase();
    return (event.ctrlKey || event.metaKey) && UNDO_REDO_KEYS.has(key);
}

export function shouldIgnoreShortcut(event) {
    const target = event.target;

    if (isUndoRedoShortcut(event)) {
        if (target?.closest?.(HISTORY_FIELD_SELECTOR)) {
            return Boolean(event.altKey);
        }

        const detailMemo = target?.closest?.('#detail-memo');
        if (detailMemo instanceof HTMLTextAreaElement) {
            const persistedValue = detailMemo.dataset.persistedValue ?? '';
            const hasUnsavedText = detailMemo.value !== persistedValue;
            return Boolean(event.altKey || hasUnsavedText);
        }
    }

    return Boolean(
        event.altKey ||
        target?.closest?.(TEXT_INPUT_SELECTOR),
    );
}
