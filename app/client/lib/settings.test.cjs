const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

function settingsWith(saved) {
    const context = vm.createContext({
        chrome: { storage: { sync: {
            get: async defaults => ({ ...defaults, ...saved }),
            set: async changes => Object.assign(saved, changes)
        } } }
    });
    vm.runInContext(readFileSync(`${__dirname}/settings.js`, 'utf8'), context);
    return context.LowValueGuardSettings;
}

test('existing remove preferences continue to hide posts', async () => {
    const saved = { isEnabled: true, filterMode: 'remove' };
    const settings = settingsWith(saved);
    assert.equal((await settings.getSettings()).filterMode, 'hide');
    await settings.updateSettings({ filterMode: 'hide' });
    assert.equal(saved.filterMode, 'hide');
});

test('invalid stored settings fall back to paused blur mode', async () => {
    const settings = await settingsWith({ isEnabled: 'false', filterMode: 'invalid' }).getSettings();
    assert.equal(settings.isEnabled, false);
    assert.equal(settings.filterMode, 'blur');
});
