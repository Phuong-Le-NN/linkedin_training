import { classifyPost } from '../lib/api.js';
import { ApiError } from '../lib/http.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 10_000;

/**
 * Read the current user on every attempt, including after a sign-in change.
 * @param {string} text
 * @param {() => Promise<import('../lib/contracts').TokenUser | null>} getUser
 */
export async function classifyWithRetry(text, getUser) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await classifyPost(text, await getUser());
        } catch (error) {
            if (!(error instanceof ApiError) || !error.retryable || attempt === MAX_RETRIES)
                throw error;
            const delay = Math.min(
                error.retryAfterMs ?? RETRY_DELAY_MS * 2 ** attempt,
                MAX_RETRY_DELAY_MS
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}
