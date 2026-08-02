import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initShape, loadShape, updateShape, withLock } from '../plugin/lib/store.mjs';
import { addNode } from '../plugin/lib/tree.mjs';

const tempDirs = [];

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'appshape-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('store round-trip', () => {
  it('persists mutations and loads them back identically', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    updateShape(repo, (shape) => {
      addNode(shape, '/', { title: 'Auth' });
      const node = addNode(shape, 'auth', { title: 'Login', intent: 'WHEN a user submits valid credentials THE SYSTEM SHALL create a session' });
      node.coverage = 'partial';
      node.gap = 'no rate limiting';
    });
    const loaded = loadShape(repo);
    assert.deepEqual(loaded.manifest.areas, ['auth']);
    const child = loaded.areas[0]?.children?.[0];
    assert.equal(child?.id, 'auth/login');
    assert.equal(child?.coverage, 'partial');
    assert.equal(child?.gap, 'no rate limiting');
  });

  it('writes one file per area and deletes files for removed areas', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    updateShape(repo, (shape) => {
      addNode(shape, '/', { title: 'Auth' });
      addNode(shape, '/', { title: 'Checkout' });
    });
    const jsonFiles = () => readdirSync(join(repo, '.shape')).filter((f) => f.endsWith('.json')).sort();
    assert.deepEqual(jsonFiles(), ['auth.json', 'checkout.json', 'shape.json']);
    updateShape(repo, (shape) => {
      shape.areas = shape.areas.filter((a) => a.id !== 'checkout');
      shape.manifest.areas = shape.manifest.areas.filter((a) => a !== 'checkout');
    });
    assert.deepEqual(jsonFiles(), ['auth.json', 'shape.json']);
  });

  it('serializes deterministically: a load/save cycle is byte-identical', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    updateShape(repo, (shape) => {
      addNode(shape, '/', { title: 'Auth' });
      addNode(shape, 'auth', { title: 'Login', importance: 'core' });
    });
    const before = readFileSync(join(repo, '.shape', 'auth.json'), 'utf8');
    updateShape(repo, () => {});
    const after = readFileSync(join(repo, '.shape', 'auth.json'), 'utf8');
    assert.equal(after, before);
  });

  it('leaves no temp files behind after saving', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    updateShape(repo, (shape) => {
      addNode(shape, '/', { title: 'Auth' });
    });
    assert.deepEqual(readdirSync(join(repo, '.shape')).filter((f) => f.includes('.tmp')), []);
  });
});

describe('validation on load', () => {
  it('rejects an area file with an invalid coverage value', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    updateShape(repo, (shape) => {
      addNode(shape, '/', { title: 'Auth' });
    });
    const areaFile = join(repo, '.shape', 'auth.json');
    writeFileSync(areaFile, readFileSync(areaFile, 'utf8').replace('"title": "Auth"', '"title": "Auth", "coverage": "done"'));
    assert.throws(() => loadShape(repo), /coverage: must be one of/);
  });

  it('rejects a child whose id does not extend its parent path', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    updateShape(repo, (shape) => {
      addNode(shape, '/', { title: 'Auth' });
    });
    const areaFile = join(repo, '.shape', 'auth.json');
    writeFileSync(
      areaFile,
      JSON.stringify({ id: 'auth', title: 'Auth', children: [{ id: 'other/login', title: 'Login' }] }),
    );
    assert.throws(() => loadShape(repo), /must start with/);
  });
});

describe('locking', () => {
  it('steals a stale lock instead of deadlocking', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    const lockDir = join(repo, '.shape', '.lock');
    mkdirSync(lockDir);
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lockDir, stale, stale);
    assert.equal(withLock(repo, () => 'ran'), 'ran');
  });
});
