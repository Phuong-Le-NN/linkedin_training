(() => {
    const FEEDBACK_SELECTOR = '.low-value-guard-feedback';

    function addButtons(post, text) {
        const actions = post.querySelector('[aria-label="Comment"]')?.parentElement;
        if (!actions || actions.querySelector(FEEDBACK_SELECTOR)) return;

        const controls = document.createElement('div');
        controls.className = 'low-value-guard-feedback';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', 'Rate this post');

        for (const [label, useful] of [['Useful', true], ['Not useful', false]]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'low-value-guard-feedback-button';
            button.dataset.useful = useful;
            button.setAttribute('aria-pressed', 'false');
            button.textContent = label;
            button.addEventListener('click', async () => {
                const result = await chrome.runtime.sendMessage({
                    type: 'saveFeedback',
                    text,
                    useful
                });

                if (result?.error) {
                    console.error('[Low-Value Guard] Could not save feedback:', result.error);
                    return;
                }

                button.textContent = `${label} ✓`;
                button.classList.add('is-selected');
                button.setAttribute('aria-pressed', 'true');
                controls.querySelectorAll('button').forEach(item => {
                    item.disabled = true;
                });
            });
            controls.append(button);
        }

        actions.append(controls);
    }

    function removeButtons(post) {
        post.querySelector(FEEDBACK_SELECTOR)?.remove();
    }

    globalThis.LowValueGuardFeedback = Object.freeze({ addButtons, removeButtons });
})();
