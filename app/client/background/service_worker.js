import { auth } from '../lib/auth.js';
import { saveFeedback } from '../lib/api.js';
import { classifyWithRetry } from './classification.js';

const MAX_CONCURRENT = 4;
let activeRequests = 0;
const requestQueue = [];

async function getUser() {
    await auth.authStateReady();
    return auth.currentUser;
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
        classifyWithRetry(job.text, getUser)
            .then(job.resolve)
            .catch(job.reject)
            .finally(() => {
                activeRequests--;
                processQueue();
            });
    }
}

/** @param {import('../lib/contracts').ExtensionRequest} message */
function handleMessage(message, sender, sendResponse) {
    if (!sender.url?.startsWith('https://www.linkedin.com/feed/')) return;
    let request;
    if (message.type === 'classifyPost') {
        request = enqueue(message.text);
    } else if (message.type === 'saveFeedback') {
        request = getUser().then((user) => saveFeedback(message.text, message.useful, user));
    } else {
        return;
    }
    request.then(sendResponse).catch((error) => {
        console.error('[Low-Value Guard] Request failed:', error);
        sendResponse({ error: error.message });
    });
    return true;
}

chrome.runtime.onMessage.addListener(handleMessage);
