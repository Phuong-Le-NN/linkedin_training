import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rolldown } from 'rolldown';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = resolve(root, 'app/client');
const output = resolve(client, 'build');
await mkdir(output, { recursive: true });

for (const [name, source] of [
    ['popup', 'popup/popup.js'],
    ['service_worker', 'background/service_worker.js']
]) {
    const bundle = await rolldown({ input: resolve(client, source) });
    try {
        await bundle.write({ file: resolve(output, `${name}.js`), format: 'esm' });
    } finally {
        await bundle.close();
    }
}

console.log('Built Firebase-enabled extension scripts in app/client/build/');
