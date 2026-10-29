const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const flush = () => new Promise(setImmediate);

async function openFeed(initialSettings, respond = async () => ({ label: 'useless' })) {
    class Element {
        constructor() {
            this.style = { display: '', position: '' };
            this.children = [];
            this.isConnected = true;
            this.text = 'A post about Python';
        }
        querySelector(selector) {
            return selector.includes('expandable-text-box') ? { innerText: this.text } : null;
        }
        appendChild(child) { child.parentElement = this; this.children.push(child); }
        remove() {
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        }
        addEventListener() {}
    }
    const post = new Element();
    const requests = [];
    let settings = { ...initialSettings };
    let onChanged;
    const context = vm.createContext({
        Element, HTMLElement: Element,
        document: {
            body: new Element(),
            querySelectorAll: () => [post],
            createElement: () => new Element(),
        },
        chrome: {
            runtime: {
                id: 'test-extension',
                sendMessage: async message => { requests.push(message); return respond(message); },
            },
            storage: { onChanged: { addListener: listener => { onChanged = listener; } } },
        },
        LowValueGuardSettings: { getSettings: async () => ({ ...settings }) },
        LowValueGuardFeedback: { addButtons() {}, removeButtons() {} },
        MutationObserver: class { observe() {} disconnect() {} },
        getComputedStyle: () => ({ position: 'static' }),
        window: { location: { reload: () => assert.fail('The feed must not reload') } },
        console: { error() {} },
    });
    vm.runInContext(readFileSync(`${__dirname}/content.js`, 'utf8'), context);
    await flush();
    return {
        post, requests,
        async setSettings(changes) {
            settings = { ...settings, ...changes };
            onChanged(Object.fromEntries(Object.entries(changes).map(([key, newValue]) => [key, { newValue }])), 'sync');
            await flush();
        },
        async changeUser(userId) {
            onChanged({ authUserId: { newValue: userId } }, 'local');
            await flush();
        },
        reveal() { vm.runInContext('revealPost(document.querySelectorAll()[0])', context); },
    };
}

test('enabling and disabling filtering updates existing posts without reloading', async () => {
    const feed = await openFeed({ isEnabled: false, filterMode: 'hide' });
    assert.equal(feed.requests.length, 0);
    await feed.setSettings({ isEnabled: true });
    assert.equal(feed.post.style.display, 'none');
    await feed.setSettings({ isEnabled: false });
    assert.equal(feed.post.style.display, '');
    await feed.setSettings({ isEnabled: true });
    assert.equal(feed.post.style.display, 'none');
    assert.equal(feed.requests.length, 1);
});

test('switching blur and hide reuses the result and preserves revealed posts', async () => {
    const feed = await openFeed({ isEnabled: true, filterMode: 'blur' });
    assert.equal(feed.post.children.length, 1);
    await feed.setSettings({ filterMode: 'hide' });
    assert.equal(feed.post.children.length, 0);
    assert.equal(feed.post.style.display, 'none');
    feed.reveal();
    await feed.setSettings({ filterMode: 'blur' });
    assert.equal(feed.post.children.length, 0);
    assert.equal(feed.post.style.display, '');
    assert.equal(feed.requests.length, 1);
});

test('sign-in retries posts after previous classification attempts failed', async () => {
    let signedIn = false;
    const feed = await openFeed({ isEnabled: true, filterMode: 'hide' }, async () => (
        signedIn ? { label: 'useless' } : { error: 'Service unavailable' }
    ));
    assert.equal(feed.requests.length, 1);
    signedIn = true;
    await feed.changeUser('signed-in-user');
    assert.equal(feed.requests.length, 2);
    assert.equal(feed.post.style.display, 'none');
});

test('sign-out switches models and ignores an old personal-model response', async () => {
    let resolvePersonal;
    let requestCount = 0;
    const feed = await openFeed({ isEnabled: true, filterMode: 'hide' }, () => (
        ++requestCount === 1
            ? new Promise(resolve => { resolvePersonal = resolve; })
            : Promise.resolve({ label: 'useful' })
    ));
    await feed.changeUser(null);
    resolvePersonal({ label: 'useless' });
    await flush();
    assert.equal(feed.requests.length, 2);
    assert.equal(feed.post.style.display, '');
});
