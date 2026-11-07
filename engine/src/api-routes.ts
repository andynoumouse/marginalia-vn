// Every /api route of the editor's server. preview/dev-server.mjs serves all of them; the online demo (online/routes.ts)
// serves those with `online: true` and answers the rest like a server without them. api-routes.test.mjs checks both
// against this table, so a route added to one place and not the others fails a test.

export interface ApiRoute { method: 'GET' | 'PUT' | 'POST'; path: string; online: boolean }

export const API_ROUTES: readonly ApiRoute[] = [
  { method: 'GET', path: '/api/capabilities', online: true },
  { method: 'GET', path: '/api/project', online: true },
  { method: 'PUT', path: '/api/script', online: true },
  { method: 'PUT', path: '/api/asset', online: true },
  { method: 'PUT', path: '/api/folder', online: true },
  { method: 'POST', path: '/api/move', online: true },
  { method: 'POST', path: '/api/delete', online: true },
  { method: 'GET', path: '/api/trash', online: true },
  { method: 'POST', path: '/api/trash/restore', online: true },
  { method: 'POST', path: '/api/trash/empty', online: true },
  { method: 'GET', path: '/api/git', online: true },
  { method: 'POST', path: '/api/git/commit', online: false },
  { method: 'POST', path: '/api/git/ignore', online: false },
  { method: 'POST', path: '/api/reveal', online: false },
  { method: 'POST', path: '/api/open', online: false },
  { method: 'PUT', path: '/api/game', online: true },
  { method: 'GET', path: '/api/locales', online: true },
  { method: 'PUT', path: '/api/locale', online: true },
  { method: 'GET', path: '/api/voice', online: true },
  { method: 'PUT', path: '/api/voice', online: true },
  { method: 'PUT', path: '/api/rig', online: true },
  { method: 'PUT', path: '/api/theme', online: true },
  { method: 'GET', path: '/api/build-check', online: false },
  { method: 'POST', path: '/api/task', online: true },
];
