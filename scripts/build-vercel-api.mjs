import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const apiDir = path.join(rootDir, 'api');

fs.mkdirSync(apiDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, 'server', 'vercel-handler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
  outfile: path.join(apiDir, 'index.mjs'),
  banner: {
    js: '/* Bundled for Vercel Node 22 Serverless Runtime via npm run build (source: server/vercel-handler.ts) */',
  },
});
