(() => {
    const FEEDBACK_SELECTOR = '.low-value-guard-feedback';

    function addButtons(post, text) {
        const actions = post.querySelector('[aria-label="Comment"]')?.parentElement;
        if (!actions || actions.querySelector(FEEDBACK_SELECTOR)) return;

        const controls = document.createElement('div');
        controls.className = 'low-value-guard-feedback';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', 'Rate this post');

        const status = document.createElement('span');
        status.className = 'low-value-guard-feedback-status';
        status.setAttribute('role', 'status');

        for (const [label, useful] of [['Useful', true], ['Not useful', false]]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'low-value-guard-feedback-button';
            button.dataset.useful = useful;
            button.setAttribute('aria-pressed', 'false');
            button.textContent = label;
            button.addEventListener('click', async () => {
                if (controls.dataset.submitting) return;
                controls.dataset.submitting = 'true';
                controls.querySelectorAll('button').forEach(item => {
                    item.disabled = true;
                    if (item.classList.contains('is-error')) {
                        item.classList.remove('is-error');
                        item.textContent = item.dataset.useful === 'true' ? 'Useful' : 'Not useful';
                    }
                });
                button.classList.add('is-pending');
                button.textContent = `${label}…`;
                status.textContent = `Saving ${label.toLowerCase()} feedback.`;

                try {
                    const result = await chrome.runtime.sendMessage({
                        type: 'saveFeedback',
                        text,
                        useful
                    });
                    if (result?.error) throw new Error(result.error);
                    if (result?.saved !== true) throw new Error('Invalid feedback response');

                    controls.querySelectorAll('button').forEach(item => {
                        item.classList.remove('is-selected');
                        item.setAttribute('aria-pressed', 'false');
                        item.textContent = item.dataset.useful === 'true' ? 'Useful' : 'Not useful';
                    });
                    button.textContent = `${label} ✓`;
                    button.classList.add('is-selected');
                    button.setAttribute('aria-pressed', 'true');
                    status.textContent = `Feedback saved as ${label.toLowerCase()}.`;
                } catch (error) {
                    console.error('[Low-Value Guard] Could not save feedback:', error);
                    button.classList.add('is-error');
                    button.textContent = `Retry ${label}`;
                    status.textContent = error.message || `Could not save ${label.toLowerCase()} feedback. Retry.`;
                } finally {
                    button.classList.remove('is-pending');
                    delete controls.dataset.submitting;
                    controls.querySelectorAll('button').forEach(item => { item.disabled = false; });
                }
            });
            controls.append(button);
        }

        controls.append(status);

        actions.append(controls);
    }

    function removeButtons(post) {
        post.querySelector(FEEDBACK_SELECTOR)?.remove();
    }

    globalThis.LowValueGuardFeedback = Object.freeze({ addButtons, removeButtons });
})();
