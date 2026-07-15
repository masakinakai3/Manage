/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Shared UI helpers for notifications, dialogs, and save-state feedback.
 */

import { message } from './messages.js';

let activeDialogResolver = null;
let toastSeed = 0;
let lastFocusedElement = null;
const apiActivity = {
    active: new Set(),
    failures: new Map(),
};
const MESSAGED_ERROR_STATUSES = new Set([400, 401, 403, 404, 409, 422, 500]);

export function initUi() {
    const dialog = document.getElementById('dialog-overlay');
    if (dialog) {
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) resolveDialog(false);
        });
    }

    document.addEventListener('keydown', (event) => {
        const dialog = document.getElementById('dialog-overlay');
        if (dialog?.hidden) return;

        if (event.key === 'Escape' && !event.isComposing) {
            event.preventDefault();
            resolveDialog(false);
            return;
        }

        if (event.key !== 'Tab') return;
        const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]):not([hidden])'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    window.addEventListener('manage:api-state', handleApiState);
    window.addEventListener('offline', () => setDataState('offline', message('data.offline')));
    window.addEventListener('online', () => setDataState('stale', message('data.checking')));
    setDataState(
        navigator.onLine === false ? 'offline' : 'stale',
        message(navigator.onLine === false ? 'data.offline' : 'data.checking'),
    );
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
    closeBtn.setAttribute('aria-label', message('action.closeNotification'));
    closeBtn.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>';
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

export function setDataState(state, message) {
    const badges = document.querySelectorAll('[data-role="data-state"], #data-state');
    badges.forEach((badge) => {
        badge.dataset.state = state;
        badge.textContent = message;
    });
}

export function setBusyState(isBusy, statusMessage = '') {
    const badges = document.querySelectorAll('[data-role="busy-state"], #busy-state');
    if (badges.length === 0) return;

    badges.forEach((badge) => {
        badge.hidden = !isBusy;
        badge.textContent = statusMessage || message('busy.default');
    });
}

export function formatError(error, fallback = message('error.default')) {
    if (!error) return fallback;
    const rawMessage = typeof error === 'string' ? error : String(error.message || '');
    const lowerMessage = rawMessage.toLowerCase();
    const status = Number(error?.status || rawMessage.match(/http\s+(\d{3})/i)?.[1] || 0);

    if (lowerMessage.includes('invalid credentials')) {
        return message('auth.invalidCredentials');
    }
    if (lowerMessage.includes('failed to fetch') || lowerMessage.includes('networkerror') || error?.isNetworkError) {
        return message('error.network');
    }
    if (MESSAGED_ERROR_STATUSES.has(status)) return message(`error.${status}`);
    if (/[ぁ-んァ-ヶ一-龠]/.test(rawMessage)) return rawMessage;
    return fallback;
}

function handleApiState(event) {
    const detail = event.detail || {};
    const requestId = String(detail.requestId || detail.path || 'unknown');
    const path = String(detail.path || requestId);

    if (detail.state === 'loading') {
        apiActivity.active.add(requestId);
        if (apiActivity.failures.size === 0) setDataState('loading', message('data.loading'));
        return;
    }

    apiActivity.active.delete(requestId);
    if (detail.state === 'success') {
        apiActivity.failures.delete(path);
        if (apiActivity.active.size === 0 && apiActivity.failures.size === 0) {
            const time = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(new Date());
            setDataState('fresh', message('data.fresh', { time }));
        }
        return;
    }

    apiActivity.failures.set(path, detail);
    setDataState(
        detail.state === 'offline' ? 'offline' : 'error',
        message(detail.state === 'offline' ? 'data.offline' : 'data.error'),
    );
}

export function showConfirmDialog({
    title,
    message: dialogMessage,
    confirmText = message('action.execute'),
    cancelText = message('action.cancel'),
    danger = false,
}) {
    const overlay = document.getElementById('dialog-overlay');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const cancelBtn = document.getElementById('dialog-cancel');
    const confirmBtn = document.getElementById('dialog-confirm');

    if (!overlay || !titleEl || !messageEl || !cancelBtn || !confirmBtn) {
        return Promise.resolve(window.confirm(dialogMessage));
    }

    rememberFocus();
    titleEl.textContent = title;
    messageEl.textContent = dialogMessage;
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
    message: dialogMessage,
    defaultValue = '',
    confirmText = message('action.save'),
    cancelText = message('action.cancel'),
}) {
    const overlay = document.getElementById('dialog-overlay');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const input = document.getElementById('dialog-input');
    const cancelBtn = document.getElementById('dialog-cancel');
    const confirmBtn = document.getElementById('dialog-confirm');

    if (!overlay || !titleEl || !messageEl || !input || !cancelBtn || !confirmBtn) {
        return Promise.resolve(window.prompt(dialogMessage, defaultValue));
    }

    rememberFocus();
    titleEl.textContent = title;
    messageEl.textContent = dialogMessage;
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
