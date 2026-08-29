// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('sidebar branding', () => {
    it('uses an accessible Manage wordmark', () => {
        const source = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
        const page = new DOMParser().parseFromString(source, 'text/html');
        const brand = page.querySelector('.sidebar-brand-wordmark');

        expect(brand?.getAttribute('role')).toBe('img');
        expect(brand?.getAttribute('aria-label')).toBe('Manage');
        expect(brand?.textContent.trim()).toBe('Manage');
        expect(page.querySelector('.sidebar-brand-icon')).toBeNull();
        expect(page.querySelector('.sidebar-title')).toBeNull();
    });
});

describe('responsive sidebar navigation', () => {
    let cleanup = () => {};
    let mediaQuery;
    let mediaListeners;

    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
        mediaListeners = new Set();
        mediaQuery = {
            matches: true,
            addEventListener: vi.fn((type, listener) => {
                if (type === 'change') mediaListeners.add(listener);
            }),
            removeEventListener: vi.fn((type, listener) => {
                if (type === 'change') mediaListeners.delete(listener);
            }),
        };
        vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
        document.body.innerHTML = `
            <div id="sidebar-backdrop" hidden></div>
            <nav id="sidebar">
                <a class="nav-item" href="#gantt">ガントチャート</a>
                <a class="nav-item active" href="#member-load">メンバー負荷</a>
                <button type="button">設定</button>
            </nav>
            <button id="sidebar-toggle" type="button" aria-controls="sidebar"></button>
        `;
    });

    afterEach(() => {
        cleanup();
        cleanup = () => {};
        vi.unstubAllGlobals();
        document.body.className = '';
    });

    it('keeps drawer state, aria state, Escape, backdrop, and focus in sync', async () => {
        const { initSidebarNavigation } = await import('../js/sidebar.js');
        cleanup = initSidebarNavigation();
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebar-toggle');
        const backdrop = document.getElementById('sidebar-backdrop');

        expect(sidebar?.classList.contains('sidebar-collapsed')).toBe(true);
        expect(toggle?.getAttribute('aria-expanded')).toBe('false');
        expect(toggle?.getAttribute('aria-label')).toBe('サイドバーを開く');
        expect(backdrop?.hidden).toBe(true);

        toggle?.click();

        expect(sidebar?.classList.contains('sidebar-collapsed')).toBe(false);
        expect(toggle?.getAttribute('aria-expanded')).toBe('true');
        expect(toggle?.getAttribute('aria-label')).toBe('サイドバーを閉じる');
        expect(backdrop?.hidden).toBe(false);
        expect(document.body.classList.contains('sidebar-open')).toBe(true);
        expect(document.activeElement?.textContent).toBe('メンバー負荷');

        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(sidebar?.classList.contains('sidebar-collapsed')).toBe(true);
        expect(backdrop?.hidden).toBe(true);
        expect(document.activeElement).toBe(toggle);

        toggle?.click();
        backdrop?.click();
        expect(sidebar?.classList.contains('sidebar-collapsed')).toBe(true);
        expect(document.activeElement).toBe(toggle);
    });

    it('traps Tab inside the open drawer and restores the desktop preference', async () => {
        localStorage.setItem('sidebar_collapsed', 'false');
        const onEnterNarrow = vi.fn();
        const { initSidebarNavigation } = await import('../js/sidebar.js');
        cleanup = initSidebarNavigation({ onEnterNarrow });
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebar-toggle');
        const first = sidebar?.querySelector('.nav-item');

        toggle?.click();
        toggle?.focus();
        toggle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(document.activeElement).toBe(first);

        mediaQuery.matches = false;
        mediaListeners.forEach((listener) => listener({ matches: false }));
        expect(sidebar?.classList.contains('sidebar-collapsed')).toBe(false);

        mediaQuery.matches = true;
        mediaListeners.forEach((listener) => listener({ matches: true }));
        expect(sidebar?.classList.contains('sidebar-collapsed')).toBe(true);
        expect(onEnterNarrow).toHaveBeenCalledTimes(1);
    });
});
