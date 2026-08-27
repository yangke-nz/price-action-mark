import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Both build targets set Vite's root to src/renderer, so one config here
 * serves the desktop app and the artifact alike.
 *
 * `runes: true` is not the default — it makes the compiler reject the Svelte 4
 * store/reactive-statement syntax outright rather than silently accepting a
 * mix. This codebase is runes throughout and the two idioms interoperate
 * badly, so the error is worth having.
 */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
};
