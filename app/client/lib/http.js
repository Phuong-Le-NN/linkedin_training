import { API_BASE_URL } from './api_config.js';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
export const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
    /** @param {string} message @param {boolean} retryable @param {number | undefined} retryAfterMs */
    constructor(message, retryable = false, retryAfterMs = undefined) {
        super(message);
        this.name = 'ApiError';
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
    }
}

/** @param {Record<string, unknown> | undefined} data @param {number} status */
function errorMessage(data, status) {
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.detail)) {
        return data.detail.map((error) => error.msg).join('; ');
    }
    return `Server returned ${status}`;
}

/** @param {import('./contracts').TokenUser | null} user
 * @returns {Promise<Record<string, string>>} */
export async function authorizationHeaders(user, required = false) {
    if (!user) {
        if (required) throw new Error('Sign in to save feedback.');
        return {};
    }
    return { Authorization: `Bearer ${await user.getIdToken()}` };
}

/**
 * Parse API responses consistently. Only the classifier decides whether to retry.
 * @param {string} path
 * @param {RequestInit} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        let response;
        let body;
        try {
            response = await fetch(`${API_BASE_URL}${path}`, {
                ...options,
                signal: controller.signal
            });
            body = await response.text();
        } catch (error) {
            throw new ApiError(
                error instanceof Error ? error.message : 'Network request failed',
                true
            );
        }

        let data;
        try {
            data = JSON.parse(body);
        } catch {
            // An HTML gateway error should follow the same HTTP retry policy.
        }
        if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
            const retryAfter = response.headers.get('retry-after');
            const seconds = retryAfter === null ? NaN : Number(retryAfter);
            const delay = Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(retryAfter || '') - Date.now();
            throw new ApiError(
                data === undefined
                    ? `API returned non-JSON (HTTP ${response.status})`
                    : errorMessage(data, response.status),
                RETRYABLE_STATUSES.has(response.status),
                Number.isFinite(delay) ? Math.max(0, delay) : undefined
            );
        }
        return data;
    } finally {
        clearTimeout(timeout);
    }
}
