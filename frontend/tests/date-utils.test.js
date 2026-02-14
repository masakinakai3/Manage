import { describe, it, expect } from 'vitest';
import { shortenMonth, monthRange, addMonths, formatMonth, aggregateRate } from '../js/utils/date-utils.js';

describe('Date Utilities', () => {
    describe('shortenMonth', () => {
        it('should shorten YYYY-MM to YY-MM', () => {
            expect(shortenMonth('2024-05')).toBe('24-05');
        });
        it('should return original string if invalid format', () => {
            expect(shortenMonth('2024')).toBe('2024');
            expect(shortenMonth('')).toBe('');
        });
    });

    describe('monthRange', () => {
        it('should generate range between two months inclusive', () => {
            const range = monthRange('2024-01', '2024-03');
            expect(range).toEqual(['2024-01', '2024-02', '2024-03']);
        });
        it('should handle year crossing', () => {
            const range = monthRange('2023-12', '2024-02');
            expect(range).toEqual(['2023-12', '2024-01', '2024-02']);
        });
    });

    describe('addMonths', () => {
        it('should add months correctly within same year', () => {
            expect(addMonths('2024-01', 5)).toBe('2024-06');
        });
        it('should handle year rollover forward', () => {
            expect(addMonths('2023-11', 3)).toBe('2024-02');
        });
        it('should handle year rollover backward', () => {
            expect(addMonths('2024-02', -3)).toBe('2023-11');
        });
    });

    describe('formatMonth', () => {
        it('should format default scale (1) as M月', () => {
            expect(formatMonth('2024-05', 1)).toBe('5月');
        });
        it('should format scale 3 as Qx', () => {
            expect(formatMonth('2024-05', 3)).toBe('Q2');
        });
        it('should format scale 6 as Hx', () => {
            expect(formatMonth('2024-08', 6)).toBe('H2');
        });
        it('should format scale 12 as YYYY', () => {
            expect(formatMonth('2024-05', 12)).toBe('2024');
        });
    });

    describe('aggregateRate', () => {
        it('should return single value for scale 1', () => {
            const rates = { '2024-01': 50 };
            expect(aggregateRate(rates, '2024-01', 1)).toBe(50);
        });

        it('should average non-zero values for period', () => {
            // Q1: Jan(100), Feb(50), Mar(0) -> Avg(75)
            const rates = {
                '2024-01': 100,
                '2024-02': 50,
                '2024-03': 0
            };
            expect(aggregateRate(rates, '2024-01', 3)).toBe(75);
        });

        it('should return 0 if all zero or missing', () => {
            const rates = { '2024-01': 0 };
            expect(aggregateRate(rates, '2024-01', 3)).toBe(0);
        });
    });
});
