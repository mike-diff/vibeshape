import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { decorateShape } from '../plugin/lib/decorate.mjs';
import { makeSnapshotHtml, startViewer } from '../plugin/lib/server.mjs';

/**
 * @typedef {import('../plugin/lib/types.mjs').Manifest} Manifest
 * @typedef {import('../plugin/lib/types.mjs').ShapeNode} ShapeNode
 * @typedef {import('../plugin/lib/decorate.mjs').DecoratedShape} DecoratedShape
 */

/** @type {string[]} */
const temps = [];
/** @type {{ close(): Promise<void> }[]} */
const viewers = [];

afterEach(async () => {
  for (const viewer of viewers.splice(0)) await viewer.close();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes the deterministic on-disk form the CLI produces: 2-space indent with a
 * trailing newline.
 *
 * @param {string} file
 * @param {unknown} value
 */
function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {ShapeNode} area
 * @returns {string}
 */
function fixtureRepo(area) {
  const repo = mkdtempSync(join(tmpdir(), 'vibeshape-viewer-'));
  temps.push(repo);
  const dir = join(repo, '.shape');
  mkdirSync(dir);
  writeJson(join(dir, 'shape.json'), { name: 'demo', schemaVersion: 1, areas: [area.id] });
  writeJson(join(dir, `${area.id}.json`), area);
  return repo;
}

/** @returns {ShapeNode} */
function mixedArea() {
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

/** @param {string} repo */
async function start(repo) {
  const viewer = await startViewer(repo);
  viewers.push(viewer);
  return viewer;
}

describe('viewer server', () => {
  it('decorates every node with rolled-up coverage, suspect, and percent', async () => {
    const viewer = await start(fixtureRepo(mixedArea()));
    /** @type {DecoratedShape} */
    const shape = await (await fetch(`${viewer.url}/shape`)).json();

    const area = shape.areas[0];
    assert.equal(shape.name, 'demo');
    assert.equal(area.derived.coverage, 'partial');
    assert.equal(area.derived.percent, 50);
    assert.equal(area.children[0].derived.coverage, 'covered');
    assert.equal(area.children[1].derived.coverage, 'missing');
    assert.equal(shape.counts.covered, 1);
    assert.equal(shape.counts.missing, 1);
  });

  it('counts linked leaves and stored suspects for the header split', async () => {
    const area = mixedArea();
    area.children[1].coverage = 'linked';
    area.children[1].suspect = true;
    const viewer = await start(fixtureRepo(area));
    /** @type {DecoratedShape} */
    const shape = await (await fetch(`${viewer.url}/shape`)).json();

    assert.equal(shape.counts.linked, 1);
    assert.equal(shape.counts.verified, 0);
    assert.equal(shape.suspectCount, 1, 'suspectCount counts stored flags, not the derived rollup');
    assert.equal(shape.areas[0].derived.coverage, 'covered', 'covered + linked children derive covered');
  });

  it('reports suspect on ancestors of a flagged node', async () => {
    const area = mixedArea();
    area.children[1].suspect = true;
    const viewer = await start(fixtureRepo(area));
    /** @type {DecoratedShape} */
    const shape = await (await fetch(`${viewer.url}/shape`)).json();

    assert.equal(shape.areas[0].derived.suspect, true);
    assert.equal(shape.areas[0].children[0].derived.suspect, false);
  });

  it('serves a self-contained client at / with no external assets', async () => {
    const viewer = await start(fixtureRepo(mixedArea()));
    const response = await fetch(`${viewer.url}/`);

    assert.ok(response.headers.get('content-type').includes('text/html'));
    const html = await response.text();
    assert.ok(html.includes('id="tree"'));
    assert.ok(html.includes('gaps only'));
    // The server inlines style.css and main.js; nothing may be fetched.
    assert.ok(html.includes('--verified:'));
    assert.ok(html.includes('EventSource'));
    assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="(?!data:)/);
  });

  it('ships the prompt palette and its four steering prompts', async () => {
    const viewer = await start(fixtureRepo(mixedArea()));
    const html = await (await fetch(`${viewer.url}/`)).text();

    assert.ok(html.includes('id="palette"'));
    for (const label of ['Mark covered', 'Add children', 'Re-assess', 'Challenge']) {
      assert.ok(html.includes(label), `expected client to ship the ${label} prompt`);
    }
  });

  it('emits shape-changed over SSE when an area file is written', async () => {
    const repo = fixtureRepo(mixedArea());
    const viewer = await start(repo);
    const stream = await subscribeToEvents(`${viewer.url}/events`);

    const changed = mixedArea();
    changed.children[1].coverage = 'covered';
    writeJson(join(repo, '.shape', 'auth.json'), changed);

    const arrived = await Promise.race([
      stream.next('shape-changed'),
      new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    assert.equal(arrived, true);
  });

  it('falls back to the next port when the default is taken', async () => {
    const first = await start(fixtureRepo(mixedArea()));
    const second = await start(fixtureRepo(mixedArea()));

    assert.notEqual(second.url, first.url);
    assert.equal((await (await fetch(`${second.url}/shape`)).json()).name, 'demo');
  });
});

describe('makeSnapshotHtml', () => {
  it('embeds the shape so the page renders without a server', () => {
    const decorated = decorateShape({
      manifest: { name: 'demo', schemaVersion: 1, areas: ['auth'] },
      areas: [mixedArea()],
    });
    const html = makeSnapshotHtml(decorated);

    assert.ok(html.includes('window.__SHAPE__='));
    assert.ok(html.includes('"auth/oauth"'));
    assert.ok(html.includes('Login'));
    assert.ok(html.includes('no refresh rotation'));
    assert.ok(!html.includes('<!--__SNAPSHOT_DATA__-->'));
  });

  it('escapes < so embedded data cannot close the script tag', () => {
    const area = mixedArea();
    area.children[1].gap = 'breaks on </script><script>alert(1)</script>';
    const html = makeSnapshotHtml(
      decorateShape({ manifest: { name: 'demo', schemaVersion: 1, areas: ['auth'] }, areas: [area] }),
    );

    const embedded = html.slice(html.indexOf('window.__SHAPE__='));
    assert.ok(!embedded.includes('</script><script>alert'));
    assert.ok(embedded.includes('\\u003c/script>'));
  });

  it('serves the same snapshot over /snapshot', async () => {
    const viewer = await start(fixtureRepo(mixedArea()));
    const response = await fetch(`${viewer.url}/snapshot`);

    assert.ok(response.headers.get('content-type').includes('text/html'));
    const html = await response.text();
    assert.ok(html.includes('window.__SHAPE__='));
    assert.ok(html.includes('"auth/login"'));
  });
});

/**
 * Opens the SSE stream and consumes the server's `: connected` preamble, so a
 * caller that awaits this is guaranteed to be subscribed before it triggers a
 * change.
 *
 * @param {string} url
 * @returns {Promise<{ next(event: string): Promise<boolean> }>}
 */
async function subscribeToEvents(url) {
  const response = await fetch(url);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!buffer.includes(': connected')) {
    const { value, done } = await reader.read();
    if (done) throw new Error('event stream closed before connecting');
    buffer += decoder.decode(value, { stream: true });
  }

  return {
    /**
     * Resolves true once `event` appears in the stream, false if it stops first.
     *
     * @param {string} event
     * @returns {Promise<boolean>}
     */
    async next(event) {
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
