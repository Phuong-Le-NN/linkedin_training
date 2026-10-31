// Serve the built extension with the same script restrictions as Manifest V3.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../app/client');
const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png'
};
createServer(async (request, response) => {
    const path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
    if (!path.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(path);
        response
            .writeHead(200, {
                'Content-Type': types[extname(path)] || 'application/octet-stream',
                'Content-Security-Policy': "script-src 'self'; object-src 'self'"
            })
            .end(body);
    } catch {
        response.writeHead(404).end();
    }
}).listen(4173, '127.0.0.1');
