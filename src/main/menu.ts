/** Native menu. Every item sends a `Command` down the same channel the
 *  renderer already listens on, so the menu and the in-page controls drive
 *  exactly one code path instead of two that drift. */
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { toggleVerticalMaximize } from './window.ts';
import { CH, type Command } from '../shared/ipc.ts';
import type { RangeId, Settings } from '../shared/types.ts';
import { RULES } from '../shared/marks/registry.ts';

const RANGES: RangeId[] = ['1M', '3M', '6M', '1Y', '5Y', 'MAX'];
const isMac = process.platform === 'darwin';

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
      label: '&File',
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
      label: '&View',
      submenu: [
        {
          label: 'Range',
          submenu: RANGES.map((id) => ({
            label: id,
            type: 'radio' as const,
            checked: settings.range === id,
            accelerator: id === 'MAX' ? 'CmdOrCtrl+0' : `CmdOrCtrl+${RANGES.indexOf(id) + 1}`,
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
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: '&Help',
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
