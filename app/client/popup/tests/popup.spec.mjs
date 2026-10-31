import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const popupUrl = '/build/popup/index.html';
const clientPath = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Exercise the production bundle and Firebase SDK; mock only browser storage and
// network boundaries. Tests never create accounts or submit real training jobs.
async function preparePopup(page, { settings = {}, failGet = false } = {}) {
    await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
    );
    await page.addInitScript(
        ({ settings, failGet }) => {
            window.__mock = { failGet, failSet: false, failGuide: false, guideOpened: false };
            if (!localStorage.getItem('settings'))
                localStorage.setItem('settings', JSON.stringify(settings));
            Object.defineProperty(window, 'chrome', {
                value: {
                    storage: {
                        sync: {
                            async get(defaults) {
                                if (window.__mock.failGet) throw new Error('Storage unavailable');
                                return {
                                    ...defaults,
                                    ...JSON.parse(localStorage.getItem('settings'))
                                };
                            },
                            async set(changes) {
                                if (window.__mock.failSet) throw new Error('Storage full');
                                const saved = JSON.parse(localStorage.getItem('settings'));
                                localStorage.setItem(
                                    'settings',
                                    JSON.stringify({ ...saved, ...changes })
                                );
                            }
                        },
                        local: { async set() {} }
                    },
                    runtime: {
                        async openOptionsPage() {
                            if (window.__mock.failGuide) throw new Error('Could not open guide');
                            window.__mock.guideOpened = true;
                        }
                    }
                },
                configurable: true
            });
        },
        { settings, failGet }
    );
}

async function mockAuthentication(page) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none' })}.${encode({ sub: 'test-user', iat: now, exp: now + 3600, auth_time: now })}.test`;
    await page.route('https://identitytoolkit.googleapis.com/**', (route) => {
        const email = route.request().postDataJSON()?.email || 'reader@example.com';
        return route.fulfill({
            json: {
                localId: 'test-user',
                email,
                idToken: token,
                refreshToken: 'test-refresh',
                expiresIn: '3600',
                users: [{ localId: 'test-user', email, emailVerified: false, providerUserInfo: [] }]
            }
        });
    });
    return token;
}

async function signIn(page, action = 'Sign in') {
    await page.getByLabel('Email', { exact: true }).fill('reader@example.com');
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.locator('#auth-status')).toHaveText('Signed in as reader@example.com');
}

test('Angular renders under extension CSP and Tailwind styles the popup', async ({
    page
}, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await preparePopup(page);
    await page.goto(popupUrl);
    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(
        page.getByRole('heading', {
            name: 'Still in development, check out the repo if you want to know how this work'
        })
    ).toBeVisible();
    await expect(page.locator('lvg-popup')).toHaveAttribute('ng-version', /^21\./);
    await expect(page.locator('main')).toHaveCSS('padding', '32px 24px 24px');
    await expect(page.locator('header')).toHaveCSS('display', 'flex');
    await expect(page.locator('#auth-form')).toHaveCSS('gap', '8px');
    await expect(page.getByRole('switch')).toBeEnabled();
    await expect(page.getByRole('switch')).not.toBeChecked();
    await expect(page.locator('#train-model-button')).toBeDisabled();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect(await page.locator('#email').evaluate((input) => input.validity.valueMissing)).toBe(
        true
    );
    await expect(page.locator('#auth-error')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('popup.png'), fullPage: true });
});

test('filtering and mode changes persist after reopening the popup', async ({ page }) => {
    await preparePopup(page);
    await page.goto(popupUrl);
    await page.getByRole('switch').check();
    await expect(page.locator('#filter-status')).toHaveText('Filtering is on');
    await page.getByText('Keep it out of view', { exact: true }).click();
    await expect(page.locator('#mode-description')).toHaveText(
        'Filtered posts are hidden from your feed.'
    );
    await page.reload();
    await expect(page.getByRole('switch')).toBeChecked();
    await expect(page.locator('input[value="hide"]')).toBeChecked();
    await page.getByRole('switch').uncheck();
    await expect(page.locator('#filter-status')).toHaveText('Filtering is paused');
});

test('failed writes restore both the switch and selected mode and allow retry', async ({
    page
}) => {
    await preparePopup(page);
    await page.goto(popupUrl);
    await expect(page.getByRole('switch')).toBeEnabled();
    await page.evaluate(() => {
        window.__mock.failSet = true;
    });
    await page.getByRole('switch').click();
    await expect(page.locator('#popup-error')).toContainText('Could not save your changes');
    await expect(page.getByRole('switch')).not.toBeChecked();
    await page.getByText('Keep it out of view', { exact: true }).click();
    await expect(page.locator('input[value="blur"]')).toBeChecked();
    await expect(page.locator('input[value="hide"]')).not.toBeChecked();
    await page.evaluate(() => {
        window.__mock.failSet = false;
    });
    await page.getByText('Keep it out of view', { exact: true }).click();
    await expect(page.locator('input[value="hide"]')).toBeChecked();
    await expect(page.locator('#popup-error')).toBeHidden();
});

test('legacy hide settings and guide actions continue to work', async ({ page }) => {
    await preparePopup(page, { settings: { isEnabled: true, filterMode: 'remove' } });
    await page.goto(popupUrl);
    await expect(page.locator('input[value="hide"]')).toBeChecked();
    await page.getByRole('button', { name: 'About & guide' }).click();
    expect(await page.evaluate(() => window.__mock.guideOpened)).toBe(true);
    await page.evaluate(() => {
        window.__mock.failGuide = true;
    });
    await page.getByRole('button', { name: 'About & guide' }).click();
    await expect(page.locator('#popup-error')).toContainText('Could not open the guide');
});

test('storage load failure leaves filtering disabled with a readable error', async ({ page }) => {
    await preparePopup(page, { failGet: true });
    await page.goto(popupUrl);
    await expect(page.locator('#filter-status')).toHaveText('Settings unavailable');
    await expect(page.getByRole('switch')).toBeDisabled();
    await expect(page.locator('#popup-error')).toContainText('Could not load your preferences');
});

test('sign-in errors allow retry; signed-in actions send a token and sign-out clears the UI', async ({
    page
}) => {
    await preparePopup(page);
    await page.route('https://identitytoolkit.googleapis.com/**', (route) =>
        route.fulfill({
            status: 400,
            json: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }
        })
    );
    await page.goto(popupUrl);
    await page.getByLabel('Email', { exact: true }).fill('reader@example.com');
    await page.getByLabel('Password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('#auth-error')).toContainText('Could not sign in');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    const token = await mockAuthentication(page);
    const requests = [];
    await page.route('https://*.a.run.app/**', (route) => {
        requests.push(route.request());
        return route.fulfill({
            json: route.request().url().endsWith('/train')
                ? { build_id: 'test-build' }
                : { count: 7, limit: 100 }
        });
    });
    await signIn(page);
    await expect(page.locator('#auth-form')).toBeHidden();
    await page.getByRole('button', { name: 'Count my saved feedback' }).click();
    await expect(page.locator('#training-status')).toHaveText('7 of 100 feedback posts saved.');
    await page.getByRole('button', { name: 'Train my model' }).click();
    await expect(page.locator('#training-status')).toContainText('Training submitted.');
    await expect(page.getByRole('link', { name: 'View build' })).toHaveAttribute(
        'href',
        /test-build/
    );
    expect(requests.map((request) => request.method())).toEqual(['GET', 'POST']);
    expect(requests.every((request) => request.headers().authorization === `Bearer ${token}`)).toBe(
        true
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#train-model-button')).toBeDisabled();
    await expect(page.locator('#training-status')).toBeEmpty();
});

test('create account uses Firebase sign-up and training failures allow retry', async ({ page }) => {
    await preparePopup(page);
    await mockAuthentication(page);
    await page.route('https://*.a.run.app/**', (route) =>
        route.fulfill({
            status: 503,
            json: { detail: 'Training is busy. Try again shortly.' }
        })
    );
    await page.goto(popupUrl);
    const signup = page.waitForRequest((request) => request.url().includes('/accounts:signUp?'));
    await signIn(page, 'Create account');
    await signup;
    await page.getByRole('button', { name: 'Train my model' }).click();
    await expect(page.locator('#training-status')).toHaveText(
        'Training is busy. Try again shortly.'
    );
    await expect(page.locator('#train-model-button')).toBeEnabled();
});

test('a late training response does not restore signed-out user details', async ({ page }) => {
    await preparePopup(page);
    await mockAuthentication(page);
    let complete;
    const ready = new Promise((resolve) => {
        complete = resolve;
    });
    let release;
    const waiting = new Promise((resolve) => {
        release = resolve;
    });
    await page.route('https://*.a.run.app/**', async (route) => {
        complete();
        await waiting;
        await route.fulfill({ json: { build_id: 'old-user-build' } });
    });
    await page.goto(popupUrl);
    await signIn(page);
    await page.getByRole('button', { name: 'Train my model' }).click();
    await ready;
    await expect(page.locator('#train-model-button')).toBeDisabled();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('#auth-form')).toBeVisible();
    const response = page.waitForResponse('https://*.a.run.app/**');
    release();
    await response;
    await expect(page.locator('#training-status')).toBeEmpty();
    await expect(page.getByRole('link', { name: 'View build' })).toHaveCount(0);
});

test('unpacked extension connects the popup, bundled feed controls, and service worker', async () => {
    const profile = await mkdtemp(resolve(tmpdir(), 'lvg-extension-'));
    const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${clientPath}`, `--load-extension=${clientPath}`]
    });
    try {
        await context.route('https://**/*', (route) => route.abort());
        const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
        const extensionId = new URL(worker.url()).host;
        const manifest = JSON.parse(await readFile(resolve(clientPath, 'manifest.json'), 'utf8'));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`chrome-extension://${extensionId}/${manifest.action.default_popup}`);
        await expect(page.locator('#auth-form')).toBeVisible();
        await page.getByRole('switch').check();
        await expect(page.locator('#filter-status')).toHaveText('Filtering is on');
        await page.reload();
        await expect(page.getByRole('switch')).toBeChecked();
        const feed = await context.newPage();
        feed.on('pageerror', (error) => errors.push(error.message));
        await feed.route('https://www.linkedin.com/feed/**', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html><body>
                <article role="listitem" componentkey="update-card-focus-1">
                    <div class="update-components-actor__container">
                        <div class="update-components-actor__description"><span aria-hidden="true">Promoted</span></div>
                    </div>
                    <p data-testid="expandable-text-box">A fixture post for extension testing.</p>
                    <div><button aria-label="Comment">Comment</button></div>
                </article>
            </body></html>`
            })
        );
        await feed.goto('https://www.linkedin.com/feed/');
        const post = feed.getByRole('listitem');
        await expect(feed.getByRole('button', { name: 'Show post', exact: true })).toBeVisible();
        await expect(feed.locator('.low-value-guard-feedback-button')).toHaveCount(2);
        await page.getByText('Keep it out of view', { exact: true }).click();
        await expect(post).toBeHidden();
        await page.getByText('Reveal when you want', { exact: true }).click();
        await expect(post).toBeVisible();
        await feed.getByRole('button', { name: 'Show post', exact: true }).click();
        await expect(feed.locator('.low-value-guard-overlay')).toHaveCount(0);
        await feed.getByRole('button', { name: 'Useful', exact: true }).click();
        await expect(feed.locator('.low-value-guard-feedback-status')).toHaveText(
            'Sign in to save feedback.'
        );
        await page.getByRole('switch').uncheck();
        await expect(page.locator('#filter-status')).toHaveText('Filtering is paused');
        await expect(post).toBeVisible();
        expect(errors).toEqual([]);
    } finally {
        await context.close();
        await rm(profile, { recursive: true, force: true });
    }
});
