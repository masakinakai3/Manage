import { describe, expect, it } from 'vitest';

import { shouldIgnoreShortcut } from '../js/shortcut-utils.js';

function createShortcutEvent(target, overrides = {}) {
    return {
        altKey: false,
        ctrlKey: true,
        key: 'z',
        metaKey: false,
        target,
        ...overrides,
    };
}

describe('shouldIgnoreShortcut', () => {
    it('allows undo and redo shortcuts in the saved detail memo field', () => {
        document.body.innerHTML = '<textarea id="detail-memo"></textarea>';
        const detailMemo = document.getElementById('detail-memo');
        detailMemo.value = '保存済みメモ';
        detailMemo.dataset.persistedValue = '保存済みメモ';

        expect(shouldIgnoreShortcut(createShortcutEvent(detailMemo))).toBe(false);
        expect(shouldIgnoreShortcut(createShortcutEvent(detailMemo, { key: 'y' }))).toBe(false);
    });

    it('keeps native textarea undo while the detail memo has unsaved edits', () => {
        document.body.innerHTML = '<textarea id="detail-memo"></textarea>';
        const detailMemo = document.getElementById('detail-memo');
        detailMemo.value = '編集中のメモ';
        detailMemo.dataset.persistedValue = '保存済みメモ';

        expect(shouldIgnoreShortcut(createShortcutEvent(detailMemo))).toBe(true);
    });

    it('still allows undo shortcuts in numeric history fields', () => {
        document.body.innerHTML = '<input id="detail-rate"><input id="detail-bulk-rate"><input id="cell-editor-input">';

        expect(shouldIgnoreShortcut(createShortcutEvent(document.getElementById('detail-rate')))).toBe(false);
        expect(shouldIgnoreShortcut(createShortcutEvent(document.getElementById('detail-bulk-rate')))).toBe(false);
        expect(shouldIgnoreShortcut(createShortcutEvent(document.getElementById('cell-editor-input')))).toBe(false);
    });
});
