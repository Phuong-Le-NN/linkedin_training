// Shared settings access for the popup and LinkedIn content script.
(() => {
    const defaults = Object.freeze({ isEnabled: false, filterMode: "blur" });
    const validFilterModes = new Set(["blur", "hide"]);

    async function getSettings() {
        const saved = await chrome.storage.sync.get(defaults);
        // Keep existing installations in Hide mode after renaming its stored value.
        const filterMode = saved.filterMode === "remove" ? "hide" : saved.filterMode;
        return {
            isEnabled: saved.isEnabled === true,
            filterMode: validFilterModes.has(filterMode) ? filterMode : defaults.filterMode
        };
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

    globalThis.LowValueGuardSettings = Object.freeze({ getSettings, updateSettings });
})();
