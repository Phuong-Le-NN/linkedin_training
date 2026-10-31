import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPost, getFeedbackCount, trainModel } from './api.js';
import { classifyPost as classifyMessage, saveFeedback as feedbackMessage } from './messages.js';

const user = { getIdToken: async () => 'test-token' };

function respond(t, body, status = 200) {
    return t.mock.method(
        globalThis,
        'fetch',
        async () => new Response(JSON.stringify(body), { status })
    );
}

test('feedback counts reject incomplete and invalid API data', async (t) => {
    for (const body of [{}, { count: '7' }, { count: -1 }, { count: 1, limit: '100' }]) {
        respond(t, body);
        await assert.rejects(getFeedbackCount(user), /Invalid feedback count response/);
    }
    respond(t, { count: 7, limit: 100 });
    assert.deepEqual(await getFeedbackCount(user), { count: 7, limit: 100 });
});

test('training accepts nullable build details and uses an authenticated POST', async (t) => {
    const request = respond(t, { build_id: null, log_url: null });
    assert.deepEqual(await trainModel(user), { build_id: null, log_url: null });
    const [url, options] = request.mock.calls[0].arguments;
    assert.ok(url.endsWith('/train'));
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
});

test('training errors and malformed responses do not trigger another submission', async (t) => {
    const request = respond(t, { detail: [{ msg: 'Label a post before training.' }] }, 422);
    await assert.rejects(trainModel(user), /Label a post before training/);
    assert.equal(request.mock.callCount(), 1);
    respond(t, { build_id: 123 });
    await assert.rejects(trainModel(user), /Invalid training response/);
});

test('classification rejects invalid success responses', async (t) => {
    respond(t, { label: 'unknown' });
    await assert.rejects(classifyPost('A post', null), /Invalid classification response/);
});

test('extension messages validate replies and preserve worker errors', async (t) => {
    const previous = globalThis.chrome;
    const messages = [];
    let reply = { label: 'useless' };
    globalThis.chrome = {
        runtime: {
            async sendMessage(message) {
                messages.push(message);
                return reply;
            }
        }
    };
    t.after(() => {
        globalThis.chrome = previous;
    });
    assert.deepEqual(await classifyMessage('A post'), { label: 'useless' });
    reply = { saved: true };
    assert.deepEqual(await feedbackMessage('A post', true), { saved: true });
    assert.deepEqual(messages, [
        { type: 'classifyPost', text: 'A post' },
        { type: 'saveFeedback', text: 'A post', useful: true }
    ]);
    reply = undefined;
    await assert.rejects(classifyMessage('A post'), /Invalid classification response/);
    reply = { error: 'Sign in to save feedback.' };
    await assert.rejects(feedbackMessage('A post', false), /Sign in to save feedback/);
});
