/** The build-time snapshot, typed without making TypeScript read 330 KB of
 *  literal JSON on every check. Vite resolves `$data` to the data/ directory. */
declare module '$data/es_data.json' {
  const dataset: import('../../../shared/types.ts').Dataset;
  export default dataset;
}
