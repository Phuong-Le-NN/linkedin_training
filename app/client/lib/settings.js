/** @typedef {import('./contracts').FeedSettings} FeedSettings */

/** @type {Readonly<FeedSettings>} */
export const DEFAULT_SETTINGS = Object.freeze({ isEnabled: false, filterMode: 'blur' });

/** @returns {Promise<FeedSettings>} */
export async function getSettings() {
    const saved = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    // Keep existing installations in Hide mode after renaming its stored value.
    const filterMode = saved.filterMode === 'remove' ? 'hide' : saved.filterMode;
    return {
        isEnabled: saved.isEnabled === true,
        filterMode: filterMode === 'hide' ? 'hide' : 'blur'
    };
}

/** @param {Partial<FeedSettings>} changes */
export async function updateSettings(changes) {
    /** @type {Partial<FeedSettings>} */
    const update = {};
    if (typeof changes.isEnabled === 'boolean') update.isEnabled = changes.isEnabled;
    if (changes.filterMode === 'blur' || changes.filterMode === 'hide') {
        update.filterMode = changes.filterMode;
    }
    if (Object.keys(update).length) await chrome.storage.sync.set(update);
    return getSettings();
}
