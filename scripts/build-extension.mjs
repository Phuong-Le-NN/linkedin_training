import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rolldown } from 'rolldown';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = resolve(root, 'app/client');
const output = resolve(client, 'build');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// Angular compiles templates ahead of time: extension CSP does not allow JIT/eval.
execFileSync(
    process.execPath,
    [resolve(root, 'node_modules/@angular/cli/bin/ng.js'), 'build', 'popup'],
    {
        cwd: root,
        stdio: 'inherit'
    }
);

for (const [name, source, format] of [
    ['service_worker', 'background/service_worker.js', 'esm'],
    ['content', 'content/main.js', 'iife']
]) {
    const bundle = await rolldown({ input: resolve(client, source) });
    try {
        await bundle.write({ file: resolve(output, `${name}.js`), format });
    } finally {
        await bundle.close();
    }
}

console.log('Built Angular/Tailwind popup and Firebase service worker in app/client/build/');
