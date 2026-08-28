/** The build-time snapshot, typed without making TypeScript read 330 KB of
 *  literal JSON on every check. Vite resolves `$data` to the data/ directory. */
declare module '$data/es_data.json' {
  const dataset: import('../../../shared/types.ts').Dataset;
  export default dataset;
}

/** The verdicts exported from the desktop app and inlined at build time. It is
 *  read through `coerceStore`, so `unknown` is the honest type: a hand-edited
 *  or stale file must be validated, not trusted for having a declaration. */
declare module '$data/marks.json' {
  const marks: unknown;
  export default marks;
}
