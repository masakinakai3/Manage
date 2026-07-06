/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Shared UI helpers for notifications, dialogs, and save-state feedback.
 */

let activeDialogResolver = null;
let toastSeed = 0;
let lastFocusedElement = null;

export function initUi() {
    const dialog = document.getElementById('dialog-overlay');
    if (dialog) {
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) resolveDialog(false);
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!document.getElementById('dialog-overlay')?.hidden) {
            event.preventDefault();
            resolveDialog(false);
        }
    });
}

export function showToast(message, type = 'info', timeout = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Errors linger longer so long messages can be read before auto-dismiss.
    const effectiveTimeout = type === 'error' ? Math.max(timeout, 6000) : timeout;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.dataset.toastId = String(++toastSeed);
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;
    toast.appendChild(text);

    let removed = false;
    let dismissTimer = null;
    const dismiss = () => {
        if (removed) return;
        removed = true;
        if (dismissTimer) window.clearTimeout(dismissTimer);
        toast.classList.add('toast-exit');
        window.setTimeout(() => toast.remove(), 180);
    };

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', '通知を閉じる');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', dismiss);
    toast.appendChild(closeBtn);

    // Pause auto-dismiss while the pointer is over the toast.
    toast.addEventListener('mouseenter', () => {
        if (dismissTimer) window.clearTimeout(dismissTimer);
    });
    toast.addEventListener('mouseleave', () => {
        dismissTimer = window.setTimeout(dismiss, 1200);
    });

    container.appendChild(toast);
    dismissTimer = window.setTimeout(dismiss, effectiveTimeout);
}

export function setSaveState(state, message) {
    const badges = document.querySelectorAll('[data-role="save-state"], #save-state');
    if (badges.length === 0) return;

    badges.forEach((badge) => {
        badge.dataset.state = state;
        badge.textContent = message;
    });
}

export function setBusyState(isBusy, message = '') {
    const badges = document.querySelectorAll('[data-role="busy-state"], #busy-state');
    if (badges.length === 0) return;

    badges.forEach((badge) => {
        badge.hidden = !isBusy;
        badge.textContent = message || '処理中...';
    });
}

export function formatError(error, fallback = '処理に失敗しました。') {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    return error.message || fallback;
}

export function showConfirmDialog({
    title,
    message,
    confirmText = '実行する',
    cancelText = 'キャンセル',
    danger = false,
}) {
    const overlay = document.getElementById('dialog-overlay');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const cancelBtn = document.getElementById('dialog-cancel');
    const confirmBtn = document.getElementById('dialog-confirm');

    if (!overlay || !titleEl || !messageEl || !cancelBtn || !confirmBtn) {
        return Promise.resolve(window.confirm(message));
    }

    rememberFocus();
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    overlay.hidden = false;

    return new Promise((resolve) => {
        activeDialogResolver = resolve;
        cancelBtn.onclick = () => resolveDialog(false);
        confirmBtn.onclick = () => resolveDialog(true);
        window.setTimeout(() => confirmBtn.focus(), 0);
    });
}

export function showPromptDialog({
    title,
    message,
    defaultValue = '',
    confirmText = '保存',
    cancelText = 'キャンセル',
}) {
    const overlay = document.getElementById('dialog-overlay');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const input = document.getElementById('dialog-input');
    const cancelBtn = document.getElementById('dialog-cancel');
    const confirmBtn = document.getElementById('dialog-confirm');

    if (!overlay || !titleEl || !messageEl || !input || !cancelBtn || !confirmBtn) {
        return Promise.resolve(window.prompt(message, defaultValue));
    }

    rememberFocus();
    titleEl.textContent = title;
    messageEl.textContent = message;
    input.hidden = false;
    input.value = defaultValue;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.className = 'btn btn-primary';
    overlay.hidden = false;

    return new Promise((resolve) => {
        activeDialogResolver = (accepted) => resolve(accepted ? input.value.trim() : null);
        cancelBtn.onclick = () => resolveDialog(false);
        confirmBtn.onclick = () => resolveDialog(true);
        input.onkeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                resolveDialog(true);
            }
        };
        window.setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
    });
}

function rememberFocus() {
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function restoreFocus() {
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
        lastFocusedElement.focus();
    }
    lastFocusedElement = null;
}

function resolveDialog(result) {
    const overlay = document.getElementById('dialog-overlay');
    const input = document.getElementById('dialog-input');
    const resolver = activeDialogResolver;
    activeDialogResolver = null;

    if (overlay) overlay.hidden = true;
    if (input) {
        input.hidden = true;
        input.value = '';
        input.onkeydown = null;
    }

    restoreFocus();
    if (resolver) resolver(result);
}
