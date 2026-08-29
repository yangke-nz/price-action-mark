/**
 * Keyboard hints, written the way the reader's own platform writes them.
 *
 * The menu registers every accelerator as `CmdOrCtrl+…`, so a hint spelled
 * "Ctrl+Shift+M" is simply wrong half the time: macOS binds ⌘, and spells a
 * chord with symbols in a fixed order rather than words joined by plus signs.
 *
 * Read from the renderer's own environment rather than over the preload
 * bridge, for three reasons: it is the machine in front of the READER that
 * decides, the answer is needed synchronously to render a `title` (a promise
 * would flash the wrong hint first), and the artifact has no bridge to ask —
 * yet is read on Macs too.
 */

/** `navigator.platform` says the same thing and is deprecated; the user-agent
 *  string carries "Macintosh" on every Chromium build macOS ships. */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

const SYMBOL: Record<string, string> = {
  cmdorctrl: '⌘', cmd: '⌘', command: '⌘', ctrl: '⌘', control: '⌘',
  shift: '⇧', alt: '⌥', option: '⌥',
};

/** Apple orders modifiers ⌃⌥⇧⌘ however they were typed, so ⌘ lands LAST:
 *  Save As is ⇧⌘S, never ⌘⇧S. */
const ORDER = ['⌃', '⌥', '⇧', '⌘'];

/**
 * `accel('Ctrl+Shift+M')` → `'Ctrl+Shift+M'` on Windows and Linux,
 * `'⇧⌘M'` on macOS.
 */
export function accel(combo: string): string {
  if (!isMac) return combo;
  const parts = combo.split('+');
  const key = parts.pop() ?? '';
  const mods = parts
    .map((part) => SYMBOL[part.trim().toLowerCase()] ?? part)
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return mods.join('') + (key.length === 1 ? key.toUpperCase() : key);
}
