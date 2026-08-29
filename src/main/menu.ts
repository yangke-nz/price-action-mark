/** Native menu. Every item sends a `Command` down the same channel the
 *  renderer already listens on, so the menu and the in-page controls drive
 *  exactly one code path instead of two that drift. */
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { toggleLeftMaximize, toggleVerticalMaximize } from './window.ts';
import { CH, type Command } from '../shared/ipc.ts';
import type { RangeId, Settings } from '../shared/types.ts';
import { INTERVAL_IDS, INTERVALS } from '../shared/interval.ts';
import { SESSIONS, SESSION_IDS } from '../shared/session.ts';
import { RULES } from '../shared/marks/registry.ts';

/** The presets for the timeframe the window is on. Offering all of them would
 *  put a 5-year item on a menu for a 60-day archive. */
function rangesFor(settings: Settings): RangeId[] {
  return [...INTERVALS[settings.interval].ranges];
}
const isMac = process.platform === 'darwin';

/**
 * A top-level label, with its Alt mnemonic.
 *
 * `&` marks the accelerated letter on Windows and Linux, where Electron strips
 * the marker and underlines the letter after it. macOS has no mnemonics at all
 * and does no stripping, so the menu bar reads a literal "&File" — the one
 * platform difference in this file that is invisible from the other side.
 * `&&` is Electron's escape for a real ampersand, so it collapses to one here
 * rather than vanishing.
 */
function mnemonic(label: string): string {
  return isMac ? label.replace(/&(&?)/g, '$1') : label;
}

function send(command: Command): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send(CH.command, command);
}

export function buildMenu(settings: Settings): void {
  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [{ role: 'appMenu' }]
    : [];

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: mnemonic('&File'),
      submenu: [
        {
          label: 'Refresh data',
          accelerator: 'CmdOrCtrl+R',
          click: () => send({ kind: 'refresh' }),
        },
        { type: 'separator' },
        {
          label: 'Export CSV…',
          accelerator: 'CmdOrCtrl+E',
          click: () => send({ kind: 'export', value: 'csv' }),
        },
        {
          label: 'Export JSON…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send({ kind: 'export', value: 'json' }),
        },
        {
          label: 'Export marks…',
          click: () => send({ kind: 'export', value: 'marks' }),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: mnemonic('&View'),
      submenu: [
        {
          label: 'Timeframe',
          submenu: INTERVAL_IDS.map((id) => ({
            label: INTERVALS[id].label,
            type: 'radio' as const,
            checked: settings.interval === id,
            click: () => send({ kind: 'interval', value: id }),
          })),
        },
        {
          label: 'Session',
          // Always enabled, and it used to be greyed out on a daily interval.
          // That was right when RTH meant "filter the intraday bars in hand" —
          // and the session window now reaches the DAILY chart too, where those
          // bars are aggregated out of the 5-minute feed instead. The in-page
          // control had already learned this (`app.sessionApplies` is
          // `intraday || can.timeframes`), so a menu that stayed greyed made
          // the two disagree about a shipped feature — the exact drift this
          // file exists to prevent, since a menu item and a button are supposed
          // to be one code path. Main is the desktop target, where
          // `can.timeframes` is true by construction, so the answer here is
          // simply "always".
          submenu: SESSION_IDS.map((id) => ({
            label: `${SESSIONS[id].label} — ${SESSIONS[id].title.split(' — ')[1] ?? ''}`.trim(),
            type: 'radio' as const,
            checked: settings.session === id,
            click: () => send({ kind: 'session', value: id }),
          })),
        },
        {
          label: 'Range',
          submenu: rangesFor(settings).map((id, i) => ({
            label: id,
            type: 'radio' as const,
            checked: settings.range === id,
            // Numbered by POSITION in this interval's list, so Ctrl+1 is always
            // the shortest range offered rather than a preset that may not be
            // on the menu at all.
            accelerator: id === 'MAX' ? 'CmdOrCtrl+0' : `CmdOrCtrl+${i + 1}`,
            click: () => send({ kind: 'range', value: id }),
          })),
        },
        {
          label: 'Theme',
          submenu: (['system', 'light', 'dark'] as const).map((value) => ({
            label: value[0]!.toUpperCase() + value.slice(1),
            type: 'radio' as const,
            checked: settings.theme === value,
            click: () => send({ kind: 'theme', value }),
          })),
        },
        { type: 'separator' },
        {
          label: 'Contract rolls',
          type: 'checkbox',
          checked: settings.showRolls,
          click: () => send({ kind: 'toggle', value: 'rolls' }),
        },
        {
          label: 'EMA 20',
          type: 'checkbox',
          checked: settings.showEma,
          click: () => send({ kind: 'toggle', value: 'ema' }),
        },
        {
          label: 'Marks',
          submenu: [
            {
              label: 'Show marks',
              type: 'checkbox',
              checked: settings.marks.enabled,
              click: () => send({ kind: 'mark', value: '*' }),
            },
            {
              // Display only, and it says so by sitting with `Show marks`
              // rather than with the rules: an entry is on the chart either
              // way, with or without the two prices that bound it.
              label: 'Stop & target',
              type: 'checkbox',
              enabled: settings.marks.enabled,
              checked: settings.marks.stopTarget,
              click: () => send({ kind: 'toggle', value: 'stop-target' }),
            },
            {
              // The second door to the sheet. No accelerator: this is a
              // set-once dialog, and Ctrl+R/E/K/0-9 and Ctrl+Shift+E/M are
              // taken by things a reader uses every session.
              label: 'Choose folded rules…',
              enabled: settings.marks.enabled,
              click: () => send({ kind: 'rules' }),
            },
            { type: 'separator' },
            // Built from the registry, so a new rule appears here without
            // this file being touched.
            ...RULES.map((rule) => ({
              label: rule.label,
              type: 'checkbox' as const,
              enabled: settings.marks.enabled,
              checked: settings.marks.rules[rule.id] ?? rule.defaultOn,
              click: () => send({ kind: 'mark', value: rule.id }),
            })),
          ],
        },
        { type: 'separator' },
        { label: 'Focus chart', accelerator: 'CmdOrCtrl+K', click: () => send({ kind: 'focus-chart' }) },
        {
          // Window geometry is main's own business, so unlike every other item
          // here this one acts directly instead of sending a command down to
          // the renderer and back.
          label: 'Maximize vertically',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            if (win) toggleVerticalMaximize(win);
          },
        },
        {
          // Window geometry is main's business too, so this acts directly for
          // the same reason its sibling above does.
          label: 'Extend to left edge',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            if (win) toggleLeftMaximize(win);
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: mnemonic('&Help'),
      submenu: [
        {
          label: 'Lightweight Charts (TradingView)',
          click: () => void shell.openExternal('https://github.com/tradingview/lightweight-charts'),
        },
        {
          label: 'Yahoo v8 chart endpoint',
          click: () => void shell.openExternal('https://query1.finance.yahoo.com/v8/finance/chart/ES=F'),
        },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
