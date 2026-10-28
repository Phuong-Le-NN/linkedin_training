import { auth } from '../lib/auth.js';
import { API_BASE_URL } from '../lib/api_config.js';

const MAX_CONCURRENT = 4;
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 15_000;

let activeRequests = 0;
const requestQueue = [];

async function authorizationHeaders() {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in to use Low-Value Guard.');
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
            .finally(() => { //if this request does not get classified, when the previous request finish the queue will be called to tried again
                activeRequests--;
                processQueue();
            });
    }
}

async function classifyWithRetry(text) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS
        );

        try {
            const response = await fetch(
                `${API_BASE_URL}/classify`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...await authorizationHeaders()
                    },
                    body: JSON.stringify({ text }),
                    signal: controller.signal
                }
            );

            const data = await response.json();

            if (response.status === 429 && attempt < MAX_RETRIES) {
                console.log("Server concurrency full, retrying");
                await new Promise(resolve =>
                    setTimeout(resolve, 1000 * (attempt + 1))
                );
                continue;
            }

            if (!response.ok) {
                throw new Error(
                    data.detail || `Server returned ${response.status}`
                );
            }

            return data;
        } finally {
            clearTimeout(timeout);
        }
    }
}

async function saveFeedback(text, useful) {
    const response = await fetch(`${API_BASE_URL}/feedback`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...await authorizationHeaders()
        },
        body: JSON.stringify({ text, useful })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.detail || `Server returned ${response.status}`);
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
