/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

export const THEME_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981',
    '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#2563eb',
    '#64748b', '#6b7280', '#ef4444', '#dc2626', '#a855f7',
    '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#be123c',
    '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#059669',
    '#0d9488', '#0891b2',
];

export function normalizeThemeColor(value, fallback = THEME_COLORS[0]) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

export function summarizeThemeColorUsage(themes = []) {
    return themes.reduce((summary, theme) => {
        const color = normalizeThemeColor(theme?.color, '');
        if (!color) return summary;
        if (!summary[color]) summary[color] = [];
        summary[color].push(String(theme?.name || '').trim() || '名称未設定');
        return summary;
    }, {});
}
