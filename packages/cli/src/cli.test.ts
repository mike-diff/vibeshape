import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '..', 'dist', 'main.js');
const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'appshape-cli-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function shape(repo: string, ...args: string[]): string {
  return execFileSync(process.execPath, [CLI, '--dir', repo, ...args], { encoding: 'utf8' });
}

function seededRepo(): string {
  const repo = tempRepo();
  shape(repo, 'init', '--name', 'demo');
  shape(repo, 'add', '/', '--title', 'Auth', '--importance', 'core');
  shape(repo, 'add', 'auth', '--title', 'Login');
  shape(repo, 'add', 'auth', '--title', 'OAuth Login');
  return repo;
}

describe('shape CLI', () => {
  it('init + add + tree round-trips through the filesystem', () => {
    const repo = seededRepo();
    const tree = shape(repo, 'tree', '--compact');
    expect(tree).toContain('shape demo');
    expect(tree).toContain('[M] auth/login Login');
    expect(tree).toContain('[M] auth/oauth-login OAuth Login');
  });

  it('set --coverage updates status, stamps assessment, and fingerprints file evidence', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'covered', '--evidence', 'file:login.ts');
    const detail = JSON.parse(shape(repo, 'show', 'auth/login'));
    expect(detail.coverage).toBe('covered');
    expect(detail.assessed.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.evidence[0]).toMatchObject({ type: 'file', path: 'login.ts' });
    expect(detail.evidence[0].hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('derives parent coverage from children in tree output', () => {
    const repo = seededRepo();
    shape(repo, 'set', 'auth/login', '--coverage', 'covered');
    const tree = shape(repo, 'tree', '--compact');
    expect(tree).toContain('[P] auth Auth');
  });

  it('refuses to set coverage on a node with children', () => {
    const repo = seededRepo();
    expect(() => shape(repo, 'set', 'auth', '--coverage', 'covered')).toThrow(/derived/);
  });

  it('--gaps hides covered leaves and keeps uncovered ones', () => {
    const repo = seededRepo();
    shape(repo, 'set', 'auth/login', '--coverage', 'covered');
    shape(repo, 'set', 'auth/oauth-login', '--coverage', 'gap', '--gap', 'no refresh rotation');
    const tree = shape(repo, 'tree', '--compact', '--gaps');
    expect(tree).not.toContain('auth/login Login');
    expect(tree).toContain('!no refresh rotation');
  });

  it('rm requires --force for subtrees and rewrites ids on mv', () => {
    const repo = seededRepo();
    expect(() => shape(repo, 'rm', 'auth')).toThrow(/--force/);
    shape(repo, 'add', '/', '--title', 'Account');
    shape(repo, 'mv', 'auth/oauth-login', 'account');
    expect(shape(repo, 'tree', '--compact')).toContain('[M] account/oauth-login');
  });

  it('prime emits CLI usage plus the compact tree', () => {
    const repo = seededRepo();
    const prime = shape(repo, 'prime');
    expect(prime).toContain('Never edit .shape/*.json directly');
    expect(prime).toContain('[M] auth/login Login');
  });

  it('exits nonzero with a message on unknown node ids', () => {
    const repo = seededRepo();
    expect(() => shape(repo, 'show', 'nope/nothing')).toThrow(/not found/);
  });

  it('survives concurrent writers without losing adds (advisory lock)', async () => {
    const repo = tempRepo();
    shape(repo, 'init', '--name', 'demo');
    shape(repo, 'add', '/', '--title', 'Area');
    const titles = Array.from({ length: 8 }, (_, i) => `Node ${i}`);
    await Promise.all(
      titles.map((title) =>
        execFileAsync(process.execPath, [CLI, '--dir', repo, 'add', 'area', '--title', title]),
      ),
    );
    const saved = JSON.parse(readFileSync(join(repo, '.shape', 'area.json'), 'utf8'));
    expect(saved.children).toHaveLength(8);
  });
});
