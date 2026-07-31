import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initShape, loadShape, updateShape, withLock } from './store.js';
import { addNode } from './tree.js';

const tempDirs: string[] = [];

function tempRepo(): string {
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
    expect(loaded.manifest.areas).toEqual(['auth']);
    expect(loaded.areas[0]?.children?.[0]).toMatchObject({ id: 'auth/login', coverage: 'partial', gap: 'no rate limiting' });
  });

  it('writes one file per area and deletes files for removed areas', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    updateShape(repo, (shape) => {
      addNode(shape, '/', { title: 'Auth' });
      addNode(shape, '/', { title: 'Checkout' });
    });
    expect(readdirSync(join(repo, '.shape')).sort()).toEqual(['auth.json', 'checkout.json', 'shape.json']);
    updateShape(repo, (shape) => {
      shape.areas = shape.areas.filter((a) => a.id !== 'checkout');
      shape.manifest.areas = shape.manifest.areas.filter((a) => a !== 'checkout');
    });
    expect(readdirSync(join(repo, '.shape')).sort()).toEqual(['auth.json', 'shape.json']);
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
    expect(after).toBe(before);
  });

  it('leaves no temp files behind after saving', () => {
    const repo = tempRepo();
    initShape(repo, 'demo');
    updateShape(repo, (shape) => {
      addNode(shape, '/', { title: 'Auth' });
    });
    expect(readdirSync(join(repo, '.shape')).filter((f) => f.includes('.tmp'))).toEqual([]);
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
    expect(() => loadShape(repo)).toThrow();
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
    expect(() => loadShape(repo)).toThrow(/must start with/);
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
    expect(withLock(repo, () => 'ran')).toBe('ran');
  });
});
