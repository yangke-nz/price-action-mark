/**
 * Build target 2, second half: fold the Vite output into one HTML file.
 *
 * Writes two files from the same pieces:
 *
 *   dist/price_action_mark.html   the artifact BODY — no <!doctype>, <html>, <head> or
 *                       <body>, because the artifact host wraps it in that
 *                       skeleton at publish time. Emitting our own would nest
 *                       a second document inside the first.
 *   dist/preview.html   the same content plus the skeleton, so it opens
 *                       straight off disk.
 *
 * The guards at the bottom are the point of this script. A published artifact
 * runs under a CSP that admits no remote origin, so anything left un-inlined
 * — a sibling .js, a font URL, a stray asset — does not degrade, it silently
 * fails to load. Every one of those is a build error here instead.
 */
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const IN = fileURLToPath(new URL('../dist-artifact/', import.meta.url));
const OUT = fileURLToPath(new URL('../dist/', import.meta.url));

/** The publishable body. Named for the product, not the instrument — the page
 *  charts whatever data/ holds. */
const ARTIFACT_FILE = 'price_action_mark.html';

const WRAPPER = /<!doctype|<html[\s>]|<\/html>|<head[\s>]|<\/head>|<body[\s>]|<\/body>/i;
const EXPECTED = new Set(['index.html', 'artifact.js', 'artifact.css']);

function die(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

const kb = (s: string): string => `${Math.round(Buffer.byteLength(s, 'utf8') / 1024)} KB`;

// ---- read what Vite produced -------------------------------------------

const produced = await readdir(IN).catch(() =>
  die('dist-artifact/ is missing — run `vite build --config vite.artifact.config.ts` first'),
);

// Anything beyond the three expected files means an asset escaped inlining and
// would 404 inside the single file.
const strays = produced.filter((f) => !EXPECTED.has(f));
if (strays.length > 0) {
  die(
    `Vite emitted sibling assets that cannot travel inside one file: ${strays.join(', ')}\n` +
      '       raise build.assetsInlineLimit in vite.artifact.config.ts',
  );
}

const html = await readFile(IN + 'index.html', 'utf8');
const js = await readFile(IN + 'artifact.js', 'utf8');
const css = await readFile(IN + 'artifact.css', 'utf8');

// ---- take the document apart -------------------------------------------

const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? 'Price Action Mark';

const bodyInner = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
if (bodyInner === undefined) die('no <body> in the Vite output — the HTML plugin changed shape');

// Drop the tags that pointed at the sibling files; their contents are inlined
// below. Everything else in the body is ours and is kept verbatim.
const markup = bodyInner
  .replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/gi, '')
  .replace(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, '')
  .trim();

if (markup.length === 0) die('nothing left in <body> after removing the asset tags');

// ---- make the payloads safe to inline ----------------------------------

// Two byte sequences can end a <script> element from the inside, and both turn
// up in minified bundles as ordinary string literals -- Svelte's runtime
// carries "<!---->" as its comment-anchor marker.
//
//   </script   closes the tag wherever it appears, string literal or not.
//   <!--       puts the HTML tokenizer into script-data-escaped state, where
//              a following <script would make </script stop closing the tag.
//
// A backslash before the "/" or the "!" is inert inside a JS string and
// invisible to the HTML tokenizer, so the substitution is lossless. It would
// break a bare Annex B "<!--" line comment, which no minifier emits -- and the
// compile check below is what proves that assumption held for this bundle.
const safeJs = js
  .replace(/<\/script/gi, String.raw`<\/script`)
  .replace(/<!--/g, String.raw`<\!--`);

if (/<\/script/i.test(safeJs) || /<!--/.test(safeJs)) {
  die('escaping did not neutralise every script-terminating sequence');
}

// Compiling the escaped source proves the substitutions landed inside string
// literals rather than in live code. The function is never called.
try {
  new Function(safeJs);
} catch (err) {
  die(`escaping broke the JS bundle: ${(err as Error).message}`);
}

if (/<\/style/i.test(css)) {
  die('the CSS bundle contains "</style", which would close the tag early');
}

const styleTag = `<style>\n${css}\n</style>`;
const scriptTag = `<script>\n${safeJs}\n</script>`;

// ---- compose both outputs ----------------------------------------------

const artifact = [`<title>${title}</title>`, styleTag, markup, scriptTag].join('\n');

const preview = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  `<title>${title}</title>`,
  styleTag,
  '</head>',
  '<body>',
  markup,
  scriptTag,
  '</body>',
  '</html>',
].join('\n');

// ---- guards ------------------------------------------------------------

const offender = artifact.match(WRAPPER);
if (offender) die(`the artifact body still contains a wrapper tag: ${offender[0]}`);

// A remote or relative resource is not merely slow here: the publish CSP
// admits no external origin, and there is no sibling file for a relative path
// to resolve to, so the page would load without its fonts or its chart and say
// nothing about it. Anchor hrefs are exempt -- those are navigation, not a
// fetch, and the footer credit is meant to be clickable.
const RESOURCE_ATTR = /\b(?:src|srcset|poster|data|formaction)\s*=\s*["']([^"']*)/gi;
const LINK_HREF = /<link\b[^>]*\bhref\s*=\s*["']([^"']*)/gi;

function offenders(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)]
    .map((m) => m[1] ?? '')
    .filter((value) => value !== '' && !value.startsWith('data:') && !value.startsWith('#'));
}

const external = [...offenders(markup, RESOURCE_ATTR), ...offenders(markup, LINK_HREF)];
if (external.length > 0) {
  die(`the artifact would try to load: ${external.join(', ')}\n       nothing may travel outside the file`);
}

// Same rule for the stylesheet: every font and image has to be a data: URI.
const cssRefs = [...css.matchAll(/url\(\s*["']?([^"')]+)/gi)]
  .map((m) => m[1] ?? '')
  .filter((value) => !value.startsWith('data:'));
if (cssRefs.length > 0) {
  die(`the stylesheet still points at files: ${cssRefs.join(', ')}\n       raise build.assetsInlineLimit in vite.artifact.config.ts`);
}

if (!/id=["']app["']/.test(artifact)) die('the mount point #app is missing from the output');

// ---- write --------------------------------------------------------------

await mkdir(OUT, { recursive: true });
await writeFile(OUT + ARTIFACT_FILE, artifact, 'utf8');
await writeFile(OUT + 'preview.html', preview, 'utf8');

const dataBytes = /JSON\.parse\("/.test(js) ? 'dataset inlined as JSON.parse' : 'dataset inlined';
const { size } = await stat(OUT + ARTIFACT_FILE);

process.stdout.write(
  `inlined  css ${kb(css)}  js ${kb(js)}  (${dataBytes})\n` +
    `built ${OUT}${ARTIFACT_FILE}  (${Math.round(size / 1024)} KB) — the artifact body\n` +
    `built ${OUT}preview.html  — open this one in a browser\n`,
);
