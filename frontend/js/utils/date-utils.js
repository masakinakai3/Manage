/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

/**
 * Date utility functions for month-based calculations.
 */

export function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function shortenMonth(monthStr) {
    if (!monthStr || monthStr.length < 7) return monthStr;
    return monthStr.slice(2);
}

export function monthRange(start, end) {
    const months = [];
    let [year, month] = start.split('-').map(Number);
    const [endYear, endMonth] = end.split('-').map(Number);

    while (year < endYear || (year === endYear && month <= endMonth)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }

    return months;
}

export function addMonths(monthStr, delta) {
    let [year, month] = monthStr.split('-').map(Number);
    month += delta;

    while (month > 12) {
        month -= 12;
        year += 1;
    }

    while (month < 1) {
        month += 12;
        year -= 1;
    }

    return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatMonth(monthStr, scale = 1) {
    const [year, month] = monthStr.split('-').map(Number);

    if (scale === 1) return `${month}月`;
    if (scale === 3) return `Q${Math.ceil(month / 3)}`;
    if (scale === 6) return month <= 6 ? 'H1' : 'H2';
    if (scale === 12) return `${year}`;
    return `${month}月`;
}

export function formatMonthHeader(monthStr, scale = 1) {
    const [year, month] = monthStr.split('-').map(Number);

    if (scale === 1) {
        return month === 1 ? `${year}\n${month}月` : `${month}月`;
    }

    const end = addMonths(monthStr, scale - 1);
    const [endYear, endMonth] = end.split('-').map(Number);
    if (year === endYear) return `${year}/${String(month).padStart(2, '0')}–${String(endMonth).padStart(2, '0')}`;
    return `${year}/${String(month).padStart(2, '0')}–${endYear}/${String(endMonth).padStart(2, '0')}`;
}

export function getVisibleMonths(startMonth, visibleCount, scale = 1) {
    const months = [];
    let current = startMonth;

    for (let index = 0; index < visibleCount; index += 1) {
        months.push(current);
        current = addMonths(current, scale);
    }

    return months;
}

export function aggregateRate(ratesByMonth, periodStart, scale) {
    if (scale === 1) return ratesByMonth[periodStart] || 0;

    const months = [];
    let current = periodStart;

    for (let index = 0; index < scale; index += 1) {
        months.push(current);
        current = addMonths(current, 1);
    }

    const rates = months.map((month) => ratesByMonth[month] || 0);
    const nonZeroRates = rates.filter((rate) => rate > 0);
    if (nonZeroRates.length === 0) return 0;

    return Math.round(nonZeroRates.reduce((sum, rate) => sum + rate, 0) / nonZeroRates.length);
}
