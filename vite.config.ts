import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import type {ServerResponse} from 'http';
import path from 'path';
import {defineConfig, type ProxyOptions} from 'vite';

export default defineConfig(() => {
  const apiProxyConfig: Record<string, string | ProxyOptions> = {
    '/api': {
      target: `http://127.0.0.1:${process.env.PORT || 3000}`,
      changeOrigin: true,
      configure(proxy) {
        proxy.on('error', (_err, _req, res) => {
          const httpRes = res as ServerResponse | undefined;
          if (httpRes && typeof httpRes.writeHead === 'function' && !httpRes.headersSent) {
            httpRes.writeHead(502, { 'Content-Type': 'application/json' });
            httpRes.end(
              JSON.stringify({
                success: false,
                code: 'BACKEND_UNAVAILABLE',
                error: {
                  code: 'BACKEND_UNAVAILABLE',
                  message:
                    'Express backend is not reachable on port 3000. Run "npm run dev" to start the integrated Express + Vite server.',
                },
              })
            );
          }
        });
      },
    },
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // Proxy /api to Express on port 3000 when running Vite standalone
      proxy: apiProxyConfig,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      proxy: apiProxyConfig,
    },
  };
});
