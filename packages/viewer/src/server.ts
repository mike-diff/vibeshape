import { watch } from 'chokidar';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { loadShape, shapeDirPath } from '@appshape/core';
import { decorateShape } from './decorate.js';

export const DEFAULT_PORT = 4820;
const PORT_ATTEMPTS = 21;
const KEEP_ALIVE_MS = 25_000;
const HOST = '127.0.0.1';

export interface Viewer {
  url: string;
  close(): Promise<void>;
}

/**
 * The Vite bundle always lands in `<package>/dist/client`. Resolving via the
 * package root keeps this correct whether server.ts runs from dist/ or, under
 * vitest, straight from src/.
 */
const CLIENT_HTML = join(import.meta.dirname, '..', 'dist', 'client', 'index.html');

export async function startViewer(repoRoot: string, port = DEFAULT_PORT): Promise<Viewer> {
  const html = readFileSync(CLIENT_HTML, 'utf8');
  const clients = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    handle(req, res, repoRoot, html, clients);
  });
  const bound = await listen(server, port);

  const watcher = watch(shapeDirPath(repoRoot), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  const notify = (): void => {
    for (const client of clients) client.write('event: shape-changed\ndata: {}\n\n');
  };
  watcher.on('add', notify).on('change', notify).on('unlink', notify);
  // Resolve only once the initial scan is done, so changes made right after
  // startViewer() resolves cannot slip through unwatched.
  await new Promise<void>((resolve) => watcher.once('ready', resolve));

  const keepAlive = setInterval(() => {
    for (const client of clients) client.write(': keep-alive\n\n');
  }, KEEP_ALIVE_MS);
  keepAlive.unref();

  return {
    url: `http://${HOST}:${bound}`,
    async close(): Promise<void> {
      clearInterval(keepAlive);
      for (const client of clients) client.end();
      clients.clear();
      await watcher.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  repoRoot: string,
  html: string,
  clients: Set<ServerResponse>,
): void {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (path === '/shape') {
    sendShape(res, repoRoot);
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
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
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
function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code !== 'EADDRINUSE' || ++attempt >= PORT_ATTEMPTS) {
        server.removeListener('error', onError);
        reject(err);
        return;
      }
      server.listen(port + attempt, HOST);
    };
    server.on('error', onError);
    server.listen(port, HOST, () => {
      server.removeListener('error', onError);
      resolve(port + attempt);
    });
  });
}
