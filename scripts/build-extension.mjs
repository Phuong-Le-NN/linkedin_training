import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rolldown } from 'rolldown';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = resolve(root, 'app/client');
const output = resolve(client, 'build');
await mkdir(output, { recursive: true });
execFileSync(process.execPath, [resolve(root, 'node_modules/@angular/cli/bin/ng.js'), 'build', 'popup'], { cwd: root, stdio: 'inherit' });
const bundle = await rolldown({ input: resolve(client, 'background/service_worker.js') });
try {
    await bundle.write({ file: resolve(output, 'service_worker.js'), format: 'esm' });
} finally {
    await bundle.close();
}
