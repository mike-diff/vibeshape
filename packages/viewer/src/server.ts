import { readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { loadShape, shapeDirPath } from '@appshape/core';
import { CLIENT_HTML, SNAPSHOT_MARKER } from './client-html.js';
import { decorateShape } from './decorate.js';
import type { DecoratedShape } from './decorate.js';

export const DEFAULT_PORT = 4820;
export const DEFAULT_HOST = '127.0.0.1';
const PORT_ATTEMPTS = 21;
const KEEP_ALIVE_MS = 25_000;
const POLL_MS = 300;

export interface Viewer {
  url: string;
  close(): Promise<void>;
}

/**
 * Renders a standalone page carrying its own data, so it needs no server: the
 * client sees `window.__SHAPE__` and skips both the fetch and the event stream.
 */
export function makeSnapshotHtml(shape: DecoratedShape): string {
  const json = JSON.stringify(shape).replace(/</g, '\\u003c');
  return CLIENT_HTML.replace(SNAPSHOT_MARKER, () => `<script>window.__SHAPE__=${json}</script>`);
}

export async function startViewer(
  repoRoot: string,
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
): Promise<Viewer> {
  const clients = new Set<ServerResponse>();
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
    async close(): Promise<void> {
      clearInterval(poll);
      clearInterval(keepAlive);
      for (const client of clients) client.end();
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** Cheap stamp of every .json in `.shape/`; changes whenever any file does. */
function shapeFingerprint(shapeDir: string): string {
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

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  repoRoot: string,
  clients: Set<ServerResponse>,
): void {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(CLIENT_HTML);
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

function sendShape(res: ServerResponse, repoRoot: string): void {
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

function sendSnapshot(res: ServerResponse, repoRoot: string): void {
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

function subscribe(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>): void {
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

/** Binds the first free port at or above `port`, giving up after PORT_ATTEMPTS. */
function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const onError = (err: NodeJS.ErrnoException): void => {
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
