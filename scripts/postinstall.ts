/**
 * npm 11.16 stopped running dependency install scripts by default, and
 * Electron downloads its ~120 MB binary from one. Without this the first
 * `npm run dev` fails with a bare "Electron failed to install correctly".
 *
 * The root package's own lifecycle scripts still run, so this bridges the gap:
 * it invokes Electron's installer directly, and only when the binary is
 * actually absent.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const electronDir = fileURLToPath(new URL('../node_modules/electron/', import.meta.url));

if (!existsSync(electronDir)) {
  process.stdout.write('electron is not installed yet — nothing to do\n');
  process.exit(0);
}

// path.txt is written by the installer and names the binary inside dist/.
if (existsSync(electronDir + 'path.txt') && existsSync(electronDir + 'dist')) {
  process.exit(0);
}

process.stdout.write('fetching the Electron binary (npm no longer runs its install script)…\n');
try {
  execFileSync(process.execPath, ['install.js'], { cwd: electronDir, stdio: 'inherit' });
} catch {
  process.stderr.write(
    'warning: could not fetch the Electron binary. Run this by hand:\n' +
      '  node node_modules/electron/install.js\n',
  );
}
