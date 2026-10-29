import { auth } from '../lib/auth.js';
import { API_BASE_URL } from '../lib/api_config.js';

const MAX_CONCURRENT = 4;
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 10_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

let activeRequests = 0;
const requestQueue = [];

function apiErrorMessage(data, status) {
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.detail)) {
        return data.detail.map(error => error.msg).join('; ');
    }
    return `Server returned ${status}`;
}

async function authorizationHeaders(required = false) {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) {
        if (required) throw new Error('Sign in to save feedback.');
        return {};
    }
    return { Authorization: `Bearer ${await user.getIdToken()}` };
}

function enqueue(text) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ text, resolve, reject });
        processQueue();
    });
}

function processQueue() {
    while (activeRequests < MAX_CONCURRENT && requestQueue.length > 0) {
        const job = requestQueue.shift();
        activeRequests++;

        classifyWithRetry(job.text)
            .then(job.resolve)
            .catch(job.reject)
            .finally(() => {
                activeRequests--;
                processQueue();
            });
    }
}

async function classifyWithRetry(text) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await classifyOnce(text);
        } catch (error) {
            if (!error.retryable || attempt === MAX_RETRIES) throw error;
            const delay = Math.min(
                error.retryAfterMs ?? RETRY_DELAY_MS * 2 ** attempt,
                MAX_RETRY_DELAY_MS
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function classifyOnce(text) {
    const headers = await authorizationHeaders();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        let response;
        let body;
        try {
            response = await fetch(`${API_BASE_URL}/classify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ text }),
                signal: controller.signal
            });
            body = await response.text();
        } catch (error) {
            error.retryable = true;
            throw error;
        }

        let data;
        try {
            data = JSON.parse(body);
        } catch {
            console.error('[Low-Value Guard] API returned non-JSON:', {
                status: response.status,
                contentType: response.headers.get('content-type'),
                body: body.slice(0, 500)
            });
        }

        if (!response.ok || data === undefined) {
            const error = new Error(
                data === undefined ? `API returned non-JSON (HTTP ${response.status})`
                    : apiErrorMessage(data, response.status)
            );
            error.retryable = RETRYABLE_STATUSES.has(response.status);
            const retryAfter = response.headers.get('retry-after');
            if (retryAfter !== null) {
                const seconds = Number(retryAfter);
                const delay = Number.isFinite(seconds)
                    ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
                if (Number.isFinite(delay)) error.retryAfterMs = Math.max(0, delay);
            }
            throw error;
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

async function saveFeedback(text, useful) {
    const response = await fetch(`${API_BASE_URL}/feedback`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...await authorizationHeaders(true)
        },
        body: JSON.stringify({ text, useful })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(apiErrorMessage(data, response.status));
    }
    return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender.url?.startsWith('https://www.linkedin.com/feed/')) return;

    let request;
    if (message.type === 'classifyPost') {
        request = enqueue(message.text);
    } else if (message.type === 'saveFeedback') {
        request = saveFeedback(message.text, message.useful);
    } else {
        return;
    }

    request
        .then(sendResponse)
        .catch(error => {
            console.error('[Low-Value Guard] Request failed:', error);
            sendResponse({ error: error.message });
        });

    return true;
});
