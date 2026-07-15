// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { buildProjectRibbonMarkup } from '../js/insights-view.js';

describe('project ribbon labels', () => {
    it('keeps long theme names in accessible details without drawing clipped block labels', () => {
        const longName = '次世代プラットフォーム開発';
        const markup = buildProjectRibbonMarkup({
            max_total_load: 100,
            theme_order: [1, 2],
            items: [
                {
                    month: '2026-07',
                    total_load: 100,
                    capacity: 100,
                    projects: [{ theme_id: 1, name: longName, color: '#334155', load: 100 }],
                },
                {
                    month: '2026-08',
                    total_load: 100,
                    capacity: 100,
                    projects: [{ theme_id: 2, name: 'G7+', color: '#334155', load: 100 }],
                },
            ],
        }, { baseWidth: 900 });

        document.body.innerHTML = markup;
        const labels = Array.from(document.querySelectorAll('.project-ribbon__block-label'))
            .map((label) => label.textContent.trim());

        expect(labels).toContain('G7+');
        expect(labels).not.toContain(longName);
        expect(document.body.textContent).toContain(longName);
    });

    it('uses native month buttons instead of mouse-only SVG hotspots', () => {
        const markup = buildProjectRibbonMarkup({
            max_total_load: 120,
            theme_order: [1],
            items: [
                {
                    month: '2026-07',
                    total_load: 120,
                    capacity: 100,
                    projects: [{ theme_id: 1, name: '基盤刷新', color: '#334155', load: 120 }],
                },
                {
                    month: '2026-08',
                    total_load: 80,
                    capacity: 100,
                    projects: [{ theme_id: 1, name: '基盤刷新', color: '#334155', load: 80 }],
                },
            ],
        }, { baseWidth: 900 });

        document.body.innerHTML = markup;
        const buttons = Array.from(document.querySelectorAll('.project-ribbon__month-button'));

        expect(document.querySelector('.project-ribbon__hotspot')).toBeNull();
        expect(buttons).toHaveLength(2);
        expect(buttons[0].tagName).toBe('BUTTON');
        expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
        expect(buttons[0].textContent).toContain('120%');
        expect(buttons[0].classList.contains('is-over')).toBe(true);
        expect(document.querySelector('.project-ribbon__svg')?.getAttribute('aria-labelledby'))
            .toBe('project-ribbon-description');
    });

    it('distinguishes missing totals from an explicit zero percent', () => {
        const markup = buildProjectRibbonMarkup({
            max_total_load: 100,
            theme_order: [],
            items: [
                { month: '2026-07', total_load: null, capacity: 100, projects: [] },
                { month: '2026-08', total_load: 0, capacity: 100, projects: [] },
            ],
        }, { baseWidth: 900 });

        document.body.innerHTML = markup;
        const buttons = Array.from(document.querySelectorAll('.project-ribbon__month-button'));

        expect(buttons[0].textContent).toContain('データなし');
        expect(buttons[1].textContent).toContain('0%');
        expect(document.querySelector('.project-ribbon__svg')?.textContent).toContain('合計 データなし');
    });
});
