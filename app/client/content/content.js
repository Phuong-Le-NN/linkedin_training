const API_URL = 'http://127.0.0.1:8000';

const MAX_CONCURRENT = 4;
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 15_000;

let activeRequests = 0;
const requestQueue = [];

function enqueue(task) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ task, resolve, reject });
        processQueue();
    });
}

function processQueue() {
    console.log('[Queue]', {
        activeRequests,
        queuedRequests: requestQueue.length,
        availableSlots: MAX_CONCURRENT - activeRequests
    });

    while (
        activeRequests < MAX_CONCURRENT &&
        requestQueue.length > 0
    ) {
        const job = requestQueue.shift();
        activeRequests++;

        console.log('[Queue] Starting request', {
            activeRequests,
            queuedRequests: requestQueue.length
        });

        job.task()
            .then(job.resolve)
            .catch(job.reject)
            .finally(() => {
                activeRequests--;

                console.log('[Queue] Request finished', {
                    activeRequests,
                    queuedRequests: requestQueue.length,
                    availableSlots: MAX_CONCURRENT - activeRequests
                });

                processQueue();
            });
    }
}

async function classifyRequest(endpoint, body) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            const data = await response.json();

            if (response.status === 429 && attempt < MAX_RETRIES) {
                const retryAfter =
                    Number(response.headers.get('Retry-After')) || 1;

                console.warn(
                    `[Cringe Guard] Server busy. Retrying in ${retryAfter}s`
                );

                await new Promise(resolve => {
                    setTimeout(resolve, retryAfter * 1000);
                });

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

    throw new Error('Classification failed after retries');
}

function isValidLinkedInSender(sender) {
    return sender.url?.startsWith(
        'https://www.linkedin.com/feed/'
    );
}

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
        if (!isValidLinkedInSender(sender)) {
            return;
        }

        if (message.type === 'classifyPost') {
            console.log(
                '[Cringe Guard] Queuing single classification'
            );

            enqueue(() =>
                classifyRequest('/classify', {
                    text: message.text
                })
            )
                .then(sendResponse)
                .catch(error => {
                    console.error(
                        '[Cringe Guard] Classification failed:',
                        error
                    );

                    sendResponse({
                        error: error.message
                    });
                });

            return true;
        }

        if (message.type === 'classifyPosts') {
            if (
                !Array.isArray(message.texts) ||
                message.texts.length === 0
            ) {
                sendResponse({
                    error: 'No posts were provided'
                });

                return true;
            }

            if (message.texts.length > 100) {
                sendResponse({
                    error: 'A maximum of 100 posts can be classified at once'
                });

                return true;
            }

            console.log(
                '[Cringe Guard] Queuing batch classification',
                {
                    count: message.texts.length
                }
            );

            enqueue(() =>
                classifyRequest('/classify-batch', {
                    texts: message.texts
                })
            )
                .then(sendResponse)
                .catch(error => {
                    console.error(
                        '[Cringe Guard] Batch classification failed:',
                        error
                    );

                    sendResponse({
                        error: error.message
                    });
                });

            return true;
        }
    }
);