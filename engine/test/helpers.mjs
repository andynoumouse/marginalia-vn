// Helpers shared by the test files. Not a test file itself: scripts/test.mjs runs only *.test.mjs.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const root = fileURLToPath(new URL('../..', import.meta.url));

// ---- compiled programs ----

/** The messages of a compiled program's errors. */
export const errors = p => p.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
/** The messages of a compiled program's warnings. */
export const warnings = p => p.diagnostics.filter(d => d.severity === 'warning').map(d => d.message);

// ---- a browser and the dev server ----

/** A free TCP port on localhost. */
export const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }).on('error', reject);
});

/**
 * The system's Edge or Chrome through playwright-core (VN_BROWSER names another executable): `{ browser }`, or
 * `{ skip }` with the reason when playwright-core or a browser is missing, for `t.skip`.
 */
export async function launchBrowser() {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { return { skip: 'playwright-core is not installed' }; }
  for (const opts of process.env.VN_BROWSER ? [{ executablePath: process.env.VN_BROWSER }] : [{ channel: 'msedge' }, { channel: 'chrome' }]) {
    try { return { browser: await chromium.launch(opts) }; } catch { /* try the next one */ }
  }
  return { skip: 'no Chrome or Edge found (set VN_BROWSER)' };
}

/**
 * Starts preview/dev-server.mjs with `args` on a free port and waits until `ready` (a path) answers, checking `tries` times 100 ms
 * apart. Returns its `origin` (`http://localhost:<port>`, no slash) and the process to kill.
 */
export async function startDevServer({ args = ['--no-build', '--no-art'], env = {}, ready = '/', tries = 100 } = {}) {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, ['preview/dev-server.mjs', ...args], { cwd: root, env: { ...process.env, ...env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; ; i++) {
    try { if ((await fetch(origin + ready)).ok) break; } catch { /* not listening yet */ }
    if (i > tries) { server.kill(); throw new Error('dev server did not start'); }
    await new Promise(r => setTimeout(r, 100));
  }
  return { origin, server };
}
