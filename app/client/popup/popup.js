import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth/web-extension';
import { auth } from '../lib/auth.js';
import { API_BASE_URL } from '../lib/api_config.js';

function initializeAuthentication(onUserChanged) {
    const authForm = document.getElementById('auth-form');
    const signOutButton = document.getElementById('sign-out-button');
    const authStatus = document.getElementById('auth-status');
    const authError = document.getElementById('auth-error');

    onAuthStateChanged(auth, user => {
        authError.hidden = true;
        authStatus.textContent = user ? `Signed in as ${user.email || 'your account'}` : 'Using the shared model. Sign in to save feedback and train your model.';
        authForm.hidden = Boolean(user);
        signOutButton.hidden = !user;
        onUserChanged(user);
        if (user) authForm.reset();
    }, error => {
        console.error('[Low-Value Guard] Authentication unavailable:', error);
        authStatus.textContent = 'Could not load your sign-in state.';
    });

    authForm.addEventListener('submit', async event => {
        event.preventDefault();
        authError.hidden = true;
        const signingUp = event.submitter?.value === 'sign-up';
        const buttons = authForm.querySelectorAll('button[type="submit"]');
        buttons.forEach(button => { button.disabled = true; });
        try {
            const authenticate = signingUp ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
            await authenticate(
                auth,
                authForm.elements.email.value.trim(),
                authForm.elements.password.value
            );
        } catch (error) {
            console.error('[Low-Value Guard] Authentication failed:', error);
            authError.textContent = signingUp
                ? 'Could not create an account. Check your email and password.'
                : 'Could not sign in. Check your email and password.';
            authError.hidden = false;
        } finally {
            buttons.forEach(button => { button.disabled = false; });
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
}

function initializeTrainingActions() {
    const countButton = document.getElementById('feedback-count-button');
    const trainButton = document.getElementById('train-model-button');
    const trainingStatus = document.getElementById('training-status');

    async function runUserAction(path, method = 'GET') {
        const user = auth.currentUser;
        if (!user) return;
        countButton.disabled = trainButton.disabled = true;
        trainingStatus.textContent = 'Loading…';
        try {
            const response = await fetch(`${API_BASE_URL}${path}`, {
                method,
                headers: { Authorization: `Bearer ${await user.getIdToken()}` }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Request failed.');
            if (auth.currentUser?.uid !== user.uid) return;
            if (path === '/feedback/count') {
                const count = Number.isInteger(data.limit) ? `${data.count} of ${data.limit}` : data.count;
                trainingStatus.textContent = `${count} feedback posts saved.`;
            } else {
                trainingStatus.textContent = 'Training submitted. Your personal model will be used when training succeeds.';
                if (data.log_url || data.build_id) {
                    const link = document.createElement('a');
                    link.href = data.log_url || `https://console.cloud.google.com/cloud-build/builds;region=europe-west1/${encodeURIComponent(data.build_id)}?project=linkedin-training-512914`;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = ' View build';
                    trainingStatus.append(link);
                }
            }
        } catch (error) {
            if (auth.currentUser?.uid === user.uid) trainingStatus.textContent = error.message;
        } finally {
            countButton.disabled = trainButton.disabled = !auth.currentUser;
        }
    }

    countButton.addEventListener('click', () => { void runUserAction('/feedback/count'); });
    trainButton.addEventListener('click', () => { void runUserAction('/train', 'POST'); });

    return user => {
        countButton.disabled = trainButton.disabled = !user;
        trainingStatus.textContent = '';
    };
}

async function initializeSettings() {
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
        description.textContent = settings.filterMode === 'hide'
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

    document.getElementById('guide-button').addEventListener('click', async () => {
        try {
            await chrome.runtime.openOptionsPage();
        } catch (error) {
            console.error('[Low-Value Guard] Could not open guide:', error);
            showError('Could not open the guide. Please try again.');
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
}

document.addEventListener('DOMContentLoaded', () => {
    const updateTrainingUser = initializeTrainingActions();
    initializeAuthentication(updateTrainingUser);
    void initializeSettings();
});
