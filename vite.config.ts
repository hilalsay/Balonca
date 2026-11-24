import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/** Vite dev injects <style> tags and an HMR websocket, which the strict production CSP forbids. */
const devWithoutCsp = (): Plugin => ({
  name: 'dev-without-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''),
});

export default defineConfig({
  plugins: [svelte(), devWithoutCsp()],
  // `npm run api` serves the subtitle service on 8787; locally it is reached through the same /api path as in production.
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    target: 'es2022', sourcemap: false,
    // The PDF.js worker ships as .mjs, which older web servers (nginx 1.18) do not serve as JavaScript: publish it as .js.
    rollupOptions: { output: { assetFileNames: (a) => (a.names?.[0] ?? a.name ?? '').endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]' } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.mjs', 'scripts/**/*.test.mjs'] },
});
