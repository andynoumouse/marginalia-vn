// What the server behind the editor can do (`GET /api/capabilities`). The dev server does everything; the online demo
// (online/sw.ts, a service worker holding the project in the browser) has no git, no file manager and no node tools, so the
// editor hides or disables what would fail there.

export interface Capabilities {
  /** The Files panel's git section and Commit. */
  git: boolean;
  /** Reveal in file manager, Open in default app. */
  reveal: boolean;
  /** `POST /api/task?name=` names it accepts (export, strings, art, build). */
  tasks: string[];
  /** Pre-build checks for the Build dialog (`GET /api/build-check`). */
  buildCheck: boolean;
  /** Set by the online demo: the editor shows a note and a way back to the project list. */
  online: boolean;
}

export const FULL_CAPABILITIES: Capabilities = { git: true, reveal: true, tasks: ['export', 'strings', 'art', 'build'], buildCheck: true, online: false };

/** Reads a `/api/capabilities` answer; anything missing or malformed counts as the dev server's (an older server has no route). */
export function readCapabilities(json: unknown): Capabilities {
  const o = json && typeof json === 'object' ? json as Record<string, unknown> : {};
  const flag = (k: 'git' | 'reveal' | 'buildCheck' | 'online') => (typeof o[k] === 'boolean' ? o[k] as boolean : FULL_CAPABILITIES[k]);
  const tasks = Array.isArray(o.tasks) && o.tasks.every(t => typeof t === 'string') ? o.tasks as string[] : FULL_CAPABILITIES.tasks;
  return { git: flag('git'), reveal: flag('reveal'), tasks, buildCheck: flag('buildCheck'), online: flag('online') };
}
