/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

import { addMonths, currentMonth } from './utils/date-utils.js';

const STORAGE_KEY = 'manage_shared_view_state';
const EVENT_NAME = 'manage:view-state-updated';
const SAVED_VIEWS_KEY = 'manage_saved_views';
const ONBOARDING_KEY = 'manage_onboarding_state';
const STATE_VERSION = 2;

const defaultState = {
    stateVersion: STATE_VERSION,
    preset: 'rolling-6',
    startMonth: addMonths(currentMonth(), -1),
    rangeMonths: 8,
    bucketMonths: 1,
    focusMonth: null,
    activeView: 'gantt',
    scale: 1,
    visibleCount: 8,
    ganttSearch: '',
    ganttCategory: '',
    ganttOwner: '',
    ganttStatus: 'all',
    ganttPriority: 'all',
    memberSearch: '',
    groupBy: 'none',
    ganttDensity: 'standard',
    memberDensity: 'standard',
    memberSort: 'risk',
    memberGroup: 'none',
    memberDecisionFilter: 'all',
    memberViewMode: 'list',
};

function normalizePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function migrateViewState(rawState = {}) {
    const raw = rawState && typeof rawState === 'object' ? rawState : {};
    const isV2 = Number(raw.stateVersion) >= STATE_VERSION;
    const legacyScale = normalizePositiveInteger(raw.scale, defaultState.bucketMonths);
    const bucketMonths = normalizePositiveInteger(
        isV2 ? raw.bucketMonths : legacyScale,
        defaultState.bucketMonths,
    );
    const legacyVisibleCount = normalizePositiveInteger(raw.visibleCount, defaultState.visibleCount);
    const rangeMonths = normalizePositiveInteger(
        isV2 ? raw.rangeMonths : legacyVisibleCount * legacyScale,
        defaultState.rangeMonths,
    );

    return {
        ...defaultState,
        ...raw,
        stateVersion: STATE_VERSION,
        rangeMonths,
        bucketMonths,
        // Compatibility aliases. Existing renderers continue to consume these
        // while v2 keeps the real period independent from the aggregation unit.
        scale: bucketMonths,
        visibleCount: Math.max(1, Math.ceil(rangeMonths / bucketMonths)),
        focusMonth: typeof raw.focusMonth === 'string' && raw.focusMonth ? raw.focusMonth : null,
    };
}

export function loadViewState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return migrateViewState();
        return migrateViewState(JSON.parse(raw));
    } catch {
        return migrateViewState();
    }
}

export function updateViewState(partial, { source = 'unknown' } = {}) {
    const previousState = loadViewState();
    const requested = partial && typeof partial === 'object' ? partial : {};
    const normalizedPartial = { ...requested, stateVersion: STATE_VERSION };

    if (Object.prototype.hasOwnProperty.call(requested, 'scale') && !Object.prototype.hasOwnProperty.call(requested, 'bucketMonths')) {
        normalizedPartial.bucketMonths = requested.scale;
    }
    if (Object.prototype.hasOwnProperty.call(requested, 'visibleCount') && !Object.prototype.hasOwnProperty.call(requested, 'rangeMonths')) {
        normalizedPartial.rangeMonths = normalizePositiveInteger(requested.visibleCount, previousState.visibleCount)
            * normalizePositiveInteger(normalizedPartial.bucketMonths ?? previousState.bucketMonths, previousState.bucketMonths);
    }

    const nextState = migrateViewState({ ...previousState, ...normalizedPartial });
    const changedKeys = Object.keys(nextState).filter((key) => !Object.is(previousState[key], nextState[key]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: { state: nextState, changedKeys, source },
    }));
    return nextState;
}

export function subscribeViewState(handler) {
    const listener = (event) => {
        const detail = event.detail || {};
        const state = detail.state ? migrateViewState(detail.state) : migrateViewState(detail);
        handler(state, {
            changedKeys: Array.isArray(detail.changedKeys) ? detail.changedKeys : Object.keys(state),
            source: detail.source || 'legacy',
        });
    };
    window.addEventListener(EVENT_NAME, listener);
    return () => window.removeEventListener(EVENT_NAME, listener);
}

export function getPresetConfig(preset) {
    const month = currentMonth();
    const [year, monthNumber] = month.split('-').map(Number);
    const quarterStart = Math.floor((monthNumber - 1) / 3) * 3 + 1;

    switch (preset) {
        case 'current-quarter':
            return periodConfig(`${year}-${String(quarterStart).padStart(2, '0')}`, 3);
        case 'current-year':
            return periodConfig(`${month.slice(0, 4)}-01`, 12);
        case 'rolling-12':
            return periodConfig(addMonths(month, -1), 14);
        case 'rolling-24':
            return periodConfig(addMonths(month, -1), 26);
        case 'rolling-6':
        default:
            return periodConfig(addMonths(month, -1), 8);
    }
}

function periodConfig(startMonth, rangeMonths, bucketMonths = 1) {
    return {
        startMonth,
        rangeMonths,
        bucketMonths,
        scale: bucketMonths,
        visibleCount: Math.ceil(rangeMonths / bucketMonths),
    };
}

export function loadSavedViews() {
    try {
        const raw = localStorage.getItem(SAVED_VIEWS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveSavedViews(views) {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    return views;
}

export function upsertSavedView(view) {
    const views = loadSavedViews();
    const nextViews = [...views.filter((item) => item.id !== view.id), view]
        .sort((left, right) => left.name.localeCompare(right.name, 'ja'));
    return saveSavedViews(nextViews);
}

export function deleteSavedView(viewId) {
    const nextViews = loadSavedViews().filter((item) => item.id !== viewId);
    return saveSavedViews(nextViews);
}

export function loadOnboardingState() {
    try {
        const raw = localStorage.getItem(ONBOARDING_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            dismissed: false,
            sampleLoaded: false,
            ...parsed,
        };
    } catch {
        return {
            dismissed: false,
            sampleLoaded: false,
        };
    }
}

export function updateOnboardingState(partial) {
    const next = { ...loadOnboardingState(), ...partial };
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(next));
    return next;
}
