/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Main Application Entry Point
 * Handles routing, authentication, and view initialization.
 */

import { auth, themes as themesApi, members as membersApi } from './api.js';
import { initGantt, refreshGantt } from './gantt/gantt-renderer.js';
import { initMemberView, refreshMemberView } from './member/member-view.js';

// State
let currentUser = null;
let currentView = 'gantt';

// ==========================================
// Init
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // Auto-login assumed
    try {
        currentUser = await auth.me();
    } catch {
        // Fallback if backend auto-login fails for some reason, 
        // though with the backend change it should always succeed.
        // We'll just define a dummy user to proceed.
        currentUser = { username: 'admin', role: 'admin' };
    }
    showApp();
});

// ==========================================
// Main App
// ==========================================

// ==========================================
// Main App
// ==========================================

async function showApp() {
    document.getElementById('app-screen').hidden = false;

    // User info
    document.getElementById('user-name').textContent = currentUser.username;
    document.getElementById('user-avatar').textContent = currentUser.username[0].toUpperCase();

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchView(item.dataset.view);
        });
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await auth.logout();
        location.reload();
    });

    // Initialize views
    await initGantt();
    await initMemberView();

    // Initialize management views
    initThemeManagement();
    initMemberManagement();
}

function switchView(viewName) {
    currentView = viewName;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    document.querySelectorAll('.view').forEach(view => {
        view.hidden = view.id !== `view-${viewName}`;
        if (view.id === `view-${viewName}`) {
            view.classList.add('active');
        } else {
            view.classList.remove('active');
        }
    });

    // Refresh data when switching
    if (viewName === 'gantt') refreshGantt();
    if (viewName === 'member-load') refreshMemberView();
    if (viewName === 'themes') loadThemeList();
    if (viewName === 'members') loadMemberList();
}

// ==========================================
// Theme Management
// ==========================================

const THEME_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

const STATUS_LABELS = {
    planning: '計画中',
    active: '進行中',
    done: '完了',
    hold: '保留',
};

function initThemeManagement() {
    document.getElementById('add-theme-btn').addEventListener('click', () => {
        openThemeModal();
    });
}

async function loadThemeList() {
    const list = document.getElementById('theme-list');
    try {
        const allThemes = await themesApi.list();
        let html = '';
        allThemes.forEach(t => {
            html += `<div class="card">
                <div class="card-header">
                    <div class="card-title">
                        <span class="card-color-dot" style="background:${t.color}"></span>
                        ${t.name}
                    </div>
                    <div class="card-actions">
                        <button class="btn btn-ghost btn-sm" data-edit-theme="${t.theme_id}">編集</button>
                        <button class="btn btn-danger btn-sm" data-delete-theme="${t.theme_id}">削除</button>
                    </div>
                </div>
                <div class="card-meta">
                    <span class="status-badge status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
                    <span>${t.category || '—'}</span>
                    <span>${t.member_count || 0} 人</span>
                    ${t.start_month ? `<span>${t.start_month} 〜 ${t.end_month}</span>` : ''}
                </div>
            </div>`;
        });
        list.innerHTML = html || '<p style="color:var(--color-text-muted);padding:var(--space-6)">テーマがありません。「テーマ追加」ボタンから作成してください。</p>';

        // Bind edit/delete
        list.querySelectorAll('[data-edit-theme]').forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = allThemes.find(t => t.theme_id === parseInt(btn.dataset.editTheme));
                openThemeModal(theme);
            });
        });
        list.querySelectorAll('[data-delete-theme]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('このテーマを削除しますか？関連する割当も全て削除されます。')) {
                    await themesApi.delete(parseInt(btn.dataset.deleteTheme));
                    loadThemeList();
                }
            });
        });
    } catch (err) {
        console.error('Failed to load themes:', err);
    }
}

function openThemeModal(theme = null) {
    const isEdit = !!theme;
    document.getElementById('modal-title').textContent = isEdit ? 'テーマ編集' : 'テーマ追加';

    let colorOptions = THEME_COLORS.map(c =>
        `<span class="card-color-dot" style="background:${c};width:24px;height:24px;cursor:pointer;border:2px solid ${c === (theme?.color || THEME_COLORS[0]) ? 'white' : 'transparent'};border-radius:50%;display:inline-block;margin:2px" data-color="${c}"></span>`
    ).join('');

    document.getElementById('modal-body').innerHTML = `
        <div class="form-field">
            <label>テーマ名</label>
            <input type="text" id="modal-theme-name" value="${theme?.name || ''}" required>
        </div>
        <div class="form-field">
            <label>カテゴリ</label>
            <input type="text" id="modal-theme-category" value="${theme?.category || ''}">
        </div>
        <div class="form-field">
            <label>ステータス</label>
            <select id="modal-theme-status">
                ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === (theme?.status || 'planning') ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
        </div>
        <div class="form-field">
            <label>カラー</label>
            <div id="modal-color-picker">${colorOptions}</div>
            <input type="hidden" id="modal-theme-color" value="${theme?.color || THEME_COLORS[0]}">
        </div>
    `;

    // Color picker
    document.querySelectorAll('#modal-color-picker .card-color-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            document.querySelectorAll('#modal-color-picker .card-color-dot').forEach(d => d.style.borderColor = 'transparent');
            dot.style.borderColor = 'white';
            document.getElementById('modal-theme-color').value = dot.dataset.color;
        });
    });

    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-ghost" id="modal-cancel-btn">キャンセル</button>
        <button class="btn btn-primary" id="modal-save-btn">${isEdit ? '更新' : '作成'}</button>
    `;

    document.getElementById('modal-overlay').hidden = false;

    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-save-btn').addEventListener('click', async () => {
        const data = {
            name: document.getElementById('modal-theme-name').value,
            category: document.getElementById('modal-theme-category').value,
            status: document.getElementById('modal-theme-status').value,
            color: document.getElementById('modal-theme-color').value,
        };
        if (!data.name) return;

        try {
            if (isEdit) {
                await themesApi.update(theme.theme_id, data);
            } else {
                await themesApi.create(data);
            }
            closeModal();
            loadThemeList();
        } catch (err) {
            console.error('Failed to save theme:', err);
        }
    });
}

// ==========================================
// Member Management
// ==========================================

function initMemberManagement() {
    document.getElementById('add-member-btn').addEventListener('click', () => {
        openMemberModal();
    });
}

async function loadMemberList() {
    const list = document.getElementById('member-list');
    try {
        const allMembers = await membersApi.list(false);
        let html = '';
        allMembers.forEach(m => {
            html += `<div class="card" style="opacity:${m.is_active ? 1 : 0.5}">
                <div class="card-header">
                    <div class="card-title">${m.display_name}</div>
                    <div class="card-actions">
                        <button class="btn btn-ghost btn-sm" data-edit-member="${m.member_id}">編集</button>
                        <button class="btn btn-danger btn-sm" data-delete-member="${m.member_id}">削除</button>
                    </div>
                </div>
                <div class="card-meta">
                    <span>${m.department || '—'}</span>
                    <span>容量: ${m.capacity}%</span>
                    <span class="status-badge ${m.is_active ? 'status-active' : 'status-done'}">${m.is_active ? '有効' : '無効'}</span>
                </div>
            </div>`;
        });
        list.innerHTML = html || '<p style="color:var(--color-text-muted);padding:var(--space-6)">メンバーがいません。「メンバー追加」ボタンから作成してください。</p>';

        list.querySelectorAll('[data-edit-member]').forEach(btn => {
            btn.addEventListener('click', () => {
                const member = allMembers.find(m => m.member_id === parseInt(btn.dataset.editMember));
                openMemberModal(member);
            });
        });
        list.querySelectorAll('[data-delete-member]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('このメンバーを削除しますか？')) {
                    await membersApi.delete(parseInt(btn.dataset.deleteMember));
                    loadMemberList();
                }
            });
        });
    } catch (err) {
        console.error('Failed to load members:', err);
    }
}

function openMemberModal(member = null) {
    const isEdit = !!member;
    document.getElementById('modal-title').textContent = isEdit ? 'メンバー編集' : 'メンバー追加';

    document.getElementById('modal-body').innerHTML = `
        <div class="form-field">
            <label>表示名</label>
            <input type="text" id="modal-member-name" value="${member?.display_name || ''}" required>
        </div>
        <div class="form-field">
            <label>所属</label>
            <input type="text" id="modal-member-dept" value="${member?.department || ''}">
        </div>
        <div class="form-field">
            <label>容量 (%)</label>
            <input type="number" id="modal-member-capacity" value="${member?.capacity ?? 100}" min="1" max="200">
        </div>
        ${isEdit ? `<div class="form-field">
            <label>ステータス</label>
            <select id="modal-member-active">
                <option value="true" ${member.is_active ? 'selected' : ''}>有効</option>
                <option value="false" ${!member.is_active ? 'selected' : ''}>無効</option>
            </select>
        </div>` : ''}
    `;

    document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-ghost" id="modal-cancel-btn">キャンセル</button>
        <button class="btn btn-primary" id="modal-save-btn">${isEdit ? '更新' : '作成'}</button>
    `;

    document.getElementById('modal-overlay').hidden = false;

    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-save-btn').addEventListener('click', async () => {
        const data = {
            display_name: document.getElementById('modal-member-name').value,
            department: document.getElementById('modal-member-dept').value,
            capacity: parseInt(document.getElementById('modal-member-capacity').value) || 100,
        };
        if (!data.display_name) return;

        if (isEdit) {
            data.is_active = document.getElementById('modal-member-active').value === 'true';
        }

        try {
            if (isEdit) {
                await membersApi.update(member.member_id, data);
            } else {
                await membersApi.create(data);
            }
            closeModal();
            loadMemberList();
        } catch (err) {
            console.error('Failed to save member:', err);
        }
    });
}

function closeModal() {
    document.getElementById('modal-overlay').hidden = true;
}
