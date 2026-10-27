import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth/web-extension';
import { auth } from '../lib/auth.js';

document.addEventListener('DOMContentLoaded', async () => {
    const signInForm = document.getElementById('sign-in-form');
    const signOutButton = document.getElementById('sign-out-button');
    const authStatus = document.getElementById('auth-status');
    const authError = document.getElementById('auth-error');

    onAuthStateChanged(auth, user => {
        authError.hidden = true;
        authStatus.textContent = user ? `Signed in as ${user.email || 'your account'}` : 'Sign in to your account.';
        signInForm.hidden = Boolean(user);
        signOutButton.hidden = !user;
        if (user) signInForm.reset();
    }, error => {
        console.error('[Low-Value Guard] Authentication unavailable:', error);
        authStatus.textContent = 'Could not load your sign-in state.';
    });

    signInForm.addEventListener('submit', async event => {
        event.preventDefault();
        authError.hidden = true;
        const button = signInForm.querySelector('button');
        button.disabled = true;
        try {
            await signInWithEmailAndPassword(
                auth,
                signInForm.elements.email.value.trim(),
                signInForm.elements.password.value
            );
        } catch (error) {
            console.error('[Low-Value Guard] Sign-in failed:', error);
            authError.textContent = 'Could not sign in. Check your email and password.';
            authError.hidden = false;
        } finally {
            button.disabled = false;
        }
    });

    signOutButton.addEventListener('click', async () => {
        authError.hidden = true;
        signOutButton.disabled = true;
        try {
            await signOut(auth);
        } catch (error) {
            console.error('[Low-Value Guard] Sign-out failed:', error);
            authError.textContent = 'Could not sign out. Please try again.';
            authError.hidden = false;
        } finally {
            signOutButton.disabled = false;
        }
    });

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
