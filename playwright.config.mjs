import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './app/client/popup/tests',
    fullyParallel: true,
    workers: 2,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        viewport: { width: 360, height: 800 },
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/serve-client-tests.mjs',
        url: 'http://127.0.0.1:4173/build/popup/index.html',
        reuseExistingServer: false
    }
});
