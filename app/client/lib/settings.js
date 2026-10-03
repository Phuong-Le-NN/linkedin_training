// Shared settings access for the popup, options page, and LinkedIn content script.
(() => {
    const defaults = Object.freeze({ isEnabled: false, filterMode: "blur" });
    const validFilterModes = new Set(["blur", "remove"]);

    async function getSettings() {
        const saved = await chrome.storage.sync.get(defaults);
        return { ...defaults, ...saved };
    }

    async function updateSettings(changes) {
        const update = {};
        if (typeof changes.isEnabled === "boolean") {
            update.isEnabled = changes.isEnabled;
        }
        if (validFilterModes.has(changes.filterMode)) {
            update.filterMode = changes.filterMode;
        }
        if (Object.keys(update).length) {
            await chrome.storage.sync.set(update);
        }
        return getSettings();
    }

    globalThis.CringeGuardSettings = Object.freeze({ getSettings, updateSettings });
})();
