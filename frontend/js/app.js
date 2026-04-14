/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

import { auth, themes as themesApi, members as membersApi, allocations, dataBackup, savedViews as savedViewsApi } from './api.js';
import { initGantt, refreshGantt, HistoryManager, getGanttExportDataset } from './gantt/gantt-renderer.js';
import { initInsightsView, refreshInsightsView } from './insights-view.js';
import { initMemberView, refreshMemberView } from './member/member-view.js';
import { deleteSavedView, getPresetConfig, loadOnboardingState, loadSavedViews, loadViewState, updateOnboardingState, updateViewState, upsertSavedView } from './shared-state.js';
import { formatError, initUi, setBusyState, setSaveState, showConfirmDialog, showPromptDialog, showToast } from './ui.js';

const THEME_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981',
    '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#2563eb',
    '#64748b', '#6b7280', '#ef4444', '#dc2626', '#a855f7',
];

const STATUS_LABELS = {
    planning: '計画中',
    active: '進行中',
    completed: '完了',
    cancelled: '中止',
    done: '完了',
    hold: '保留',
};

let currentUser = null;
let currentView = 'gantt';
let savedViewsCache = [];

document.addEventListener('DOMContentLoaded', async () => {
    initUi();
    setSaveState('idle', '起動中...');

    try {
        currentUser = await auth.me();
    } catch (error) {
        console.warn('Auth bootstrap fallback', error);
        currentUser = { username: 'admin', role: 'admin' };
    }

    await showApp();
});

async function showApp() {
    document.getElementById('app-screen').hidden = false;
    document.getElementById('user-name').textContent = currentUser.username;
    document.getElementById('user-avatar').textContent = currentUser.username[0].toUpperCase();

    initNavigation();
    initBackup();
    initUiConfig();
    await initSavedViews();
    initOnboarding();
    initKeyboardShortcuts();
    initAdvancedExport();
    initThemeManagement();
    initMemberManagement();

    await initGantt();
    await initMemberView();
    await initInsightsView();

    setSaveState('saved', '表示内容は最新です');
}

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', (event) => {
            event.preventDefault();
            switchView(item.dataset.view);
        });
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            setBusyState(true, 'ログアウトしています...');
            await auth.logout();
        } finally {
            setBusyState(false);
            location.reload();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (shouldIgnoreShortcut(event)) return;

        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) {
                HistoryManager.redo();
            } else {
                HistoryManager.undo();
            }
        }

        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'y') {
            event.preventDefault();
            HistoryManager.redo();
        }
    });
}

function initBackup() {
    document.getElementById('export-json-btn').addEventListener('click', async () => {
        try {
            setBusyState(true, 'バックアップを作成しています...');
            await dataBackup.exportJson();
            setSaveState('saved', 'バックアップを出力しました');
            showToast('JSON バックアップをダウンロードしました。', 'success');
        } catch (error) {
            setSaveState('error', 'エクスポートに失敗しました');
            showToast(`エクスポートに失敗しました: ${formatError(error)}`, 'error');
        } finally {
            setBusyState(false);
        }
    });

    document.getElementById('import-json-input').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;

        const shouldImport = await showConfirmDialog({
            title: 'JSON をインポートしますか',
            message: `選択ファイル: ${file.name}\nサイズ: ${(file.size / 1024).toFixed(1)} KB\n\n現在のテーマ・メンバー・割当データは、このファイルの内容で置き換わります。`,
            confirmText: 'インポートする',
            cancelText: 'キャンセル',
            danger: true,
        });

        if (!shouldImport) {
            showToast('インポートをキャンセルしました。', 'info');
            return;
        }

        try {
            setBusyState(true, 'インポートしています...');
            const result = await dataBackup.importJson(file);
            await Promise.all([refreshGantt(), refreshMemberView()]);

            setSaveState('saved', 'インポートが完了しました');
            showToast(
                `インポート完了: テーマ ${result.themes} 件 / メンバー ${result.members} 件 / 割当 ${result.allocations} 件`,
                'success',
                4500,
            );
        } catch (error) {
            setSaveState('error', 'インポートに失敗しました');
            showToast(`インポートに失敗しました: ${formatError(error)}`, 'error', 4500);
        } finally {
            setBusyState(false);
        }
    });
}

function initUiConfig() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    const applyTheme = () => {
        const nextTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
    };
    applyTheme();

    themeBtn?.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('theme', nextTheme);
        showToast(`表示テーマを ${nextTheme === 'dark' ? 'ダーク' : 'ライト'} に切り替えました。`, 'info');
    });

    let currentZoom = Number.parseInt(localStorage.getItem('gantt_zoom') || '56', 10);
    const applyZoom = () => {
        document.documentElement.style.setProperty('--cell-width', `${currentZoom}px`);
        localStorage.setItem('gantt_zoom', String(currentZoom));
    };
    applyZoom();

    document.getElementById('gantt-zoom-in')?.addEventListener('click', () => {
        currentZoom = Math.min(120, currentZoom + 10);
        applyZoom();
        showToast(`ガント表示幅を ${currentZoom}px に変更しました。`, 'info');
    });

    document.getElementById('gantt-zoom-out')?.addEventListener('click', () => {
        currentZoom = Math.max(30, currentZoom - 10);
        applyZoom();
        showToast(`ガント表示幅を ${currentZoom}px に変更しました。`, 'info');
    });

    const sharedState = loadViewState();
    document.getElementById('shared-period-preset').value = sharedState.preset;
    document.getElementById('member-period-preset').value = sharedState.preset;

    const updatePreset = (preset) => {
        const config = getPresetConfig(preset);
        updateViewState({ preset, ...config });
        document.getElementById('shared-period-preset').value = preset;
        document.getElementById('member-period-preset').value = preset;
        showToast(`表示期間を「${presetLabel(preset)}」に切り替えました。`, 'info');
    };

    document.getElementById('shared-period-preset').addEventListener('change', (event) => updatePreset(event.target.value));
    document.getElementById('member-period-preset').addEventListener('change', (event) => updatePreset(event.target.value));
}

function switchView(viewName) {
    currentView = viewName;

    document.querySelectorAll('.nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });

    document.querySelectorAll('.view').forEach((view) => {
        view.hidden = view.id !== `view-${viewName}`;
        view.classList.toggle('active', view.id === `view-${viewName}`);
    });

    if (viewName === 'gantt') refreshGantt();
    if (viewName === 'member-load') refreshMemberView();
    if (viewName === 'insights') refreshInsightsView();
    if (viewName === 'themes') loadThemeList();
    if (viewName === 'members') loadMemberList();
}

function initThemeManagement() {
    document.getElementById('add-theme-btn').addEventListener('click', () => openThemeModal());
    document.getElementById('theme-list-search').addEventListener('input', loadThemeList);
    document.getElementById('theme-list-sort').addEventListener('change', loadThemeList);
}

async function loadThemeList() {
    const list = document.getElementById('theme-list');
    const search = document.getElementById('theme-list-search').value.trim().toLowerCase();
    const sort = document.getElementById('theme-list-sort').value;

    try {
        let allThemes = await themesApi.list();

        allThemes = allThemes.filter((theme) => {
            if (!search) return true;
            return [theme.name, theme.category || ''].some((value) => value.toLowerCase().includes(search));
        });

        allThemes.sort((left, right) => {
            if (sort === 'priority-desc') return (right.priority || 0) - (left.priority || 0);
            if (sort === 'status-asc') return (STATUS_LABELS[left.status] || left.status).localeCompare(STATUS_LABELS[right.status] || right.status, 'ja');
            if (sort === 'member-desc') return (right.member_count || 0) - (left.member_count || 0);
            return left.name.localeCompare(right.name, 'ja');
        });

        if (allThemes.length === 0) {
            list.innerHTML = '<p class="summary-subtext">条件に一致するテーマがありません。</p>';
            return;
        }

        list.innerHTML = allThemes.map((theme) => `
            <div class="card">
                <div class="card-header">
                    <div class="card-title">
                        <span class="card-color-dot" style="background:${theme.color}"></span>
                        ${theme.name}
                    </div>
                    <div class="card-actions">
                        <button class="btn btn-ghost btn-sm" data-edit-theme="${theme.theme_id}" type="button">編集</button>
                        <button class="btn btn-danger btn-sm" data-delete-theme="${theme.theme_id}" type="button">削除</button>
                    </div>
                </div>
                <div class="card-meta">
                    <span class="status-badge status-${theme.status}">${STATUS_LABELS[theme.status] || theme.status}</span>
                    <span>${theme.category || 'カテゴリ未設定'}</span>
                    <span>メンバー ${theme.member_count || 0} 名</span>
                    <span>優先度 ${theme.priority ?? 0}</span>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('[data-edit-theme]').forEach((button) => {
            button.addEventListener('click', () => {
                const theme = allThemes.find((item) => item.theme_id === Number.parseInt(button.dataset.editTheme, 10));
                openThemeModal(theme);
            });
        });

        list.querySelectorAll('[data-delete-theme]').forEach((button) => {
            button.addEventListener('click', async () => {
                const shouldDelete = await showConfirmDialog({
                    title: 'テーマを削除しますか',
                    message: '関連する割当データも削除されます。この操作は元に戻せません。',
                    confirmText: '削除する',
                    cancelText: 'キャンセル',
                    danger: true,
                });

                if (!shouldDelete) return;

                try {
                    await themesApi.delete(Number.parseInt(button.dataset.deleteTheme, 10));
                    setSaveState('saved', 'テーマを削除しました');
                    showToast('テーマを削除しました。', 'success');
                    await loadThemeList();
                    await refreshGantt();
                    await refreshMemberView();
                } catch (error) {
                    setSaveState('error', 'テーマ削除に失敗しました');
                    showToast(`テーマ削除に失敗しました: ${formatError(error)}`, 'error');
                }
            });
        });
    } catch (error) {
        list.innerHTML = `<p class="summary-subtext">${formatError(error, 'テーマ一覧の取得に失敗しました。')}</p>`;
    }
}

async function openThemeModal(theme = null) {
    const isEdit = Boolean(theme);
    document.getElementById('modal-title').textContent = isEdit ? 'テーマを編集' : 'テーマを追加';

    let existingThemes = [];
    try {
        existingThemes = await themesApi.list();
    } catch (error) {
        console.warn('Failed to preload themes for color picker', error);
    }

    const usedColorsMap = {};
    existingThemes.forEach((item) => {
        if (isEdit && item.theme_id === theme.theme_id) return;
        if (!usedColorsMap[item.color]) usedColorsMap[item.color] = [];
        usedColorsMap[item.color].push(item.name);
    });

    const selectedColor = theme?.color || THEME_COLORS[0];
    const colorOptions = THEME_COLORS.map((color) => {
        const usedBy = usedColorsMap[color] || [];
        const title = usedBy.length > 0 ? `使用中: ${usedBy.join(', ')}` : '未使用';
        const border = color === selectedColor ? 'var(--color-text)' : 'transparent';
        return `<span class="card-color-dot ${usedBy.length ? 'is-used' : ''}" style="background:${color};width:24px;height:24px;cursor:pointer;border:2px solid ${border};margin:2px" data-color="${color}" title="${title}"></span>`;
    }).join('');
    const initialMilestones = Array.isArray(theme?.milestones) && theme.milestones.length > 0
        ? theme.milestones.map((item) => ({ month: item.month || '', label: item.label || '' }))
        : (theme?.milestone_month ? [{ month: theme.milestone_month, label: theme.milestone_label || '' }] : [{ month: '', label: '' }]);

    const renderMilestoneRow = (item = { month: '', label: '' }) => `
        <div class="theme-milestone-row" style="display:grid;grid-template-columns:140px 1fr auto;gap:8px;align-items:center;margin-bottom:8px;">
            <input class="theme-milestone-month" type="month" value="${item.month || ''}">
            <input class="theme-milestone-label" type="text" value="${item.label || ''}" placeholder="例: リリース">
            <button class="btn btn-ghost btn-sm theme-milestone-remove" type="button">削除</button>
        </div>
    `;

    document.getElementById('modal-body').innerHTML = `
        <div class="form-field">
            <label for="modal-theme-name">テーマ名</label>
            <input id="modal-theme-name" type="text" value="${theme?.name || ''}" required>
        </div>
        <div class="form-field">
            <label for="modal-theme-category">カテゴリ</label>
            <input id="modal-theme-category" type="text" value="${theme?.category || ''}">
        </div>
        <div class="form-field">
            <label for="modal-theme-status">ステータス</label>
            <select id="modal-theme-status">
                ${Object.entries(STATUS_LABELS).filter(([key]) => ['planning', 'active', 'completed', 'cancelled'].includes(key)).map(([key, label]) => `
                    <option value="${key}" ${key === (theme?.status || 'planning') ? 'selected' : ''}>${label}</option>
                `).join('')}
            </select>
        </div>
        <div class="form-field">
            <label for="modal-theme-priority">優先度</label>
            <input id="modal-theme-priority" type="number" value="${theme?.priority ?? 0}" min="0" max="9">
        </div>
        <div class="form-field">
            <label>マイルストーン</label>
            <div id="theme-milestones-editor">${initialMilestones.map((item) => renderMilestoneRow(item)).join('')}</div>
            <button class="btn btn-ghost btn-sm" id="theme-milestone-add" type="button">追加</button>
        </div>
        <div class="form-field">
            <label>カラー</label>
            <div id="modal-color-picker">${colorOptions}</div>
            <input id="modal-theme-color" type="hidden" value="${selectedColor}">
        </div>
    `;

    document.querySelectorAll('#modal-color-picker .card-color-dot').forEach((dot) => {
        dot.addEventListener('click', () => {
            document.querySelectorAll('#modal-color-picker .card-color-dot').forEach((item) => {
                item.style.borderColor = 'transparent';
            });
            dot.style.borderColor = 'var(--color-text)';
            document.getElementById('modal-theme-color').value = dot.dataset.color;
        });
    });

    const milestoneEditor = document.getElementById('theme-milestones-editor');
    const bindMilestoneRows = () => {
        milestoneEditor.querySelectorAll('.theme-milestone-remove').forEach((button) => {
            button.onclick = () => {
                const rows = milestoneEditor.querySelectorAll('.theme-milestone-row');
                if (rows.length === 1) {
                    rows[0].querySelector('.theme-milestone-month').value = '';
                    rows[0].querySelector('.theme-milestone-label').value = '';
                    return;
                }
                button.closest('.theme-milestone-row')?.remove();
            };
        });
    };
    document.getElementById('theme-milestone-add').onclick = () => {
        milestoneEditor.insertAdjacentHTML('beforeend', renderMilestoneRow());
        bindMilestoneRows();
    };
    bindMilestoneRows();

    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-ghost" id="modal-cancel-btn" type="button">キャンセル</button>
        <button class="btn btn-primary" id="modal-save-btn" type="button">${isEdit ? '更新する' : '追加する'}</button>
    `;

    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-cancel-btn').onclick = closeModal;
    document.getElementById('modal-save-btn').onclick = async () => {
        const payload = {
            name: document.getElementById('modal-theme-name').value.trim(),
            category: document.getElementById('modal-theme-category').value.trim(),
            status: document.getElementById('modal-theme-status').value,
            color: document.getElementById('modal-theme-color').value,
            priority: Number.parseInt(document.getElementById('modal-theme-priority').value || '0', 10),
            milestones: Array.from(document.querySelectorAll('#theme-milestones-editor .theme-milestone-row'))
                .map((row) => ({
                    month: row.querySelector('.theme-milestone-month')?.value || '',
                    label: row.querySelector('.theme-milestone-label')?.value.trim() || '',
                }))
                .filter((item) => item.month),
        };

        if (!payload.name) {
            showToast('テーマ名を入力してください。', 'warning');
            return;
        }

        try {
            setSaveState('saving', isEdit ? 'テーマを更新しています...' : 'テーマを追加しています...');
            if (isEdit) {
                await themesApi.update(theme.theme_id, payload);
            } else {
                await themesApi.create(payload);
            }

            closeModal();
            await loadThemeList();
            await refreshGantt();
            setSaveState('saved', isEdit ? 'テーマを更新しました' : 'テーマを追加しました');
            showToast(isEdit ? 'テーマを更新しました。' : 'テーマを追加しました。', 'success');
        } catch (error) {
            setSaveState('error', 'テーマ保存に失敗しました');
            showToast(`テーマ保存に失敗しました: ${formatError(error)}`, 'error');
        }
    };
}

function initMemberManagement() {
    document.getElementById('add-member-btn').addEventListener('click', () => openMemberModal());
    document.getElementById('member-list-search').addEventListener('input', loadMemberList);
    document.getElementById('member-list-sort').addEventListener('change', loadMemberList);
}

async function loadMemberList() {
    const list = document.getElementById('member-list');
    const search = document.getElementById('member-list-search').value.trim().toLowerCase();
    const sort = document.getElementById('member-list-sort').value;

    try {
        let allMembers = await membersApi.list(false);
        allMembers = allMembers.filter((member) => {
            if (!search) return true;
            return [member.display_name, member.department || ''].some((value) => value.toLowerCase().includes(search));
        });

        allMembers.sort((left, right) => {
            if (sort === 'capacity-desc') return (right.capacity || 0) - (left.capacity || 0);
            if (sort === 'department-asc') return (left.department || '').localeCompare(right.department || '', 'ja');
            if (sort === 'active-desc') return Number(right.is_active) - Number(left.is_active);
            return left.display_name.localeCompare(right.display_name, 'ja');
        });

        if (allMembers.length === 0) {
            list.innerHTML = '<p class="summary-subtext">条件に一致するメンバーがありません。</p>';
            return;
        }

        list.innerHTML = allMembers.map((member) => `
            <div class="card" style="opacity:${member.is_active ? 1 : 0.55}">
                <div class="card-header">
                    <div class="card-title">${member.display_name}</div>
                    <div class="card-actions">
                        <button class="btn btn-ghost btn-sm" data-edit-member="${member.member_id}" type="button">編集</button>
                        <button class="btn btn-danger btn-sm" data-delete-member="${member.member_id}" type="button">削除</button>
                    </div>
                </div>
                <div class="card-meta">
                    <span>${member.department || '部署未設定'}</span>
                    <span>稼働上限 ${member.capacity}%</span>
                    <span class="status-badge ${member.is_active ? 'status-active' : 'status-done'}">${member.is_active ? '有効' : '無効'}</span>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('[data-edit-member]').forEach((button) => {
            button.addEventListener('click', () => {
                const member = allMembers.find((item) => item.member_id === Number.parseInt(button.dataset.editMember, 10));
                openMemberModal(member);
            });
        });

        list.querySelectorAll('[data-delete-member]').forEach((button) => {
            button.addEventListener('click', async () => {
                const shouldDelete = await showConfirmDialog({
                    title: 'メンバーを削除しますか',
                    message: '割当データも削除されます。必要なら先に JSON エクスポートを実施してください。',
                    confirmText: '削除する',
                    cancelText: 'キャンセル',
                    danger: true,
                });

                if (!shouldDelete) return;

                try {
                    await membersApi.delete(Number.parseInt(button.dataset.deleteMember, 10));
                    setSaveState('saved', 'メンバーを削除しました');
                    showToast('メンバーを削除しました。', 'success');
                    await loadMemberList();
                    await refreshGantt();
                    await refreshMemberView();
                } catch (error) {
                    setSaveState('error', 'メンバー削除に失敗しました');
                    showToast(`メンバー削除に失敗しました: ${formatError(error)}`, 'error');
                }
            });
        });
    } catch (error) {
        list.innerHTML = `<p class="summary-subtext">${formatError(error, 'メンバー一覧の取得に失敗しました。')}</p>`;
    }
}

function openMemberModal(member = null) {
    const isEdit = Boolean(member);
    document.getElementById('modal-title').textContent = isEdit ? 'メンバーを編集' : 'メンバーを追加';

    document.getElementById('modal-body').innerHTML = `
        <div class="form-field">
            <label for="modal-member-name">表示名</label>
            <input id="modal-member-name" type="text" value="${member?.display_name || ''}" required>
        </div>
        <div class="form-field">
            <label for="modal-member-dept">部署</label>
            <input id="modal-member-dept" type="text" value="${member?.department || ''}">
        </div>
        <div class="form-field">
            <label for="modal-member-capacity">稼働上限 (%)</label>
            <input id="modal-member-capacity" type="number" value="${member?.capacity ?? 100}" min="1" max="200">
        </div>
        ${isEdit ? `
            <div class="form-field">
                <label for="modal-member-active">状態</label>
                <select id="modal-member-active">
                    <option value="true" ${member.is_active ? 'selected' : ''}>有効</option>
                    <option value="false" ${!member.is_active ? 'selected' : ''}>無効</option>
                </select>
            </div>
        ` : ''}
    `;

    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-ghost" id="modal-cancel-btn" type="button">キャンセル</button>
        <button class="btn btn-primary" id="modal-save-btn" type="button">${isEdit ? '更新する' : '追加する'}</button>
    `;

    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-cancel-btn').onclick = closeModal;
    document.getElementById('modal-save-btn').onclick = async () => {
        const payload = {
            display_name: document.getElementById('modal-member-name').value.trim(),
            department: document.getElementById('modal-member-dept').value.trim(),
            capacity: Number.parseInt(document.getElementById('modal-member-capacity').value || '100', 10),
        };

        if (!payload.display_name) {
            showToast('表示名を入力してください。', 'warning');
            return;
        }

        if (isEdit) {
            payload.is_active = document.getElementById('modal-member-active').value === 'true';
        }

        try {
            setSaveState('saving', isEdit ? 'メンバーを更新しています...' : 'メンバーを追加しています...');
            if (isEdit) {
                await membersApi.update(member.member_id, payload);
            } else {
                await membersApi.create(payload);
            }

            closeModal();
            await loadMemberList();
            await refreshMemberView();
            setSaveState('saved', isEdit ? 'メンバーを更新しました' : 'メンバーを追加しました');
            showToast(isEdit ? 'メンバーを更新しました。' : 'メンバーを追加しました。', 'success');
        } catch (error) {
            setSaveState('error', 'メンバー保存に失敗しました');
            showToast(`メンバー保存に失敗しました: ${formatError(error)}`, 'error');
        }
    };
}

function closeModal() {
    document.getElementById('modal-overlay').hidden = true;
}

function presetLabel(value) {
    const labels = {
        'rolling-6': '直近 6 か月',
        'rolling-12': '直近 12 か月',
        'current-quarter': '今四半期',
        'current-year': '今年',
    };
    return labels[value] || value;
}

async function initSavedViews() {
    document.getElementById('saved-view-apply-btn')?.addEventListener('click', applySelectedSavedView);
    document.getElementById('saved-view-save-btn')?.addEventListener('click', saveCurrentView);
    document.getElementById('saved-view-delete-btn')?.addEventListener('click', deleteCurrentSavedView);
    await syncSavedViewsFromLocal();
    await reloadSavedViews();
}

async function syncSavedViewsFromLocal() {
    const localViews = loadSavedViews();
    if (localViews.length === 0) return;

    for (const view of localViews) {
        try {
            await savedViewsApi.upsert(view);
        } catch (error) {
            console.warn('Failed to migrate local saved view', error);
            return;
        }
    }

    localStorage.removeItem('manage_saved_views');
}

async function reloadSavedViews(selectedId = '') {
    try {
        const views = await savedViewsApi.list();
        savedViewsCache = views.map((view) => ({
            ...view,
            state: parseSavedViewState(view.state),
        }));
    } catch (error) {
        console.warn('Failed to load saved views from API, falling back to local storage', error);
        savedViewsCache = loadSavedViews();
    }
    refreshSavedViewOptions();
    if (selectedId) refreshSavedViewOptions(selectedId);
}

function refreshSavedViewOptions(selectedId = '') {
    const select = document.getElementById('saved-view-select');
    if (!select) return;

    select.innerHTML = '<option value="">Saved views</option>' + savedViewsCache.map((view) => `<option value="${view.id}">${view.name}</option>`).join('');
    if (selectedId && savedViewsCache.some((view) => view.id === selectedId)) {
        select.value = selectedId;
    }
}

async function saveCurrentView() {
    const defaultName = currentView === 'member-load'
        ? `Member review ${new Date().toLocaleString('ja-JP')}`
        : `Planning ${new Date().toLocaleString('ja-JP')}`;
    const name = (await showPromptDialog({
        title: 'Save current view',
        message: 'Enter a name for this view.',
        defaultValue: defaultName,
        confirmText: 'Save',
        cancelText: 'Cancel',
    })) || defaultName;

    const viewState = loadViewState();
    const savedView = {
        id: `view-${Date.now()}`,
        name,
        view: currentView,
        state: {
            ...viewState,
            groupBy: document.getElementById('gantt-group-by')?.value || viewState.groupBy || 'none',
        },
    };

    savedViewsCache = mergeSavedView(savedViewsCache, savedView);
    refreshSavedViewOptions(savedView.id);

    try {
        await savedViewsApi.upsert(savedView);
        upsertSavedView(savedView);
        await reloadSavedViews(savedView.id);
    } catch (error) {
        upsertSavedView(savedView);
        savedViewsCache = loadSavedViews();
        refreshSavedViewOptions(savedView.id);
        console.warn('Saved view API unavailable, used local storage fallback', error);
    }
    showToast('Saved view was added.', 'success');
}

function applySelectedSavedView() {
    const select = document.getElementById('saved-view-select');
    if (!select?.value) return;
    const view = savedViewsCache.find((item) => item.id === select.value) || loadSavedViews().find((item) => item.id === select.value);
    if (!view) return;

    updateViewState(view.state || {});
    if (view.state?.groupBy) {
        const groupByInput = document.getElementById('gantt-group-by');
        if (groupByInput) groupByInput.value = view.state.groupBy;
    }
    switchView(view.view || 'gantt');
    showToast(`Applied saved view: ${view.name}`, 'info');
}

async function deleteCurrentSavedView() {
    const select = document.getElementById('saved-view-select');
    if (!select?.value) return;

    try {
        await savedViewsApi.delete(select.value);
    } catch (error) {
        console.warn('Failed to delete saved view from API, removing local fallback only', error);
    }

    deleteSavedView(select.value);
    await reloadSavedViews();
    showToast('Saved view was deleted.', 'info');
}

function parseSavedViewState(rawState) {
    if (!rawState) return {};
    if (typeof rawState === 'object') return rawState;
    try {
        return JSON.parse(rawState);
    } catch {
        return {};
    }
}

function mergeSavedView(views, savedView) {
    return [...views.filter((view) => view.id !== savedView.id), savedView]
        .sort((left, right) => left.name.localeCompare(right.name, 'ja'));
}

function initOnboarding() {
    const onboarding = loadOnboardingState();
    const banner = document.getElementById('onboarding-panel');
    if (!banner) return;

    banner.hidden = onboarding.dismissed;
    document.getElementById('onboarding-dismiss-btn')?.addEventListener('click', () => {
        updateOnboardingState({ dismissed: true });
        banner.hidden = true;
    });
    document.getElementById('onboarding-sample-btn')?.addEventListener('click', createSampleData);
}

async function createSampleData() {
    try {
        setBusyState(true, 'Creating sample data...');
        const existingThemes = await themesApi.list();
        const existingMembers = await membersApi.list(false);
        if (existingThemes.length > 0 || existingMembers.length > 0) {
            const shouldContinue = await showConfirmDialog({
                title: 'Create sample data',
                message: 'Existing data was found. Sample records will be appended. Continue?',
                confirmText: 'Add',
                cancelText: 'Cancel',
            });
            if (!shouldContinue) return;
        }

        const members = await Promise.all([
            membersApi.create({ display_name: 'Aoi Tanaka', department: 'Platform', capacity: 100 }),
            membersApi.create({ display_name: 'Haru Sato', department: 'Platform', capacity: 80 }),
            membersApi.create({ display_name: 'Mio Suzuki', department: 'Product', capacity: 100 }),
        ]);
        const themes = await Promise.all([
            themesApi.create({ name: 'Core Renewal', category: 'Platform', status: 'active', priority: 9, color: '#6366f1', start_month: '2026-04', end_month: '2026-09' }),
            themesApi.create({ name: 'Mobile Approval', category: 'Product', status: 'active', priority: 7, color: '#14b8a6', start_month: '2026-04', end_month: '2026-07' }),
            themesApi.create({ name: 'Data Cleanup', category: 'Ops', status: 'planning', priority: 6, color: '#f97316', start_month: '2026-05', end_month: '2026-08' }),
        ]);

        await Promise.all([
            themesApi.assignMembersBulk(themes[0].theme_id, [members[0].member_id, members[1].member_id]),
            themesApi.assignMembersBulk(themes[1].theme_id, [members[2].member_id]),
            themesApi.assignMembersBulk(themes[2].theme_id, [members[1].member_id, members[2].member_id]),
        ]);

        await allocations.bulkUpdate([
            { theme_id: themes[0].theme_id, member_id: members[0].member_id, month: '2026-04', allocation_rate: 70, memo: 'Architecture' },
            { theme_id: themes[0].theme_id, member_id: members[0].member_id, month: '2026-05', allocation_rate: 80, memo: 'Implementation' },
            { theme_id: themes[0].theme_id, member_id: members[1].member_id, month: '2026-04', allocation_rate: 40, memo: 'Support' },
            { theme_id: themes[1].theme_id, member_id: members[2].member_id, month: '2026-04', allocation_rate: 60, memo: 'Approval flow' },
            { theme_id: themes[1].theme_id, member_id: members[2].member_id, month: '2026-05', allocation_rate: 50, memo: 'Review' },
            { theme_id: themes[2].theme_id, member_id: members[1].member_id, month: '2026-05', allocation_rate: 35, memo: 'Audit' },
            { theme_id: themes[2].theme_id, member_id: members[2].member_id, month: '2026-06', allocation_rate: 25, memo: 'Cleanup' },
        ]);

        updateOnboardingState({ dismissed: true, sampleLoaded: true });
        document.getElementById('onboarding-panel').hidden = true;
        await Promise.all([refreshGantt(), refreshMemberView(), refreshInsightsView(), loadThemeList(), loadMemberList()]);
        showToast('Sample data is ready.', 'success');
    } catch (error) {
        showToast(`Failed to create sample data: ${formatError(error)}`, 'error');
    } finally {
        setBusyState(false);
    }
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (shouldIgnoreShortcut(event)) return;

        const key = String(event.key).toLowerCase();
        if (key === '?') {
            event.preventDefault();
            showShortcutHelp();
            return;
        }
        if (key === '/') {
            event.preventDefault();
            focusCurrentSearch();
            return;
        }
        if (key === 'g') switchView('gantt');
        if (key === 'l') switchView('member-load');
        if (key === 'i') switchView('insights');
        if (key === 't') switchView('themes');
        if (key === 'u') switchView('members');
    });
}

function showShortcutHelp() {
    document.getElementById('modal-title').textContent = 'Keyboard shortcuts';
    document.getElementById('modal-body').innerHTML = `
        <div class="shortcut-grid">
            <div><kbd>?</kbd> Open help</div>
            <div><kbd>/</kbd> Focus search</div>
            <div><kbd>g</kbd> Gantt view</div>
            <div><kbd>l</kbd> Member load view</div>
            <div><kbd>i</kbd> Insights view</div>
            <div><kbd>t</kbd> Themes</div>
            <div><kbd>u</kbd> Members</div>
            <div><kbd>Ctrl/Cmd + Z</kbd> Undo</div>
            <div><kbd>Ctrl/Cmd + Shift + Z</kbd> Redo</div>
        </div>
    `;
    document.getElementById('modal-footer').innerHTML = '<button class="btn btn-primary" id="modal-save-btn" type="button">Close</button>';
    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-save-btn').onclick = closeModal;
}

function focusCurrentSearch() {
    const targets = {
        gantt: 'gantt-search',
        'member-load': 'member-search',
        themes: 'theme-list-search',
        members: 'member-list-search',
    };
    const input = document.getElementById(targets[currentView] || 'gantt-search');
    input?.focus();
    input?.select?.();
}

function shouldIgnoreShortcut(event) {
    const target = event.target;
    return Boolean(
        event.altKey ||
        target?.closest?.('input, textarea, select, [contenteditable="true"]'),
    );
}

function initAdvancedExport() {
    document.getElementById('gantt-export-advanced')?.addEventListener('click', openAdvancedExportModal);
    document.getElementById('shortcut-help-btn')?.addEventListener('click', showShortcutHelp);
}

function openAdvancedExportModal() {
    const columns = ['Theme', 'Member', 'Department', 'Month', 'Allocation', 'Memo', 'Category', 'Status', 'Priority', 'Capacity'];
    document.getElementById('modal-title').textContent = 'Advanced export';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-field">
            <label for="export-template">Template</label>
            <select id="export-template">
                <option value="standard">Standard list</option>
                <option value="meeting">Meeting deck</option>
                <option value="review">Monthly review</option>
            </select>
        </div>
        <div class="form-field">
            <label for="export-format">Format</label>
            <select id="export-format">
                <option value="csv">CSV</option>
                <option value="xlsx">Excel</option>
            </select>
        </div>
        <div class="form-field">
            <label>Columns</label>
            <div class="checkbox-grid">
                ${columns.map((column) => `
                    <label class="check-item">
                        <input type="checkbox" value="${column}" checked>
                        <span>${column}</span>
                    </label>
                `).join('')}
            </div>
        </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-ghost" id="modal-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary" id="modal-save-btn" type="button">Export</button>
    `;
    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-cancel-btn').onclick = closeModal;
    document.getElementById('modal-save-btn').onclick = runAdvancedExport;
}

async function runAdvancedExport() {
    const template = document.getElementById('export-template').value;
    const format = document.getElementById('export-format').value;
    let columns = Array.from(document.querySelectorAll('.checkbox-grid input:checked')).map((input) => input.value);
    if (columns.length === 0) {
        showToast('Select at least one column.', 'warning');
        return;
    }

    if (template === 'meeting') {
        columns = ['Theme', 'Member', 'Month', 'Allocation', 'Status'];
    } else if (template === 'review') {
        columns = ['Department', 'Theme', 'Member', 'Month', 'Allocation', 'Category', 'Priority'];
    }

    const { headers, rows } = getGanttExportDataset(columns);
    const filename = `manage_${template}_${new Date().toISOString().slice(0, 10)}.${format}`;

    if (format === 'csv') {
        const csv = [headers, ...rows].map((row) => row.map(csvEscapeLocal).join(',')).join('\r\n');
        downloadBlob(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' }), filename);
        closeModal();
        showToast('Advanced CSV export completed.', 'success');
        return;
    }

    const response = await fetch('/api/export/xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            headers,
            rows: rows.map((row) => row.map((value, index) => (headers[index] === 'Allocation' ? `${value}%` : value))),
            filename,
        }),
    });
    const blob = await response.blob();
    downloadBlob(blob, filename);
    closeModal();
    showToast('Advanced Excel export completed.', 'success');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function csvEscapeLocal(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
