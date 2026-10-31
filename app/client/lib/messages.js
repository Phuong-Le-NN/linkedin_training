/**
 * @param {import('./contracts').ExtensionRequest} message
 */
async function sendMessage(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (result?.error) throw new Error(result.error);
    return result;
}

/** @param {string} text @returns {Promise<import('./contracts').ClassificationResponse>} */
export async function classifyPost(text) {
    const result = await sendMessage({ type: 'classifyPost', text });
    if (result?.label !== 'useful' && result?.label !== 'useless') {
        throw new Error('Invalid classification response');
    }
    return { label: result.label };
}

/** @param {string} text @param {boolean} useful
 * @returns {Promise<import('./contracts').FeedbackResponse>} */
export async function saveFeedback(text, useful) {
    const result = await sendMessage({ type: 'saveFeedback', text, useful });
    if (result?.saved !== true) throw new Error('Invalid feedback response');
    return { saved: true };
}
