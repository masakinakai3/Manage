/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function readDesktopPreference() {
    try {
        return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch {
        return false;
    }
}

function writeDesktopPreference(collapsed) {
    try {
        localStorage.setItem('sidebar_collapsed', String(collapsed));
    } catch {
        // The sidebar remains usable when storage is unavailable.
    }
}

export function initSidebarNavigation({ onEnterNarrow = () => {} } = {}) {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar || !toggle) return () => {};

    const mediaQuery = window.matchMedia('(max-width: 1024px)');
    let desktopCollapsed = readDesktopPreference();

    const isNarrow = () => mediaQuery.matches;
    const setCollapsed = (collapsed, { persist = false, restoreFocus = false } = {}) => {
        const nextCollapsed = Boolean(collapsed);
        const drawerOpen = isNarrow() && !nextCollapsed;

        sidebar.classList.toggle('sidebar-collapsed', nextCollapsed);
        sidebar.toggleAttribute('inert', nextCollapsed);
        sidebar.setAttribute('aria-hidden', String(nextCollapsed));
        toggle.setAttribute('aria-expanded', String(!nextCollapsed));
        toggle.setAttribute('aria-label', nextCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる');
        toggle.title = nextCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる';
        document.body.classList.toggle('sidebar-open', drawerOpen);
        if (backdrop) backdrop.hidden = !drawerOpen;

        if (persist && !isNarrow()) {
            desktopCollapsed = nextCollapsed;
            writeDesktopPreference(nextCollapsed);
        }
        if (restoreFocus) toggle.focus();
    };

    const closeDrawer = ({ restoreFocus = false } = {}) => {
        if (!isNarrow()) return;
        setCollapsed(true, { restoreFocus });
    };

    const handleToggle = () => {
        const nextCollapsed = !sidebar.classList.contains('sidebar-collapsed');
        setCollapsed(nextCollapsed, { persist: true });
        if (!nextCollapsed && isNarrow()) {
            (sidebar.querySelector('.nav-item.active') || sidebar.querySelector('.nav-item'))?.focus();
        }
    };

    const handleKeydown = (event) => {
        if (!isNarrow() || sidebar.classList.contains('sidebar-collapsed')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDrawer({ restoreFocus: true });
            return;
        }
        if (event.key !== 'Tab') return;

        const focusable = [...sidebar.querySelectorAll(FOCUSABLE_SELECTOR), toggle]
            .filter((element) => !element.hasAttribute('disabled') && !element.closest('[hidden]'));
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        } else if (!focusable.includes(document.activeElement)) {
            event.preventDefault();
            first.focus();
        }
    };

    const handleMediaChange = (event) => {
        if (event.matches) {
            setCollapsed(true);
            onEnterNarrow();
        } else {
            setCollapsed(desktopCollapsed);
        }
    };

    toggle.addEventListener('click', handleToggle);
    backdrop?.addEventListener('click', () => closeDrawer({ restoreFocus: true }));
    sidebar.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => closeDrawer());
    });
    document.addEventListener('keydown', handleKeydown);
    mediaQuery.addEventListener('change', handleMediaChange);
    setCollapsed(isNarrow() ? true : desktopCollapsed);

    return () => {
        toggle.removeEventListener('click', handleToggle);
        document.removeEventListener('keydown', handleKeydown);
        mediaQuery.removeEventListener('change', handleMediaChange);
    };
}
