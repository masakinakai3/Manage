// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('api client request caching', () => {
    beforeEach(() => {
        vi.resetModules();
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ([]),
        }));
    });

    it('uses no-store for GET requests', async () => {
        const { allocations } = await import('../js/api.js');

        await allocations.list({ from: '2026-04', to: '2026-04' });

        expect(global.fetch).toHaveBeenCalledWith(
            '/api/allocations?from=2026-04&to=2026-04',
            expect.objectContaining({
                cache: 'no-store',
                credentials: 'include',
            }),
        );
    });

    it('does not force no-store for write requests', async () => {
        const { allocations } = await import('../js/api.js');

        await allocations.bulkUpdate([]);

        expect(global.fetch).toHaveBeenCalledWith(
            '/api/allocations/bulk',
            expect.objectContaining({
                cache: 'default',
                method: 'PUT',
            }),
        );
    });

    it('publishes loading and fresh API states for successful requests', async () => {
        const states = [];
        window.addEventListener('manage:api-state', (event) => states.push(event.detail.state), { once: false });
        const { members } = await import('../js/api.js');

        await members.list();

        expect(states).toEqual(['loading', 'success']);
    });

    it('keeps HTTP status metadata and publishes an error state', async () => {
        global.fetch = vi.fn(async () => ({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal Server Error' }),
        }));
        const states = [];
        window.addEventListener('manage:api-state', (event) => states.push(event.detail.state), { once: false });
        const { insights } = await import('../js/api.js');

        await expect(insights.overview('2026-04', '2026-06')).rejects.toMatchObject({
            status: 500,
            code: 'HTTP_500',
        });
        expect(states).toEqual(['loading', 'error']);
    });
});
