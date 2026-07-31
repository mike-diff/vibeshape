import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestSchema, nodeSchema, validateAreaTree } from './schema.js';
import { serializeArea, serializeManifest } from './serialize.js';
import type { Manifest, Shape, ShapeNode } from './types.js';

export const SHAPE_DIR = '.shape';
const MANIFEST_FILE = 'shape.json';
const LOCK_STALE_MS = 5_000;
const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 20;

export function shapeDirPath(repoRoot: string): string {
  return join(repoRoot, SHAPE_DIR);
}

export function shapeExists(repoRoot: string): boolean {
  try {
    return statSync(join(shapeDirPath(repoRoot), MANIFEST_FILE)).isFile();
  } catch {
    return false;
  }
}

export function initShape(repoRoot: string, name: string): Shape {
  const dir = shapeDirPath(repoRoot);
  if (shapeExists(repoRoot)) throw new Error(`${SHAPE_DIR}/ already initialized`);
  mkdirSync(dir, { recursive: true });
  const shape: Shape = { manifest: { name, schemaVersion: 1, areas: [] }, areas: [] };
  atomicWrite(join(dir, MANIFEST_FILE), serializeManifest(shape.manifest));
  return shape;
}

export function loadShape(repoRoot: string): Shape {
  const dir = shapeDirPath(repoRoot);
  const manifest = parseFile<Manifest>(join(dir, MANIFEST_FILE), (raw) => manifestSchema.parse(raw));
  const areas = manifest.areas.map((slug) => {
    const root = parseFile<ShapeNode>(join(dir, `${slug}.json`), (raw) => nodeSchema.parse(raw));
    const errors = validateAreaTree(root, slug);
    if (errors.length > 0) {
      throw new Error(`invalid area "${slug}": ${errors.join('; ')}`);
    }
    return root;
  });
  return { manifest, areas };
}

/**
 * Persists the manifest and every area file, removing area files that no
 * longer appear in the manifest. Callers should wrap mutations in withLock.
 */
export function saveShape(repoRoot: string, shape: Shape): void {
  const dir = shapeDirPath(repoRoot);
  atomicWrite(join(dir, MANIFEST_FILE), serializeManifest(shape.manifest));
  for (const area of shape.areas) {
    atomicWrite(join(dir, `${area.id}.json`), serializeArea(area));
  }
  const keep = new Set([MANIFEST_FILE, ...shape.manifest.areas.map((a) => `${a}.json`)]);
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.json') && !keep.has(file)) unlinkSync(join(dir, file));
  }
}

/** Loads, applies `mutate`, and saves - under an advisory lock. */
export function updateShape(repoRoot: string, mutate: (shape: Shape) => void): Shape {
  return withLock(repoRoot, () => {
    const shape = loadShape(repoRoot);
    mutate(shape);
    saveShape(repoRoot, shape);
    return shape;
  });
}

export function withLock<T>(repoRoot: string, fn: () => T): T {
  const lockDir = join(shapeDirPath(repoRoot), '.lock');
  acquireLock(lockDir);
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lockDir);
    } catch {
      // already released
    }
  }
}

function acquireLock(lockDir: string): void {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      mkdirSync(lockDir);
      return;
    } catch {
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          rmdirSync(lockDir);
          continue;
        }
      } catch {
        continue; // lock vanished between attempts
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  throw new Error(`could not acquire ${lockDir} - remove it if no other shape process is running`);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

function parseFile<T>(filePath: string, parse: (raw: unknown) => T): T {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`cannot read ${filePath} - run "shape init" first?`);
  }
  return parse(JSON.parse(text));
}
