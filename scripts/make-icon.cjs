/**
 * resources/icon.svg  ->  resources/icon.png (1024) + resources/icon.icns
 *
 * Run with `npm run icon`. electron-builder picks both up out of
 * `buildResources` automatically; the .ico for Windows it generates from the
 * PNG itself, so there is nothing here to make one.
 *
 * Rasterised by the Chromium that is already a devDependency rather than by
 * adding an image library: the SVG is drawn into a canvas and read back as a
 * PNG, so alpha survives and there is no dependency to keep current. A window
 * is needed because that is where a canvas lives, but nothing is ever shown.
 *
 * CommonJS on purpose: this is an Electron main entry, not part of the bundle.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

// ELECTRON_RUN_AS_NODE makes the same binary behave as plain Node, and some
// toolchains export it globally. Re-exec once with it removed -- the same
// guard scripts/smoke.cjs takes, and for the same reason.
if (!electron || typeof electron === 'string' || !electron.app) {
  if (process.env.ELECTRON_RUN_AS_NODE) {
    const { spawnSync } = require('node:child_process');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const binary = typeof electron === 'string' ? electron : process.execPath;
    const { status } = spawnSync(binary, [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' });
    process.exit(status ?? 1);
  }
  process.stderr.write('make-icon: this must run under Electron (npm run icon)\n');
  process.exit(1);
}

const { app, BrowserWindow } = electron;
const RES = path.join(__dirname, '..', 'resources');
const SVG = path.join(RES, 'icon.svg');
const PNG = path.join(RES, 'icon.png');
const ICNS = path.join(RES, 'icon.icns');

/** The ten faces an .icns carries, as `iconutil` names them. */
const FACES = [16, 32, 128, 256, 512];

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');

  // about:blank, not the data: URL itself -- Chromium blocks a top-level
  // navigation to data:, and this only needs somewhere to hold a canvas.
  const win = new BrowserWindow({ show: false, width: 64, height: 64 });
  await win.loadURL('about:blank');

  const out = await win.webContents.executeJavaScript(`(async () => {
    try {
      const img = new Image();
      img.src = ${JSON.stringify(dataUrl)};
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 1024;
      c.getContext('2d').drawImage(img, 0, 0, 1024, 1024);
      return { url: c.toDataURL('image/png') };
    } catch (err) { return { error: String(err && err.message || err) }; }
  })()`);

  if (out.error) {
    process.stderr.write('make-icon: ' + out.error + '\n');
    app.exit(1);
    return;
  }

  fs.writeFileSync(PNG, Buffer.from(out.url.split(',')[1], 'base64'));
  process.stdout.write(`icon.png   1024x1024  ${(fs.statSync(PNG).size / 1024).toFixed(1)} KB\n`);

  if (process.platform !== 'darwin') {
    process.stdout.write('icon.icns  skipped -- iconutil is macOS only; the PNG is enough elsewhere\n');
    app.exit(0);
    return;
  }

  // sips and iconutil both ship with macOS, so the .icns costs no dependency.
  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-')) + '/icon.iconset';
  fs.mkdirSync(set, { recursive: true });
  for (const size of FACES) {
    for (const [px, name] of [[size, `icon_${size}x${size}.png`], [size * 2, `icon_${size}x${size}@2x.png`]]) {
      execFileSync('sips', ['-z', String(px), String(px), PNG, '--out', path.join(set, name)], { stdio: 'ignore' });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', ICNS], { stdio: 'inherit' });
  fs.rmSync(path.dirname(set), { recursive: true, force: true });
  process.stdout.write(`icon.icns  10 faces   ${(fs.statSync(ICNS).size / 1024).toFixed(1)} KB\n`);

  app.exit(0);
});
