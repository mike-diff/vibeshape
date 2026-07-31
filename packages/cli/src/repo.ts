import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SHAPE_DIR } from '@appshape/core';

/** Walks up from `start` to find the directory containing `.shape/`. */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, SHAPE_DIR, 'shape.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`no ${SHAPE_DIR}/ found from ${start} upward - run "shape init" first`);
    }
    dir = parent;
  }
}

export function gitShortRef(repoRoot: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
