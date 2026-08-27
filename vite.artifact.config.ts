/** Build target 2 of 2: one self-contained HTML file.
 *
 *  Vite emits a normal bundle here; scripts/inline-artifact.ts then folds the
 *  JS and the CSS into a single document and strips the wrapper tags that the
 *  artifact host supplies itself. Everything is forced inline -- no code
 *  splitting, no sibling asset files -- so that step has exactly one script
 *  and one stylesheet to deal with.
 */
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: at('src/renderer'),
  base: './',
  resolve: {
    alias: {
      $lib: at('src/renderer/lib'),
      $shared: at('src/shared'),
      $source: at('src/renderer/lib/source/artifact.ts'),
      // The dataset is imported by source/artifact.ts and bundled at build
      // time; this target has no host to ask for it at runtime.
      $data: at('data'),
    },
  },
  plugins: [svelte()],
  // Emit the dataset as JSON.parse("...") rather than a 330 KB object literal.
  // The engine parses it several times faster that way.
  json: { stringify: true },
  define: { __TARGET__: JSON.stringify('artifact') },
  build: {
    outDir: at('dist-artifact'),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    sourcemap: false,
    // Fonts become data: URIs rather than sibling files. That is what makes
    // the artifact typographically identical to the desktop app while still
    // loading nothing from a remote host.
    assetsInlineLimit: 8 * 1024 * 1024,
    reportCompressedSize: false,
    // One file is the whole point of this target, so the split-your-chunks
    // advice does not apply. The bundle is ~330 KB of dataset plus the chart
    // library, both of which have to be in there.
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: at('src/renderer/index.html'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'artifact.js',
        assetFileNames: 'artifact.[ext]',
      },
    },
  },
});
