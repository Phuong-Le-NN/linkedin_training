import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyWithRetry } from './classification.js';
import { saveFeedback } from '../lib/api.js';
import { REQUEST_TIMEOUT_MS } from '../lib/http.js';

function worker(
    t,
    user,
    respond = () => new Response(JSON.stringify({ label: 'useful', saved: true })),
    forceTimeout = false
) {
    const requests = [];
    const delays = [];
    const schedule = globalThis.setTimeout;
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        if (delay === REQUEST_TIMEOUT_MS) return schedule(callback, forceTimeout ? 0 : delay);
        delays.push(delay);
        return schedule(callback, 0);
    });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, ...options });
        return respond(url, options, requests.length);
    });
    return {
        requests,
        delays,
        classify: (text) => classifyWithRetry(text, async () => user),
        save: (text, useful) => saveFeedback(text, useful, user)
    };
}

test('signed-out classification sends no Authorization header', async (t) => {
    const client = worker(t, null);
    const result = await client.classify('A post');
    assert.equal(result.label, 'useful');
    assert.equal(client.requests.length, 1);
    assert.equal(client.requests[0].headers.Authorization, undefined);
});

test('network failures retry with increasing delays and can recover', async (t) => {
    const client = worker(t, null, (_url, _options, attempt) => {
        if (attempt < 3) throw new TypeError('Network unavailable');
        return new Response(JSON.stringify({ label: 'useful' }));
    });
    assert.equal((await client.classify('A post')).label, 'useful');
    assert.equal(client.requests.length, 3);
    assert.deepEqual(client.delays, [1000, 2000]);
});

test('busy responses honor Retry-After and stop after three attempts', async (t) => {
    const client = worker(
        t,
        null,
        () =>
            new Response(JSON.stringify({ detail: 'Busy' }), {
                status: 429,
                headers: { 'Retry-After': '2' }
            })
    );
    await assert.rejects(client.classify('A post'), /Busy/);
    assert.equal(client.requests.length, 3);
    assert.deepEqual(client.delays, [2000, 2000]);
});

test('a non-JSON temporary server error can recover', async (t) => {
    const client = worker(t, null, (_url, _options, attempt) =>
        attempt === 1
            ? new Response('Bad gateway', { status: 502 })
            : new Response(JSON.stringify({ label: 'useful' }))
    );
    assert.equal((await client.classify('A post')).label, 'useful');
    assert.equal(client.requests.length, 2);
});

test('timeouts abort each attempt and stop after three requests', async (t) => {
    const client = worker(
        t,
        null,
        (_url, options) =>
            new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () =>
                    reject(new DOMException('Timed out', 'AbortError'))
                );
            }),
        true
    );
    await assert.rejects(client.classify('A post'), /Timed out/);
    assert.equal(client.requests.length, 3);
    assert.ok(client.requests.every((request) => request.signal.aborted));
});

test('validation errors show readable feedback without retrying', async (t) => {
    const client = worker(
        t,
        { getIdToken: async () => 'token' },
        () =>
            new Response(
                JSON.stringify({ detail: [{ msg: 'Text must be at most 10000 characters' }] }),
                { status: 422 }
            )
    );
    await assert.rejects(client.save('Too much text', true), /at most 10000 characters/);
    assert.equal(client.requests.length, 1);
});

for (const status of [400, 401, 403, 404, 409, 422]) {
    test(`HTTP ${status} is not retried`, async (t) => {
        const client = worker(
            t,
            null,
            () => new Response(JSON.stringify({ detail: 'Rejected' }), { status })
        );
        await assert.rejects(client.classify('A post'), /Rejected/);
        assert.equal(client.requests.length, 1);
        assert.deepEqual(client.delays, []);
    });
}

test('authentication failures do not retry or send a request', async (t) => {
    const client = worker(t, {
        getIdToken: async () => {
            throw new Error('Token unavailable');
        }
    });
    await assert.rejects(client.classify('A post'), /Token unavailable/);
    assert.equal(client.requests.length, 0);
    assert.deepEqual(client.delays, []);
});

test('feedback submissions are never automatically retried', async (t) => {
    const client = worker(
        t,
        { getIdToken: async () => 'token' },
        () => new Response(JSON.stringify({ detail: 'Unavailable' }), { status: 503 })
    );
    await assert.rejects(client.save('A post', true), /Unavailable/);
    assert.equal(client.requests.length, 1);
});

test('signed-out feedback is refused before making a request', async (t) => {
    const client = worker(t, null);
    await assert.rejects(client.save('A post', true), /Sign in to save feedback/);
    assert.equal(client.requests.length, 0);
});

test('signed-in requests include the Firebase token', async (t) => {
    const client = worker(t, { getIdToken: async () => 'firebase-token' });
    await client.classify('A post');
    await client.save('A post', true);
    assert.equal(client.requests.length, 2);
    for (const request of client.requests) {
        assert.equal(request.headers.Authorization, 'Bearer firebase-token');
    }
});
