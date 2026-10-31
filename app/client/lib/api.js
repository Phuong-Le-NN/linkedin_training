import { authorizationHeaders, requestJson } from './http.js';

/**
 * @param {string} text
 * @param {import('./contracts').TokenUser | null} user
 * @returns {Promise<import('./contracts').ClassificationResponse>}
 */
export async function classifyPost(text, user) {
    const data = await requestJson('/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authorizationHeaders(user)) },
        body: JSON.stringify({ text })
    });
    if (data.label !== 'useful' && data.label !== 'useless') {
        throw new Error('Invalid classification response');
    }
    return { label: data.label };
}

/**
 * @param {string} text
 * @param {boolean} useful
 * @param {import('./contracts').TokenUser | null} user
 * @returns {Promise<import('./contracts').FeedbackResponse>}
 */
export async function saveFeedback(text, useful, user) {
    const data = await requestJson('/feedback', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(await authorizationHeaders(user, true))
        },
        body: JSON.stringify({ text, useful })
    });
    if (data.saved !== true) throw new Error('Invalid feedback response');
    return { saved: true };
}

/**
 * @param {import('./contracts').TokenUser} user
 * @returns {Promise<import('./contracts').FeedbackCountResponse>}
 */
export async function getFeedbackCount(user) {
    const data = await requestJson('/feedback/count', {
        headers: await authorizationHeaders(user, true)
    });
    if (
        typeof data.count !== 'number' ||
        !Number.isInteger(data.count) ||
        data.count < 0 ||
        (data.limit !== undefined &&
            (typeof data.limit !== 'number' || !Number.isInteger(data.limit) || data.limit < 0))
    ) {
        throw new Error('Invalid feedback count response');
    }
    return { count: data.count, limit: data.limit };
}

/**
 * @param {import('./contracts').TokenUser} user
 * @returns {Promise<import('./contracts').TrainingResponse>}
 */
export async function trainModel(user) {
    const data = await requestJson('/train', {
        method: 'POST',
        headers: await authorizationHeaders(user, true)
    });
    if (
        (data.build_id != null && typeof data.build_id !== 'string') ||
        (data.log_url != null && typeof data.log_url !== 'string')
    ) {
        throw new Error('Invalid training response');
    }
    return { build_id: data.build_id, log_url: data.log_url };
}
