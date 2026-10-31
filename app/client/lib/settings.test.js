import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSettings, updateSettings } from './settings.js';

function settingsWith(t, saved) {
    const previous = globalThis.chrome;
    globalThis.chrome = {
        storage: {
            sync: {
                get: async (defaults) => ({ ...defaults, ...saved }),
                set: async (changes) => Object.assign(saved, changes)
            }
        }
    };
    t.after(() => {
        globalThis.chrome = previous;
    });
    return { getSettings, updateSettings };
}

test('existing remove preferences continue to hide posts', async (t) => {
    const saved = { isEnabled: true, filterMode: 'remove' };
    const settings = settingsWith(t, saved);
    assert.equal((await settings.getSettings()).filterMode, 'hide');
    await settings.updateSettings({ filterMode: 'hide' });
    assert.equal(saved.filterMode, 'hide');
});

test('invalid stored settings fall back to paused blur mode', async (t) => {
    const settings = await settingsWith(t, {
        isEnabled: 'false',
        filterMode: 'invalid'
    }).getSettings();
    assert.equal(settings.isEnabled, false);
    assert.equal(settings.filterMode, 'blur');
});
