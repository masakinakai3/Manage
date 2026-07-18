/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

import { addMonths } from '../utils/date-utils.js';

export function getMemberCapacity(member, month) {
    const override = member?.monthly_capacities?.[month];
    if (Number.isInteger(override) && override >= 1 && override <= 200) return override;

    const normalCapacity = Number.parseInt(member?.capacity, 10);
    return Number.isInteger(normalCapacity) && normalCapacity >= 1 && normalCapacity <= 200
        ? normalCapacity
        : 100;
}

export function getAggregatedMemberCapacity(member, month, scale = 1) {
    const count = Math.max(1, Number.parseInt(scale, 10) || 1);
    const total = Array.from({ length: count }, (_, offset) => (
        getMemberCapacity(member, addMonths(month, offset))
    )).reduce((sum, capacity) => sum + capacity, 0);
    return Math.round(total / count);
}

export function hasMonthlyCapacityOverride(member, month) {
    return Object.prototype.hasOwnProperty.call(member?.monthly_capacities || {}, month);
}
