import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { decorateShape } from './decorate.mjs';
import { loadShape, shapeDirPath } from './store.mjs';

/**
 * @typedef {import('node:http').IncomingMessage} IncomingMessage
 * @typedef {import('node:http').Server} Server
 * @typedef {import('node:http').ServerResponse} ServerResponse
 * @typedef {import('./decorate.mjs').DecoratedShape} DecoratedShape
 *
 * @typedef {object} Viewer
 * @property {string} url
 * @property {() => Promise<void>} close
 */

export const DEFAULT_PORT = 4820;
export const DEFAULT_HOST = '127.0.0.1';
const PORT_ATTEMPTS = 21;
const KEEP_ALIVE_MS = 25_000;
const POLL_MS = 300;

const SNAPSHOT_MARKER = '<!--__SNAPSHOT_DATA__-->';

/** @type {string | undefined} */
let clientHtml;

/**
 * Assembles client/{index.html,style.css,main.js} into one self-contained page.
 * The snapshot placeholder is deliberately left intact so makeSnapshotHtml can
 * swap in embedded data at runtime.
 *
 * @returns {string}
 */
function buildClientHtml() {
  const clientDir = join(import.meta.dirname, '..', 'client');
  const html = readFileSync(join(clientDir, 'index.html'), 'utf8');
  const css = readFileSync(join(clientDir, 'style.css'), 'utf8');
  const script = readFileSync(join(clientDir, 'main.js'), 'utf8');

  const page = html
    .replace('<!--__STYLE__-->', () => css.trim())
    .replace('<!--__SCRIPT__-->', () => script.trim());

  for (const marker of ['<!--__STYLE__-->', '<!--__SCRIPT__-->']) {
    if (page.includes(marker)) throw new Error(`client: placeholder ${marker} was not replaced`);
  }
  if (!page.includes(SNAPSHOT_MARKER)) {
    throw new Error(`client: ${SNAPSHOT_MARKER} must survive into the template`);
  }
  return page;
}

/** The assembled client page, built once on first use. */
export function getClientHtml() {
  if (clientHtml === undefined) clientHtml = buildClientHtml();
  return clientHtml;
}

/**
 * Renders a standalone page carrying its own data, so it needs no server: the
 * client sees `window.__SHAPE__` and skips both the fetch and the event stream.
 *
 * @param {DecoratedShape} shape
 * @returns {string}
 */
export function makeSnapshotHtml(shape) {
  const json = JSON.stringify(shape).replace(/</g, '\\u003c');
  return getClientHtml().replace(SNAPSHOT_MARKER, () => `<script>window.__SHAPE__=${json}</script>`);
}

/**
 * @param {string} repoRoot
 * @param {number} [port]
 * @param {string} [host]
 * @returns {Promise<Viewer>}
 */
export async function startViewer(repoRoot, port = DEFAULT_PORT, host = DEFAULT_HOST) {
  /** @type {Set<ServerResponse>} */
  const clients = new Set();
  const shapeDir = shapeDirPath(repoRoot);

  const server = createServer((req, res) => {
    handle(req, res, repoRoot, clients);
  });
  const bound = await listen(server, port, host);

  // Polling beats a watcher dependency here: the directory is a handful of
  // small files, and mtime+size catches every edit the CLI can make.
  let fingerprint = shapeFingerprint(shapeDir);
  const poll = setInterval(() => {
    const next = shapeFingerprint(shapeDir);
    if (next === fingerprint) return;
    fingerprint = next;
    for (const client of clients) client.write('event: shape-changed\ndata: {}\n\n');
  }, POLL_MS);
  poll.unref();

  const keepAlive = setInterval(() => {
    for (const client of clients) client.write(': keep-alive\n\n');
  }, KEEP_ALIVE_MS);
  keepAlive.unref();

  return {
    url: `http://${host}:${bound}`,
    async close() {
      clearInterval(poll);
      clearInterval(keepAlive);
      for (const client of clients) client.end();
      clients.clear();
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve(undefined)));
      });
    },
  };
}

/**
 * Cheap stamp of every .json in `.shape/`; changes whenever any file does.
 *
 * @param {string} shapeDir
 * @returns {string}
 */
function shapeFingerprint(shapeDir) {
  let stamp = '';
  try {
    for (const file of readdirSync(shapeDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const stats = statSync(join(shapeDir, file));
      stamp += `${file}:${stats.mtimeMs}:${stats.size};`;
    }
  } catch {
    return 'missing';
  }
  return stamp;
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} repoRoot
 * @param {Set<ServerResponse>} clients
 * @returns {void}
 */
function handle(req, res, repoRoot, clients) {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(getClientHtml());
    return;
  }
  if (path === '/shape') {
    sendShape(res, repoRoot);
    return;
  }
  if (path === '/snapshot') {
    sendSnapshot(res, repoRoot);
    return;
  }
  if (path === '/events') {
    subscribe(req, res, clients);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

/**
 * @param {ServerResponse} res
 * @param {string} repoRoot
 * @returns {void}
 */
function sendShape(res, repoRoot) {
  try {
    const body = JSON.stringify(decorateShape(loadShape(repoRoot)));
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}

/**
 * @param {ServerResponse} res
 * @param {string} repoRoot
 * @returns {void}
 */
function sendSnapshot(res, repoRoot) {
  try {
    const body = makeSnapshotHtml(decorateShape(loadShape(repoRoot)));
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': 'attachment; filename="shape-snapshot.html"',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(err instanceof Error ? err.message : String(err));
  }
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {Set<ServerResponse>} clients
 * @returns {void}
 */
function subscribe(req, res, clients) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
  });
}

/**
 * Binds the first free port at or above `port`, giving up after PORT_ATTEMPTS.
 *
 * @param {Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<number>}
 */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    /** @param {NodeJS.ErrnoException} err */
    const onError = (err) => {
      if (err.code !== 'EADDRINUSE' || ++attempt >= PORT_ATTEMPTS) {
        server.removeListener('error', onError);
        reject(err);
        return;
      }
      server.listen(port + attempt, host);
    };
    server.on('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve(port + attempt);
    });
  });
}
