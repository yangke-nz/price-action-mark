/** Build target 1 of 2: the Electron desktop app.
 *  Target 2 is vite.artifact.config.ts, which builds the same renderer into a
 *  single self-contained HTML file. Both share every line of src/renderer. */
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: at('src/main/index.ts') },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: at('src/preload/index.ts'),
        // A sandboxed preload cannot be an ES module, and package.json says
        // "type": "module" -- hence CommonJS emitted under an explicit .cjs.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },

  renderer: {
    root: at('src/renderer'),
    resolve: {
      alias: {
        $lib: at('src/renderer/lib'),
        $shared: at('src/shared'),
        // The seam that lets one renderer serve two targets. See source/types.ts.
        $source: at('src/renderer/lib/source/electron.ts'),
      },
    },
    plugins: [svelte()],
    define: { __TARGET__: JSON.stringify('electron') },
    build: {
      target: 'chrome138',
      rollupOptions: { input: at('src/renderer/index.html') },
      sourcemap: true,
    },
  },
});
