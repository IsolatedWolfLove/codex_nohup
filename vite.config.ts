import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Bundle PDF fonts/decoders with the app so previews work without a CDN.
const pdfDirectories = ['cmaps', 'standard_fonts', 'wasm'];
const pdfRoot = resolve('node_modules/pdfjs-dist');

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), {
    name: 'local-pdf-assets',
    async writeBundle(options) {
      if (!options.dir) return;
      await Promise.all(pdfDirectories.map(dir => cp(resolve(pdfRoot, dir), resolve(options.dir!, 'pdfjs', dir), { recursive: true })));
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (request, response, next) => {
        const parts = (request.url ?? '').split('?')[0].split('/').filter(Boolean);
        if (parts.length !== 2 || !pdfDirectories.includes(parts[0]) || !/^[\w.-]+$/.test(parts[1]) || parts[1].includes('..')) { next(); return; }
        void readFile(resolve(pdfRoot, ...parts)).then(data => {
          response.setHeader('Content-Type', parts[1].endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          response.end(data);
        }).catch(next);
      });
    },
  }],
  base: './',
  build: { outDir: '../../out/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
