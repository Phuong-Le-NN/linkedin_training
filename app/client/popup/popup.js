document.addEventListener("DOMContentLoaded", async () => {
    const settingsApi = globalThis.CringeGuardSettings;
    const toggleSwitch = document.getElementById("toggle-switch");
    const toggleSlider = document.querySelector(".toggle-slider");
    const modeDescription = document.getElementById("mode-description");

    function renderFilterMode(mode) {
        toggleSlider.classList.toggle("blur", mode === "blur");
        toggleSlider.classList.toggle("remove", mode === "remove");
        modeDescription.textContent = mode === "remove"
            ? "Vanish cringe completely"
            : "Blurs cringe until you decide";
    }

    const [settings, stats] = await Promise.all([
        settingsApi.getSettings(),
        chrome.storage.sync.get({ cringeCount: 0, timeSavedInMinutes: 0 }),
    ]);

    toggleSwitch.checked = settings.isEnabled;
    renderFilterMode(settings.filterMode);
    document.getElementById("cringe-count").textContent = stats.cringeCount;
    document.getElementById("time-saved").textContent = `${Math.ceil(stats.timeSavedInMinutes)}m`;

    toggleSwitch.addEventListener("change", () => {
        settingsApi.updateSettings({ isEnabled: toggleSwitch.checked });
    });

    toggleSlider.addEventListener("click", async () => {
        const current = await settingsApi.getSettings();
        const filterMode = current.filterMode === "blur" ? "remove" : "blur";
        renderFilterMode(filterMode);
        await settingsApi.updateSettings({ filterMode });
    });

    document.querySelector(".settings-icon").addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
    });
});
