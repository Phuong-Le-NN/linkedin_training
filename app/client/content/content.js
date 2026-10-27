const POST_SELECTOR = '[role="listitem"][componentkey^="update-card-focus"]';
const TEXT_SELECTOR = '[data-testid="expandable-text-box"]';
const OVERLAY_SELECTOR = '.low-value-guard-overlay';
const MAX_CLASSIFICATION_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const DEBUG = false;

// Per-element processing state, not a cache of reusable predictions.
const postStates = new WeakMap();
const filterCleanups = new WeakMap();
let postObserver;
let classificationEnabled = false;

function debug(...args) {
    if (DEBUG) console.debug('[Low-Value Guard]', ...args);
}

function extensionAvailable() {
    try {
        if (chrome.runtime?.id) return true;
    } catch {
        // Reloading the extension invalidates existing content scripts.
    }
    postObserver?.disconnect();
    return false;
}

function readPostText(post) {
    const element = post.querySelector(TEXT_SELECTOR);
    return (element?.innerText || element?.textContent || '').trim();
}

function isPromotedPost(post) {
    const actor = post.querySelector('.update-components-actor__container');
    return ['description', 'sub-description'].some(field => {
        const text = actor?.querySelector(
            `.update-components-actor__${field} span[aria-hidden="true"]`
        )?.textContent || '';
        return text.toLowerCase().includes('promoted');
    });
}

function clearPostFilter(post) {
    const cleanup = filterCleanups.get(post);
    filterCleanups.delete(post);
    cleanup?.();
}

function blurPostWithButton(container) {
    const originalPosition = container.style.position;
    const needsPosition = getComputedStyle(container).position === 'static';
    if (needsPosition) container.style.position = 'relative';

    const overlay = document.createElement('div');
    overlay.className = 'low-value-guard-overlay';
    const button = document.createElement('button');
    button.className = 'low-value-guard-reveal';
    button.type = 'button';
    button.textContent = 'Show post';

    const originalInertStates = new Map();
    function disableChild(child) {
        if (!(child instanceof HTMLElement) || child === overlay) return;
        if (!originalInertStates.has(child)) {
            originalInertStates.set(child, child.inert);
        }
        child.inert = true;
    }
    function restoreChild(child) {
        if (!originalInertStates.has(child)) return;
        child.inert = originalInertStates.get(child);
        originalInertStates.delete(child);
    }

    Array.from(container.children).forEach(disableChild);
    const observer = new MutationObserver(records => {
        for (const record of records) {
            record.addedNodes.forEach(disableChild);
            // Do not leave a node inert if LinkedIn moves it elsewhere.
            record.removedNodes.forEach(child => {
                if (child.parentElement !== container) restoreChild(child);
            });
        }
    });
    observer.observe(container, { childList: true });

    // Preserve the button's native focus and Enter/Space behavior.
    for (const type of [
        'pointerdown', 'pointerup', 'mousedown', 'mouseup',
        'dblclick', 'contextmenu', 'keydown', 'keyup'
    ]) {
        overlay.addEventListener(type, event => event.stopPropagation());
    }
    overlay.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (button.contains(event.target)) clearPostFilter(container);
    });
    overlay.appendChild(button);
    // Keep LinkedIn's existing nodes in place.
    container.appendChild(overlay);

    return () => {
        observer.disconnect();
        for (const child of originalInertStates.keys()) restoreChild(child);
        overlay.remove();
        if (needsPosition) container.style.position = originalPosition;
    };
}

function applyPostFilter(post, mode) {
    clearPostFilter(post);
    if (mode === 'remove') {
        const originalDisplay = post.style.display;
        post.style.display = 'none';
        filterCleanups.set(post, () => { post.style.display = originalDisplay; });
    } else {
        filterCleanups.set(post, blurPostWithButton(post));
    }
    debug('Applied filter', { mode });
}

async function requestClassification(text) {
    const result = await chrome.runtime.sendMessage({
        type: 'classifyPost',
        text
    });
    if (result?.error) throw new Error(result.error);
    if (!['useful', 'useless'].includes(result?.label)) {
        throw new Error('Invalid classification response');
    }
    return result.label === 'useless';
}

function isCurrentRequest(post, state) {
    return extensionAvailable() && post.isConnected && postStates.get(post) === state;
}

async function classifyPost(post, state) {
    if (!isCurrentRequest(post, state)) return;
    if (readPostText(post) !== state.text) {
        processPost(post);
        return;
    }
    state.attempts++;
    try {
        const isLowValue = isPromotedPost(post) || await requestClassification(state.text);
        if (!isCurrentRequest(post, state)) return;
        const settings = await LowValueGuardSettings.getSettings();
        if (!isCurrentRequest(post, state)) return;
        if (readPostText(post) !== state.text) {
            processPost(post);
            return;
        }
        if (settings.isEnabled && isLowValue) {
            applyPostFilter(post, settings.filterMode);
        }
        debug('Post processed', { isLowValue });
    } catch (error) {
        if (!isCurrentRequest(post, state)) return;
        if (readPostText(post) !== state.text) {
            processPost(post);
            return;
        }
        console.error('[Low-Value Guard] Could not process post:', error);
        if (state.attempts <= MAX_CLASSIFICATION_RETRIES) {
            state.retryTimer = setTimeout(() => {
                state.retryTimer = null;
                void classifyPost(post, state);
            }, RETRY_DELAY_MS * state.attempts);
        }
    }
}

function processPost(post) {
    if (!extensionAvailable() || !post.isConnected) return;
    const text = readPostText(post);
    const previous = postStates.get(post);
    if (previous?.text === text) {
        LowValueGuardFeedback.addButtons(post, text);
        return;
    }

    // A recycled or edited post gets fresh processing state.
    clearTimeout(previous?.retryTimer);
    clearPostFilter(post);
    LowValueGuardFeedback.removeButtons(post);
    if (!text) {
        postStates.delete(post);
        return;
    }
    LowValueGuardFeedback.addButtons(post, text);
    const state = { text, attempts: 0, retryTimer: null };
    postStates.set(post, state);
    if (classificationEnabled) void classifyPost(post, state);
}

function scanExistingPosts() {
    document.querySelectorAll(POST_SELECTOR).forEach(processPost);
}

function collectPosts(node, posts) {
    const element = node instanceof Element ? node : node.parentElement;
    if (!element || element.closest(OVERLAY_SELECTOR)) return;
    const containingPost = element.closest(POST_SELECTOR);
    if (containingPost) posts.add(containingPost);
    element.querySelectorAll(POST_SELECTOR).forEach(post => posts.add(post));
}

function releasePost(post) {
    clearTimeout(postStates.get(post)?.retryTimer);
    postStates.delete(post);
    clearPostFilter(post);
}

function observeNewPosts() {
    postObserver = new MutationObserver(mutations => {
        if (!extensionAvailable()) return;
        const posts = new Set();
        const removedPosts = new Set();
        for (const mutation of mutations) {
            // The target also catches text updates and removed content.
            const element = mutation.target instanceof Element
                ? mutation.target : mutation.target.parentElement;
            if (element && !element.closest(OVERLAY_SELECTOR)) {
                const containingPost = element.closest(POST_SELECTOR);
                if (containingPost) posts.add(containingPost);
            }
            mutation.addedNodes.forEach(node => collectPosts(node, posts));
            mutation.removedNodes.forEach(node => collectPosts(node, removedPosts));
        }
        removedPosts.forEach(post => {
            if (!post.isConnected) releasePost(post);
        });
        posts.forEach(processPost);
    });
    postObserver.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
    });
}

async function initExtension() {
    if (!extensionAvailable()) return;
    try {
        const settings = await LowValueGuardSettings.getSettings();
        classificationEnabled = settings.isEnabled;
        observeNewPosts();
        scanExistingPosts();
        debug('Content script initialized');
    } catch (error) {
        console.error('[Low-Value Guard] Initialization failed:', error);
    }
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.isEnabled || changes.filterMode)) {
        window.location.reload();
    }
});

void initExtension();
