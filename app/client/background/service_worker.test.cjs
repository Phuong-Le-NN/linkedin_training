const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

function worker(user, respond = () => new Response(JSON.stringify({ label: 'useful', saved: true })), forceTimeout = false) {
    const requests = [];
    const delays = [];
    const context = vm.createContext({
        auth: { authStateReady: async () => {}, currentUser: user },
        API_BASE_URL: 'https://api.example',
        chrome: { runtime: { onMessage: { addListener() {} } } },
        AbortController, clearTimeout,
        console: { error() {} },
        setTimeout(callback, delay) {
            if (delay === 15_000) return setTimeout(callback, forceTimeout ? 0 : delay);
            delays.push(delay);
            return setTimeout(callback, 0);
        },
        fetch: async (url, options) => {
            requests.push({ url, ...options });
            return respond(url, options, requests.length);
        },
    });
    const source = readFileSync(`${__dirname}/service_worker.js`, 'utf8').replace(/^import .*\n/gm, '');
    vm.runInContext(source, context);
    return { requests, delays, run: expression => vm.runInContext(expression, context) };
}

test('signed-out classification sends no Authorization header', async () => {
    const client = worker(null);
    const result = await client.run("classifyWithRetry('A post')");
    assert.equal(result.label, 'useful');
    assert.equal(client.requests.length, 1);
    assert.equal(client.requests[0].headers.Authorization, undefined);
});

test('network failures retry with increasing delays and can recover', async () => {
    const client = worker(null, (_url, _options, attempt) => {
        if (attempt < 3) throw new TypeError('Network unavailable');
        return new Response(JSON.stringify({ label: 'useful' }));
    });
    assert.equal((await client.run("classifyWithRetry('A post')")).label, 'useful');
    assert.equal(client.requests.length, 3);
    assert.deepEqual(client.delays, [1000, 2000]);
});

test('busy responses honor Retry-After and stop after three attempts', async () => {
    const client = worker(null, () => new Response(JSON.stringify({ detail: 'Busy' }), {
        status: 429, headers: { 'Retry-After': '2' }
    }));
    await assert.rejects(client.run("classifyWithRetry('A post')"), /Busy/);
    assert.equal(client.requests.length, 3);
    assert.deepEqual(client.delays, [2000, 2000]);
});

test('a non-JSON temporary server error can recover', async () => {
    const client = worker(null, (_url, _options, attempt) => attempt === 1
        ? new Response('Bad gateway', { status: 502 })
        : new Response(JSON.stringify({ label: 'useful' })));
    assert.equal((await client.run("classifyWithRetry('A post')")).label, 'useful');
    assert.equal(client.requests.length, 2);
});

test('timeouts abort each attempt and stop after three requests', async () => {
    const client = worker(null, (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    }), true);
    await assert.rejects(client.run("classifyWithRetry('A post')"), /Timed out/);
    assert.equal(client.requests.length, 3);
    assert.ok(client.requests.every(request => request.signal.aborted));
});

test('validation errors show readable feedback without retrying', async () => {
    const client = worker({ getIdToken: async () => 'token' }, () => new Response(
        JSON.stringify({ detail: [{ msg: 'Text must be at most 10000 characters' }] }), { status: 422 }
    ));
    await assert.rejects(client.run("saveFeedback('Too much text', true)"), /at most 10000 characters/);
    assert.equal(client.requests.length, 1);
});

for (const status of [400, 401, 403, 404, 409, 422]) {
    test(`HTTP ${status} is not retried`, async () => {
        const client = worker(null, () => new Response(JSON.stringify({ detail: 'Rejected' }), { status }));
        await assert.rejects(client.run("classifyWithRetry('A post')"), /Rejected/);
        assert.equal(client.requests.length, 1);
        assert.deepEqual(client.delays, []);
    });
}

test('authentication failures do not retry or send a request', async () => {
    const client = worker({ getIdToken: async () => { throw new Error('Token unavailable'); } });
    await assert.rejects(client.run("classifyWithRetry('A post')"), /Token unavailable/);
    assert.equal(client.requests.length, 0);
    assert.deepEqual(client.delays, []);
});

test('feedback submissions are never automatically retried', async () => {
    const client = worker({ getIdToken: async () => 'token' }, () => new Response(
        JSON.stringify({ detail: 'Unavailable' }), { status: 503 }
    ));
    await assert.rejects(client.run("saveFeedback('A post', true)"), /Unavailable/);
    assert.equal(client.requests.length, 1);
});

test('signed-out feedback is refused before making a request', async () => {
    const client = worker(null);
    await assert.rejects(client.run("saveFeedback('A post', true)"), /Sign in to save feedback/);
    assert.equal(client.requests.length, 0);
});

test('signed-in requests include the Firebase token', async () => {
    const client = worker({ getIdToken: async () => 'firebase-token' });
    await client.run("classifyWithRetry('A post')");
    await client.run("saveFeedback('A post', true)");
    assert.equal(client.requests.length, 2);
    for (const request of client.requests) {
        assert.equal(request.headers.Authorization, 'Bearer firebase-token');
    }
});
