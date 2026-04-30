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
});
