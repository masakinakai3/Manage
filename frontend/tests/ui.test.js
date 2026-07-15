// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('shared UI state and error messages', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = `
            <span id="data-state" data-role="data-state" data-state="stale"></span>
            <span id="save-state" data-role="save-state" data-state="idle"></span>
            <div id="dialog-overlay" hidden>
                <div role="dialog">
                    <h2 id="dialog-title"></h2>
                    <p id="dialog-message"></p>
                    <input id="dialog-input" hidden>
                    <button id="dialog-cancel" type="button">キャンセル</button>
                    <button id="dialog-confirm" type="button">実行</button>
                </div>
            </div>
            <div id="toast-container"></div>
        `;
    });

    it('localizes authentication, network, and HTTP errors', async () => {
        const { formatError } = await import('../js/ui.js');

        expect(formatError(Object.assign(new Error('Invalid credentials'), { status: 401 })))
            .toBe('ユーザー名またはパスワードが正しくありません。');
        expect(formatError(Object.assign(new TypeError('Failed to fetch'), { isNetworkError: true })))
            .toBe('サーバーに接続できません。接続を確認して再試行してください。');
        expect(formatError(Object.assign(new Error('HTTP 500'), { status: 500 })))
            .toBe('サーバーでエラーが発生しました。しばらくしてから再試行してください。');
    });

    it('separates data freshness from save feedback', async () => {
        const { setDataState, setSaveState } = await import('../js/ui.js');

        setDataState('offline', 'オフライン');
        setSaveState('saving', '保存中');

        expect(document.getElementById('data-state')?.dataset.state).toBe('offline');
        expect(document.getElementById('data-state')?.textContent).toBe('オフライン');
        expect(document.getElementById('save-state')?.dataset.state).toBe('saving');
        expect(document.getElementById('save-state')?.textContent).toBe('保存中');
    });

    it('closes a shared dialog with Escape while an input is focused', async () => {
        const { initUi, showPromptDialog } = await import('../js/ui.js');
        initUi();
        const result = showPromptDialog({ title: '名前', message: '入力してください' });
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        document.getElementById('dialog-input')?.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
        }));

        await expect(result).resolves.toBeNull();
        expect(document.getElementById('dialog-overlay')?.hidden).toBe(true);
    });
});
