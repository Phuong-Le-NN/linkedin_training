import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFeedController } from './content.js';

const flush = () => new Promise(setImmediate);

async function openFeed(t, initialSettings, respond = async () => ({ label: 'useless' })) {
    class Element {
        constructor() {
            this.style = { display: '', position: '' };
            this.children = [];
            this.isConnected = true;
            this.text = 'A post about Python';
            this.listeners = new Map();
        }
        querySelector(selector) {
            return selector.includes('expandable-text-box') ? { innerText: this.text } : null;
        }
        appendChild(child) {
            child.parentElement = this;
            this.children.push(child);
        }
        remove() {
            this.parentElement.children = this.parentElement.children.filter(
                (child) => child !== this
            );
        }
        addEventListener(type, callback) {
            this.listeners.set(type, callback);
        }
        contains(target) {
            return this === target;
        }
    }
    const post = new Element();
    const requests = [];
    let settings = { ...initialSettings };
    let onChanged;
    const browser = {
        Element,
        HTMLElement: Element,
        document: {
            body: new Element(),
            querySelectorAll: () => [post],
            createElement: () => new Element()
        },
        chrome: {
            runtime: {
                id: 'test-extension',
                sendMessage: async (message) => {
                    requests.push(message);
                    return respond(message);
                }
            },
            storage: {
                sync: { get: async () => ({ ...settings }) },
                onChanged: {
                    addListener: (listener) => {
                        onChanged = listener;
                    },
                    removeListener() {}
                }
            }
        },
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
        getComputedStyle: () => ({ position: 'static' }),
        window: { location: { reload: () => assert.fail('The feed must not reload') } },
        console: { error() {} }
    };
    const previous = new Map();
    for (const [name, value] of Object.entries(browser)) {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    const controller = createFeedController();
    t.after(() => {
        controller.stop();
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    });
    await controller.start();
    await flush();
    return {
        post,
        requests,
        async setSettings(changes) {
            settings = { ...settings, ...changes };
            onChanged(
                Object.fromEntries(
                    Object.entries(changes).map(([key, newValue]) => [key, { newValue }])
                ),
                'sync'
            );
            await flush();
        },
        async changeUser(userId) {
            onChanged({ authUserId: { newValue: userId } }, 'local');
            await flush();
        },
        reveal() {
            const overlay = post.children.find(
                (child) => child.className === 'low-value-guard-overlay'
            );
            overlay.listeners.get('click')({
                target: overlay.children[0],
                preventDefault() {},
                stopImmediatePropagation() {}
            });
        }
    };
}

test('enabling and disabling filtering updates existing posts without reloading', async (t) => {
    const feed = await openFeed(t, { isEnabled: false, filterMode: 'hide' });
    assert.equal(feed.requests.length, 0);
    await feed.setSettings({ isEnabled: true });
    assert.equal(feed.post.style.display, 'none');
    await feed.setSettings({ isEnabled: false });
    assert.equal(feed.post.style.display, '');
    await feed.setSettings({ isEnabled: true });
    assert.equal(feed.post.style.display, 'none');
    assert.equal(feed.requests.length, 1);
});

test('switching blur and hide reuses the result and preserves revealed posts', async (t) => {
    const feed = await openFeed(t, { isEnabled: true, filterMode: 'blur' });
    assert.equal(feed.post.children.length, 1);
    await feed.setSettings({ filterMode: 'hide' });
    assert.equal(feed.post.children.length, 0);
    assert.equal(feed.post.style.display, 'none');
    await feed.setSettings({ filterMode: 'blur' });
    assert.equal(feed.post.children.length, 1);
    feed.reveal();
    await feed.setSettings({ filterMode: 'hide' });
    assert.equal(feed.post.style.display, '');
    await feed.setSettings({ filterMode: 'blur' });
    assert.equal(feed.post.children.length, 0);
    assert.equal(feed.post.style.display, '');
    assert.equal(feed.requests.length, 1);
});

test('sign-in retries posts after previous classification attempts failed', async (t) => {
    let signedIn = false;
    const feed = await openFeed(t, { isEnabled: true, filterMode: 'hide' }, async () =>
        signedIn ? { label: 'useless' } : { error: 'Service unavailable' }
    );
    assert.equal(feed.requests.length, 1);
    signedIn = true;
    await feed.changeUser('signed-in-user');
    assert.equal(feed.requests.length, 2);
    assert.equal(feed.post.style.display, 'none');
});

test('sign-out switches models and ignores an old personal-model response', async (t) => {
    let resolvePersonal;
    let requestCount = 0;
    const feed = await openFeed(t, { isEnabled: true, filterMode: 'hide' }, () =>
        ++requestCount === 1
            ? new Promise((resolve) => {
                  resolvePersonal = resolve;
              })
            : Promise.resolve({ label: 'useful' })
    );
    await feed.changeUser(null);
    resolvePersonal({ label: 'useless' });
    await flush();
    assert.equal(feed.requests.length, 2);
    assert.equal(feed.post.style.display, '');
});
