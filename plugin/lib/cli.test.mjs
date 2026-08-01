import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const CLI = join(import.meta.dirname, '..', 'bin', 'shape.mjs');
const execFileAsync = promisify(execFile);
const tempDirs = [];

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'appshape-cli-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function shape(repo, ...args) {
  return execFileSync(process.execPath, [CLI, '--dir', repo, ...args], { encoding: 'utf8' });
}

function seededRepo() {
  const repo = tempRepo();
  shape(repo, 'init', '--name', 'demo');
  shape(repo, 'add', '/', '--title', 'Auth', '--importance', 'core');
  shape(repo, 'add', 'auth', '--title', 'Login');
  shape(repo, 'add', 'auth', '--title', 'OAuth Login');
  return repo;
}

/** Marks a node covered the legitimate way: with a real evidence file. */
function markCovered(repo, id) {
  const evidenceFile = `${id.replaceAll('/', '-')}.ts`;
  writeFileSync(join(repo, evidenceFile), `export const x = '${id}';\n`);
  shape(repo, 'set', id, '--coverage', 'covered', '--evidence', `file:${evidenceFile}`);
}

describe('shape CLI', () => {
  it('init + add + tree round-trips through the filesystem', () => {
    const repo = seededRepo();
    const tree = shape(repo, 'tree', '--compact');
    assert.ok(tree.includes('shape demo'));
    assert.ok(tree.includes('[M] auth/login Login'));
    assert.ok(tree.includes('[M] auth/oauth-login OAuth Login'));
  });

  it('set --coverage updates status, stamps assessment, and fingerprints file evidence', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'covered', '--evidence', 'file:login.ts');
    const detail = JSON.parse(shape(repo, 'show', 'auth/login'));
    assert.equal(detail.coverage, 'covered');
    assert.match(detail.assessed.at, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(detail.evidence[0].type, 'file');
    assert.equal(detail.evidence[0].path, 'login.ts');
    assert.match(detail.evidence[0].hash, /^[0-9a-f]{16}$/);
  });

  it('derives parent coverage from children in tree output', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    assert.ok(shape(repo, 'tree', '--compact').includes('[P] auth Auth'));
  });

  it('refuses covered without evidence and verified without test evidence', () => {
    const repo = seededRepo();
    assert.throws(() => shape(repo, 'set', 'auth/login', '--coverage', 'covered'));
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    assert.throws(() =>
      shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'file:login.ts'),
    );
    writeFileSync(join(repo, 'login.test.ts'), 'test\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'file:login.ts', '--evidence', 'test:login.test.ts#login works');
    assert.ok(shape(repo, 'tree', '--compact').includes('[V] auth/login'));
  });

  it('refuses to set coverage on a node with children', () => {
    const repo = seededRepo();
    assert.throws(() => shape(repo, 'set', 'auth', '--coverage', 'covered'), /derived/);
  });

  it('--gaps hides covered leaves and keeps uncovered ones', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    shape(repo, 'set', 'auth/oauth-login', '--coverage', 'gap', '--gap', 'no refresh rotation');
    const tree = shape(repo, 'tree', '--compact', '--gaps');
    assert.ok(!tree.includes('auth/login Login'));
    assert.ok(tree.includes('!no refresh rotation'));
  });

  it('--gaps sorts open work by importance, core first', () => {
    const repo = seededRepo();
    shape(repo, 'add', 'auth', '--title', 'MFA', '--importance', 'core');
    shape(repo, 'add', 'auth', '--title', 'Password Reset', '--importance', 'low');
    const tree = shape(repo, 'tree', '--compact', '--gaps');
    const mfa = tree.indexOf('auth/mfa');
    const reset = tree.indexOf('auth/password-reset');
    const login = tree.indexOf('auth/login');
    assert.ok(mfa > -1);
    assert.ok(mfa < login);
    assert.ok(reset > login);
  });

  it('rm requires --force for subtrees and rewrites ids on mv', () => {
    const repo = seededRepo();
    assert.throws(() => shape(repo, 'rm', 'auth'), /--force/);
    shape(repo, 'add', '/', '--title', 'Account');
    shape(repo, 'mv', 'auth/oauth-login', 'account');
    assert.ok(shape(repo, 'tree', '--compact').includes('[M] account/oauth-login'));
  });

  it('prime emits CLI usage plus the compact tree', () => {
    const repo = seededRepo();
    const prime = shape(repo, 'prime');
    assert.ok(prime.includes('Never edit .shape/*.json directly'));
    assert.ok(prime.includes('[M] auth/login Login'));
  });

  it('exits nonzero with a message on unknown node ids', () => {
    const repo = seededRepo();
    assert.throws(() => shape(repo, 'show', 'nope/nothing'), /not found/);
  });

  it('changing intent on an assessed node marks it suspect until re-assessed', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    const output = shape(repo, 'set', 'auth/login', '--intent', 'WHEN a user logs in THE SYSTEM SHALL also rotate the session token');
    assert.ok(output.includes('marked suspect'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[C?] auth/login'));
    assert.throws(() => shape(repo, 'audit'));
    shape(repo, 'review', 'auth/login');
    assert.ok(shape(repo, 'tree', '--compact').includes('[C] auth/login'));
  });

  it('re-asserting coverage together with a new intent does not mark suspect', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    shape(repo, 'set', 'auth/login', '--intent', 'WHEN a user logs in THE SYSTEM SHALL create a session', '--coverage', 'partial');
    const tree = shape(repo, 'tree', '--compact');
    assert.ok(tree.includes('[P] auth/login'));
    assert.ok(!tree.includes('[P?]'));
  });

  it('budget mode collapses covered leaves but keeps area lines and open work', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    markCovered(repo, 'auth/oauth-login');
    shape(repo, 'add', '/', '--title', 'Checkout');
    shape(repo, 'add', 'checkout', '--title', 'Cart');
    shape(repo, 'set', 'checkout/cart', '--coverage', 'gap', '--gap', 'no cart yet');
    const budget = shape(repo, 'tree', '--compact', '--budget', '2');
    assert.ok(budget.includes('[C] auth Auth'));
    assert.ok(!budget.includes('auth/login'));
    assert.ok(budget.includes('[G] checkout/cart'));
    assert.ok(budget.includes('budget mode'));
    const full = shape(repo, 'tree', '--compact', '--budget', '100');
    assert.ok(full.includes('auth/login'));
    assert.ok(!full.includes('budget mode'));
  });

  it('init upserts AGENTS.md only when it already exists', () => {
    const withAgents = tempRepo();
    writeFileSync(join(withAgents, 'AGENTS.md'), '# Doctrine\n');
    shape(withAgents, 'init', '--name', 'demo');
    assert.ok(readFileSync(join(withAgents, 'AGENTS.md'), 'utf8').includes('<!-- APPSHAPE START -->'));

    const without = tempRepo();
    shape(without, 'init', '--name', 'demo');
    assert.equal(existsSync(join(without, 'AGENTS.md')), false);
    assert.ok(readFileSync(join(without, 'CLAUDE.md'), 'utf8').includes('<!-- APPSHAPE START -->'));
  });

  it('snapshot writes a self-contained HTML file with embedded shape data', () => {
    const repo = seededRepo();
    shape(repo, 'snapshot');
    const html = readFileSync(join(repo, '.shape', 'snapshot.html'), 'utf8');
    assert.ok(html.includes('window.__SHAPE__'));
    assert.ok(html.includes('OAuth Login'));
    assert.ok(!/src="https?:|href="https?:/.test(html));
  });

  it('init installs the CLAUDE.md block and re-init of CLAUDE.md is idempotent', () => {
    const repo = tempRepo();
    writeFileSync(join(repo, 'CLAUDE.md'), '# My project\n');
    shape(repo, 'init', '--name', 'demo');
    const content = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('# My project'));
    assert.ok(content.includes('<!-- APPSHAPE START -->'));
    assert.equal(content.match(/APPSHAPE START/g).length, 1);
  });

  it('audit flags a claim as suspect when its evidence file changes, review clears it', () => {
    const repo = seededRepo();
    const file = join(repo, 'login.ts');
    writeFileSync(file, 'export const login = 1;\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'covered', '--evidence', 'file:login.ts');
    assert.ok(shape(repo, 'audit').includes('audit clean'));

    writeFileSync(file, 'export const login = 2;\n');
    let output = '';
    try {
      shape(repo, 'audit');
    } catch (error) {
      output = error.stdout;
    }
    assert.ok(output.includes('SUSPECT auth/login: login.ts changed since assessment'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[C?] auth/login'));

    shape(repo, 'review', 'auth/login');
    assert.ok(shape(repo, 'audit').includes('audit clean'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[C] auth/login'));
  });

  it('audit flags deleted evidence files and warns on unevidenced covered claims', () => {
    const repo = seededRepo();
    const file = join(repo, 'login.ts');
    writeFileSync(file, 'export const login = 1;\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'covered', '--evidence', 'file:login.ts');
    // Unevidenced covered can no longer be created via the CLI; simulate a
    // legacy map by editing the area file directly.
    const areaFile = join(repo, '.shape', 'auth.json');
    const area = JSON.parse(readFileSync(areaFile, 'utf8'));
    area.children.find((c) => c.id === 'auth/oauth-login').coverage = 'covered';
    writeFileSync(areaFile, JSON.stringify(area));
    rmSync(file);
    let output = '';
    try {
      shape(repo, 'audit');
    } catch (error) {
      output = error.stdout;
    }
    assert.ok(output.includes('SUSPECT auth/login: login.ts no longer exists'));
    assert.ok(output.includes('WARN    auth/oauth-login: covered with no evidence links'));
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
    assert.equal(saved.children.length, 8);
  });
});
