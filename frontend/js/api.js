/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * API client for the Resource Management Tool.
 * Handles all REST API calls to the Flask backend.
 */

const API_BASE = '/api';

async function request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

// Auth
export const auth = {
    login: (username, password) => request('/auth/login', {
        method: 'POST', body: JSON.stringify({ username, password }),
    }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request('/auth/me'),
    listUsers: () => request('/auth/users'),
    createUser: (data) => request('/auth/users', {
        method: 'POST', body: JSON.stringify(data),
    }),
    updateUser: (id, data) => request(`/auth/users/${id}`, {
        method: 'PUT', body: JSON.stringify(data),
    }),
    deleteUser: (id) => request(`/auth/users/${id}`, {
        method: 'DELETE',
    }),
};

// Themes
export const themes = {
    list: () => request('/themes'),
    create: (data) => request('/themes', {
        method: 'POST', body: JSON.stringify(data),
    }),
    update: (id, data) => request(`/themes/${id}`, {
        method: 'PUT', body: JSON.stringify(data),
    }),
    delete: (id) => request(`/themes/${id}`, { method: 'DELETE' }),
    assignMember: (themeId, memberId) => request(`/themes/${themeId}/members`, {
        method: 'POST', body: JSON.stringify({ member_id: memberId }),
    }),
    assignMembersBulk: (themeId, memberIds) => request(`/themes/${themeId}/members/bulk`, {
        method: 'POST', body: JSON.stringify({ member_ids: memberIds }),
    }),
    unassignMember: (themeId, memberId) => request(`/themes/${themeId}/members/${memberId}`, {
        method: 'DELETE',
    }),
};

// Members
export const members = {
    list: (activeOnly = true) => request(`/members?active=${activeOnly}`),
    create: (data) => request('/members', {
        method: 'POST', body: JSON.stringify(data),
    }),
    update: (id, data) => request(`/members/${id}`, {
        method: 'PUT', body: JSON.stringify(data),
    }),
    delete: (id) => request(`/members/${id}`, { method: 'DELETE' }),
};

// Allocations
export const allocations = {
    list: (params = {}) => {
        const qs = new URLSearchParams(params).toString();
        return request(`/allocations?${qs}`);
    },
    bulkUpdate: (data) => request('/allocations/bulk', {
        method: 'PUT', body: JSON.stringify(data),
    }),
    updateSingle: (data) => request('/allocations/single', {
        method: 'PUT', body: JSON.stringify(data),
    }),
    themeLoads: (from, to) => {
        const qs = new URLSearchParams({ from, to }).toString();
        return request(`/allocations/load/themes?${qs}`);
    },
    memberLoads: (from, to) => {
        const qs = new URLSearchParams({ from, to }).toString();
        return request(`/allocations/load/members?${qs}`);
    },
    warnings: (from, to) => {
        const qs = new URLSearchParams({ from, to }).toString();
        return request(`/allocations/warnings?${qs}`);
    },
};

// Data Backup (Export / Import)
export const dataBackup = {
    /** Download a full JSON backup of all application data. */
    exportJson: async () => {
        const res = await fetch(`${API_BASE}/export/json`, { credentials: 'include' });
        if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : 'manage_backup.json';
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    /** Upload a JSON backup file and restore all data. */
    importJson: async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE}/import/json`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Import failed: HTTP ${res.status}`);
        return data;
    },
};

// Snapshots
export const snapshots = {
    list: () => request('/snapshots'),
    get: (id) => request(`/snapshots/${id}`),
    create: (data) => request('/snapshots', {
        method: 'POST', body: JSON.stringify(data),
    }),
    delete: (id) => request(`/snapshots/${id}`, { method: 'DELETE' }),
};

// Saved Views
export const savedViews = {
    list: () => request('/saved-views'),
    upsert: (data) => request('/saved-views', {
        method: 'POST', body: JSON.stringify(data),
    }),
    delete: async (id) => {
        const res = await fetch(`${API_BASE}/saved-views/${id}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${res.status}`);
        }
    },
};

// Insights
export const insights = {
    overview: (from, to) => {
        const qs = new URLSearchParams({ from, to }).toString();
        return request(`/insights/overview?${qs}`);
    },
};
