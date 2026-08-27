/**
 * Vertical maximize: full work-area height, width and horizontal position
 * untouched. Windows exposes this natively when you double-click a window's
 * top or bottom edge; there is no Electron API for it, so it is arithmetic
 * against the work area of whichever display the window is actually on.
 *
 * It toggles, like the OS gesture does. The pre-maximize geometry is
 * remembered per window so the second press puts it back where it was.
 */
import { screen, type BrowserWindow } from 'electron';

/** Weak, so a closed window's remembered geometry is not a leak. */
const previous = new WeakMap<BrowserWindow, { y: number; height: number }>();

/** DPI scaling makes the round-trip through setBounds land a pixel or two off,
 *  so "is it already full height" cannot be an equality test. */
const TOLERANCE_PX = 2;

export function isVerticallyMaximized(win: BrowserWindow): boolean {
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  return (
    Math.abs(bounds.y - area.y) <= TOLERANCE_PX &&
    Math.abs(bounds.height - area.height) <= TOLERANCE_PX
  );
}

/** Returns the state it left the window in, so a caller can report it. */
export function toggleVerticalMaximize(win: BrowserWindow): boolean {
  // A fully maximized window has no width worth preserving, and setBounds
  // fights the maximized state — drop out of it first.
  if (win.isMaximized()) win.unmaximize();

  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;

  if (isVerticallyMaximized(win)) {
    // Nothing remembered means this window opened full-height (a restored
    // session, or the OS placed it there), so fall back to a sane middle.
    const remembered = previous.get(win);
    const height = remembered?.height ?? Math.round(area.height * 0.8);
    const y = remembered?.y ?? area.y + Math.round((area.height - height) / 2);
    previous.delete(win);
    win.setBounds({ x: bounds.x, width: bounds.width, y, height });
    return false;
  }

  previous.set(win, { y: bounds.y, height: bounds.height });
  // x and width deliberately carried through unchanged: that is the whole
  // difference between this and a plain maximize.
  win.setBounds({ x: bounds.x, width: bounds.width, y: area.y, height: area.height });
  return true;
}
