import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { configureExtension } from './configure-extension.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = resolve(root, 'app/client');
const output = resolve(client, 'build');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const config = await configureExtension();

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

// Generate the local manifest so existing Chrome installations can keep app/client.
const manifest = JSON.parse(await readFile(resolve(client, 'manifest.template.json'), 'utf8'));
manifest.host_permissions.unshift(`${new URL(config.API_BASE_URL).origin}/*`);
await writeFile(resolve(client, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Keep a distribution copy as well; both manifests are generated and ignored.
const extension = resolve(root, 'dist/extension');
await rm(extension, { recursive: true, force: true });
await mkdir(extension, { recursive: true });
for (const entry of ['build', 'content', 'lib', 'icon.png']) {
    await cp(resolve(client, entry), resolve(extension, entry), {
        recursive: true
    });
}
await writeFile(resolve(extension, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Built extension in app/client/. Reload that directory in Chrome.');
