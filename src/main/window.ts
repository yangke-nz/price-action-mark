/**
 * Two window gestures the OS does not expose to Electron, both arithmetic
 * against the work area of whichever display the window is actually on.
 *
 * VERTICAL MAXIMIZE takes the full work-area height and leaves width and x
 * alone — Windows does this natively when you double-click a window's top or
 * bottom edge.
 *
 * EXTEND LEFT moves the LEFT edge to the work area's left and leaves the right
 * edge exactly where it is. That asymmetry is the point: it widens the chart
 * into empty desktop without walking over whatever is parked on the right, and
 * it is not "maximize", which would take both edges.
 *
 * Both toggle, and both remember the geometry they replaced, per window, so
 * the second press puts it back.
 */
import { screen, type BrowserWindow } from 'electron';

/** Weak, so a closed window's remembered geometry is not a leak. Two maps
 *  rather than one record: the gestures are independent, and a window can be
 *  full-height AND extended left at once. */
const previous = new WeakMap<BrowserWindow, { y: number; height: number }>();
const previousWide = new WeakMap<BrowserWindow, { x: number; width: number }>();

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

export function isLeftMaximized(win: BrowserWindow): boolean {
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  return Math.abs(bounds.x - area.x) <= TOLERANCE_PX;
}

/** Returns the state it left the window in, so a caller can report it. */
export function toggleLeftMaximize(win: BrowserWindow): boolean {
  if (win.isMaximized()) win.unmaximize();

  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;

  if (isLeftMaximized(win)) {
    // Nothing remembered means the window was already against the left edge
    // when it opened, so put it back to a sane middle rather than leaving the
    // press doing nothing.
    const remembered = previousWide.get(win);
    const width = remembered?.width ?? Math.round(area.width * 0.8);
    const x = remembered?.x ?? area.x + Math.round((area.width - width) / 2);
    previousWide.delete(win);
    win.setBounds({ y: bounds.y, height: bounds.height, x, width });
    return false;
  }

  previousWide.set(win, { x: bounds.x, width: bounds.width });
  // The RIGHT edge is what stays put — the window grows leftwards rather than
  // moving, which is the whole difference between this and a slide to the edge.
  const right = bounds.x + bounds.width;
  win.setBounds({ y: bounds.y, height: bounds.height, x: area.x, width: right - area.x });
  return true;
}
