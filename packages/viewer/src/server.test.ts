import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeArea, serializeManifest } from '@appshape/core';
import type { ShapeNode } from '@appshape/core';
import { afterEach, describe, expect, it } from 'vitest';
import { decorateShape } from './decorate.js';
import type { DecoratedShape } from './decorate.js';
import { makeSnapshotHtml, startViewer } from './server.js';

const temps: string[] = [];
const viewers: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const viewer of viewers.splice(0)) await viewer.close();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureRepo(area: ShapeNode): string {
  const repo = mkdtempSync(join(tmpdir(), 'appshape-viewer-'));
  temps.push(repo);
  const dir = join(repo, '.shape');
  mkdirSync(dir);
  writeFileSync(
    join(dir, 'shape.json'),
    serializeManifest({ name: 'demo', schemaVersion: 1, areas: [area.id] }),
  );
  writeFileSync(join(dir, `${area.id}.json`), serializeArea(area));
  return repo;
}

function mixedArea(): ShapeNode {
  return {
    id: 'auth',
    title: 'Auth',
    importance: 'core',
    children: [
      { id: 'auth/login', title: 'Login', coverage: 'covered' },
      { id: 'auth/oauth', title: 'OAuth', coverage: 'missing', gap: 'no refresh rotation' },
    ],
  };
}

async function start(repo: string) {
  const viewer = await startViewer(repo);
  viewers.push(viewer);
  return viewer;
}

describe('viewer server', () => {
  it('decorates every node with rolled-up coverage, suspect, and percent', async () => {
    const viewer = await start(fixtureRepo(mixedArea()));
    const shape = (await (await fetch(`${viewer.url}/shape`)).json()) as DecoratedShape;

    const area = shape.areas[0]!;
    expect(shape.name).toBe('demo');
    expect(area.derived.coverage).toBe('partial');
    expect(area.derived.percent).toBe(50);
    expect(area.children![0]!.derived.coverage).toBe('covered');
    expect(area.children![1]!.derived.coverage).toBe('missing');
    expect(shape.counts).toMatchObject({ covered: 1, missing: 1 });
  });

  it('reports suspect on ancestors of a flagged node', async () => {
    const area = mixedArea();
    area.children![1]!.suspect = true;
    const viewer = await start(fixtureRepo(area));
    const shape = (await (await fetch(`${viewer.url}/shape`)).json()) as DecoratedShape;

    expect(shape.areas[0]!.derived.suspect).toBe(true);
    expect(shape.areas[0]!.children![0]!.derived.suspect).toBe(false);
  });

  it('serves a self-contained client at / with no external assets', async () => {
    const viewer = await start(fixtureRepo(mixedArea()));
    const response = await fetch(`${viewer.url}/`);

    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('id="tree"');
    expect(html).toContain('gaps only');
    // The generator inlines style.css and main.js; nothing may be fetched.
    expect(html).toContain('--verified:');
    expect(html).toContain('EventSource');
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)="(?!data:)/);
  });

  it('ships the prompt palette and its four steering prompts', async () => {
    const viewer = await start(fixtureRepo(mixedArea()));
    const html = await (await fetch(`${viewer.url}/`)).text();

    expect(html).toContain('id="palette"');
    for (const label of ['Mark covered', 'Add children', 'Re-assess', 'Challenge']) {
      expect(html).toContain(label);
    }
  });

  it('emits shape-changed over SSE when an area file is written', async () => {
    const repo = fixtureRepo(mixedArea());
    const viewer = await start(repo);
    const stream = await subscribeToEvents(`${viewer.url}/events`);

    const changed = mixedArea();
    changed.children![1]!.coverage = 'covered';
    writeFileSync(join(repo, '.shape', 'auth.json'), serializeArea(changed));

    const arrived = await Promise.race([
      stream.next('shape-changed'),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    expect(arrived).toBe(true);
  });

  it('falls back to the next port when the default is taken', async () => {
    const first = await start(fixtureRepo(mixedArea()));
    const second = await start(fixtureRepo(mixedArea()));

    expect(second.url).not.toBe(first.url);
    expect((await (await fetch(`${second.url}/shape`)).json()).name).toBe('demo');
  });
});

describe('makeSnapshotHtml', () => {
  it('embeds the shape so the page renders without a server', () => {
    const decorated = decorateShape({
      manifest: { name: 'demo', schemaVersion: 1, areas: ['auth'] },
      areas: [mixedArea()],
    });
    const html = makeSnapshotHtml(decorated);

    expect(html).toContain('window.__SHAPE__=');
    expect(html).toContain('"auth/oauth"');
    expect(html).toContain('Login');
    expect(html).toContain('no refresh rotation');
    expect(html).not.toContain('<!--__SNAPSHOT_DATA__-->');
  });

  it('escapes < so embedded data cannot close the script tag', () => {
    const area = mixedArea();
    area.children![1]!.gap = 'breaks on </script><script>alert(1)</script>';
    const html = makeSnapshotHtml(
      decorateShape({ manifest: { name: 'demo', schemaVersion: 1, areas: ['auth'] }, areas: [area] }),
    );

    const embedded = html.slice(html.indexOf('window.__SHAPE__='));
    expect(embedded).not.toContain('</script><script>alert');
    expect(embedded).toContain('\\u003c/script>');
  });

  it('serves the same snapshot over /snapshot', async () => {
    const viewer = await start(fixtureRepo(mixedArea()));
    const response = await fetch(`${viewer.url}/snapshot`);

    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('window.__SHAPE__=');
    expect(html).toContain('"auth/login"');
  });
});

interface EventStream {
  /** Resolves true once `event` appears in the stream, false if it stops first. */
  next(event: string): Promise<boolean>;
}

/**
 * Opens the SSE stream and consumes the server's `: connected` preamble, so a
 * caller that awaits this is guaranteed to be subscribed before it triggers a
 * change.
 */
async function subscribeToEvents(url: string): Promise<EventStream> {
  const response = await fetch(url);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!buffer.includes(': connected')) {
    const { value, done } = await reader.read();
    if (done) throw new Error('event stream closed before connecting');
    buffer += decoder.decode(value, { stream: true });
  }

  return {
    async next(event: string): Promise<boolean> {
      const marker = `event: ${event}`;
      while (!buffer.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) return false;
        buffer += decoder.decode(value, { stream: true });
      }
      await reader.cancel();
      return true;
    },
  };
}
