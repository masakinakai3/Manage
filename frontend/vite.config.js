/*
 * Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
 * Released under the MIT license
 * https://opensource.org/licenses/mit-license.php
 */

import { defineConfig } from 'vite';

export default defineConfig({
    root: '.',
    server: {
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:5001',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
    },
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    },
});
