import type { DesktopApi } from '../shared/ipc.ts';

declare global {
  /** Set by both Vite configs. The renderer branches on it in exactly one
   *  place — lib/source.ts — so nothing else has to know where it is running. */
  const __TARGET__: 'electron' | 'artifact';

  interface Window {
    /** Present only under the Electron target; the artifact has no bridge. */
    desktop?: DesktopApi;
  }
}

export {};
