const MAX_CONCURRENT = 4;
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 15_000;

let activeRequests = 0;
const requestQueue = [];

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
                'http://127.0.0.1:8000/classify',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
        message.type !== 'classifyPost' ||
        !sender.url?.startsWith('https://www.linkedin.com/feed/')
    ) {
        return;
    }

    enqueue(message.text)
        .then(sendResponse)
        .catch(error => {
            console.error('[Low-Value Guard] Classification failed:', error);
            sendResponse({ error: error.message });
        });

    return true;
});
