/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

import { addMonths, currentMonth } from './utils/date-utils.js';

const STORAGE_KEY = 'manage_shared_view_state';
const EVENT_NAME = 'manage:view-state-updated';

const defaultState = {
    preset: 'rolling-6',
    startMonth: addMonths(currentMonth(), -1),
    scale: 1,
    ganttSearch: '',
    memberSearch: '',
};

export function loadViewState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...defaultState };
        return { ...defaultState, ...JSON.parse(raw) };
    } catch {
        return { ...defaultState };
    }
}

export function updateViewState(partial) {
    const nextState = { ...loadViewState(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: nextState }));
    return nextState;
}

export function subscribeViewState(handler) {
    const listener = (event) => handler(event.detail || loadViewState());
    window.addEventListener(EVENT_NAME, listener);
    return () => window.removeEventListener(EVENT_NAME, listener);
}

export function getPresetConfig(preset) {
    const month = currentMonth();

    switch (preset) {
        case 'current-quarter':
            return { startMonth: addMonths(month, -1), scale: 3 };
        case 'current-year':
            return { startMonth: `${month.slice(0, 4)}-01`, scale: 1 };
        case 'rolling-12':
            return { startMonth: addMonths(month, -1), scale: 1 };
        case 'rolling-6':
        default:
            return { startMonth: addMonths(month, -1), scale: 1 };
    }
}
