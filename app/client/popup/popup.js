document.addEventListener('DOMContentLoaded', async () => {
    const settingsApi = globalThis.LowValueGuardSettings;
    const controls = document.getElementById('controls');
    const toggle = document.getElementById('toggle-switch');
    const status = document.getElementById('filter-status');
    const description = document.getElementById('mode-description');
    const errorMessage = document.getElementById('popup-error');
    const modeInputs = [...document.querySelectorAll('input[name="filter-mode"]')];
    let settings;

    function render() {
        toggle.checked = settings.isEnabled;
        document.body.dataset.enabled = String(settings.isEnabled);
        status.textContent = settings.isEnabled ? 'Filtering is on' : 'Filtering is paused';
        modeInputs.forEach(input => {
            input.checked = input.value === settings.filterMode;
        });
        description.textContent = settings.filterMode === 'remove'
            ? 'Filtered posts are hidden from your feed.'
            : 'Select “Show post” to reveal a blurred post.';
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.hidden = false;
    }

    async function save(changes) {
        controls.disabled = true;
        errorMessage.hidden = true;
        try {
            settings = await settingsApi.updateSettings(changes);
        } catch (error) {
            console.error('[Low-Value Guard] Could not save settings:', error);
            showError('Could not save your changes. Please try again.');
        } finally {
            render();
            controls.disabled = false;
        }
    }

    document.getElementById('settings-button').addEventListener('click', async () => {
        try {
            await chrome.runtime.openOptionsPage();
        } catch (error) {
            console.error('[Low-Value Guard] Could not open settings:', error);
            showError('Could not open settings. Please try again.');
        }
    });

    try {
        settings = await settingsApi.getSettings();
        render();
        controls.disabled = false;
    } catch (error) {
        console.error('[Low-Value Guard] Could not load settings:', error);
        status.textContent = 'Settings unavailable';
        showError('Could not load your preferences. Close and reopen this popup to retry.');
        return;
    }

    toggle.addEventListener('change', () => {
        void save({ isEnabled: toggle.checked });
    });

    modeInputs.forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) void save({ filterMode: input.value });
        });
    });
});
