/**
 * Date utility functions for month-based calculations.
 */

/**
 * Get current month as 'YYYY-MM'.
 */
export function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Shorten 'YYYY-MM' to 'YY-MM'.
 */
export function shortenMonth(monthStr) {
    if (!monthStr || monthStr.length < 7) return monthStr;
    return monthStr.slice(2);
}

/**
 * Generate array of month strings from start to end (inclusive).
 */
export function monthRange(start, end) {
    const months = [];
    let [y, m] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return months;
}

/**
 * Add N months to a month string. N can be negative.
 */
export function addMonths(monthStr, n) {
    let [y, m] = monthStr.split('-').map(Number);
    m += n;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Format month string for display.
 * scale=1: '1月', scale=3: 'Q1', scale=6: 'H1', scale=12: '2026'
 */
export function formatMonth(monthStr, scale = 1) {
    const [y, m] = monthStr.split('-').map(Number);
    if (scale === 1) return `${m}月`;
    if (scale === 3) return `Q${Math.ceil(m / 3)}`;
    if (scale === 6) return m <= 6 ? 'H1' : 'H2';
    if (scale === 12) return `${y}`;
    return `${m}月`;
}

/**
 * Format month for header with year context.
 */
export function formatMonthHeader(monthStr, scale = 1) {
    const [y, m] = monthStr.split('-').map(Number);
    if (scale === 1) {
        return m === 1 ? `${y}\n${m}月` : `${m}月`;
    }
    if (scale === 3) {
        const q = Math.ceil(m / 3);
        return q === 1 ? `${y}\nQ${q}` : `Q${q}`;
    }
    if (scale === 6) {
        const h = m <= 6 ? 'H1' : 'H2';
        return h === 'H1' ? `${y}\n${h}` : h;
    }
    return `${y}`;
}

/**
 * Get the display months for a given start, visible count, and scale.
 */
export function getVisibleMonths(startMonth, visibleCount, scale = 1) {
    const months = [];
    let current = startMonth;
    for (let i = 0; i < visibleCount; i++) {
        months.push(current);
        current = addMonths(current, scale);
    }
    return months;
}

/**
 * Aggregate rates for a scaled period.
 * Returns average rate across months in the period.
 */
export function aggregateRate(ratesByMonth, periodStart, scale) {
    if (scale === 1) return ratesByMonth[periodStart] || 0;

    const months = [];
    let current = periodStart;
    for (let i = 0; i < scale; i++) {
        months.push(current);
        current = addMonths(current, 1);
    }

    const rates = months.map(m => ratesByMonth[m] || 0);
    const nonZero = rates.filter(r => r > 0);
    if (nonZero.length === 0) return 0;
    return Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length);
}
