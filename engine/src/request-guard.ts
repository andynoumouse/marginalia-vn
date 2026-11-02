/**
 * Request checks for the dev server (preview/dev-server.mjs). It listens on 127.0.0.1 only, but a page on another site can
 * still reach it through DNS rebinding (its own name pointed at 127.0.0.1), so every request must name a local host, and a
 * write sent by a browser must come from the server's own origin.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The host name of a `Host` header (`localhost:5173`, `[::1]:5173`), lower-cased and without the port. */
function hostName(host: string): string {
  return host.trim().toLowerCase().replace(/:\d*$/, '');
}

/** A `Host` header that names this machine. A rebinding page sends its own name, so anything else is refused, reads too. */
export function isLocalHost(host: string | undefined): boolean {
  return host !== undefined && LOCAL_HOSTS.has(hostName(host));
}

/**
 * The `Origin` of a write may be missing (node tools and tests send none) but, when a browser sends one, it must be the page
 * the server serves itself: `http://` plus the same local host and port. `null` (a sandboxed frame, a file) is refused.
 */
export function isOwnOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  if (!isLocalHost(host)) return false;
  return origin.toLowerCase() === `http://${host!.trim().toLowerCase()}`;
}

/** The file types the editor opens in their default app (`POST /api/open`): art masters, assets, scripts and data. */
const OPENABLE = /\.(psd|png|jpe?g|webp|avif|gif|svg|ogg|opus|mp3|wav|m4a|flac|woff2?|ttf|otf|vn|json)$/i;

/** Whether `/api/open` may hand this project-relative path to the system, so a stray `.bat` or `.exe` in a cloned project never runs. */
export function isOpenable(rel: string): boolean {
  return OPENABLE.test(rel);
}
