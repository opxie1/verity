import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the three separate entry points a Manifest V3 extension needs: the
 * side panel (a normal HTML page), the background service worker, and the
 * Gmail content script.
 *
 * Everything is bundled with no code splitting and no dynamic imports, because
 * the content security policy in the manifest allows `script-src 'self'` only
 * (PRD FR-014, 18.9).
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
        content: resolve(import.meta.dirname, 'src/content/index.ts'),
      },
      output: {
        // Stable names, since the manifest refers to them directly.
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // A content script cannot be an ES module, so it must be self-contained.
        inlineDynamicImports: false,
        manualChunks: undefined,
      },
    },
    target: 'chrome116',
    sourcemap: false,
  },
});
