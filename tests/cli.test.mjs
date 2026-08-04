import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const CLI = join(import.meta.dirname, '..', 'plugin', 'bin', 'shape.mjs');
const execFileAsync = promisify(execFile);
const tempDirs = [];

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'vibeshape-cli-'));
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

/**
 * Writes a schemaVersion 1 map straight to disk - the only way to produce one
 * now that every write emits v2.
 */
function legacyRepo({ verifyCommand, node } = {}) {
  const repo = tempRepo();
  mkdirSync(join(repo, '.shape'));
  const manifest = { name: 'legacy', schemaVersion: 1, areas: ['auth'] };
  if (verifyCommand) manifest.verifyCommand = verifyCommand;
  writeFileSync(join(repo, '.shape', 'shape.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(repo, '.shape', 'auth.json'),
    `${JSON.stringify({ id: 'auth', title: 'Auth', children: [node ?? { id: 'auth/login', title: 'Login', coverage: 'verified' }] }, null, 2)}\n`,
  );
  return repo;
}

describe('budget digest bounds', () => {
  /**
   * Builds a map by writing .shape JSON directly: 5,000 areas is far past what
   * the CLI could add one command at a time.
   *
   * @param {(i: number) => object} makeArea
   * @param {number} count
   */
  function hugeRepo(count, makeArea) {
    const repo = tempRepo();
    mkdirSync(join(repo, '.shape'));
    const areas = [];
    for (let i = 0; i < count; i++) {
      const area = makeArea(i);
      areas.push(area.id);
      writeFileSync(join(repo, '.shape', `${area.id}.json`), JSON.stringify(area));
    }
    writeFileSync(
      join(repo, '.shape', 'shape.json'),
      JSON.stringify({ name: 'huge', schemaVersion: 2, areas }),
    );
    return repo;
  }

  it('a 5,000-area map renders under the 8,192-byte ceiling with exact hidden counts', () => {
    const repo = hugeRepo(5000, (i) => ({
      id: `area-${String(i).padStart(4, '0')}`,
      title: `Area ${i}`,
      children: [{ id: `area-${String(i).padStart(4, '0')}/leaf`, title: `Leaf ${i}`, coverage: 'missing' }],
    }));
    const digest = shape(repo, 'tree', '--compact', '--budget', '100');
    assert.ok(Buffer.byteLength(digest, 'utf8') <= 8192, `digest is ${Buffer.byteLength(digest, 'utf8')} bytes`);
    assert.ok(digest.includes('10000 nodes'), 'the total node count is honest');
    assert.ok(digest.includes('showing 20 of 5000 areas'), 'area cap and true area count both reported');
    assert.ok(digest.includes('+4980 more areas'), 'exact hidden area count');
    assert.ok(digest.includes('+4960 more open'), 'exact hidden open count (5000 open, 40 shown)');
    // The counts sit directly under the header, above any body line, so the
    // byte clamp can never be what removes them.
    assert.ok(digest.split('\n')[1].startsWith('(budget mode:'));
  });

  it('keeps the exact counts even when the byte ceiling truncates the body', () => {
    // Over the area cap AND carrying maximal text: both R10 guarantees have to
    // hold at once, which they cannot if the counts line renders last.
    const repo = hugeRepo(200, (i) => {
      const id = `area-${String(i).padStart(4, '0')}`;
      return {
        id,
        title: 'T'.repeat(200),
        children: [{ id: `${id}/leaf`, title: 'L'.repeat(200), coverage: 'gap', gap: 'G'.repeat(1000) }],
      };
    });
    const digest = shape(repo, 'tree', '--compact', '--budget', '10');
    const bytes = Buffer.byteLength(digest, 'utf8');
    assert.ok(bytes <= 8192, `digest is ${bytes} bytes`);
    assert.ok(digest.includes('showing 20 of 200 areas'), 'counts survive truncation');
    assert.ok(digest.includes('+180 more areas'), 'exact hidden area count survives truncation');
    assert.ok(digest.includes('+160 more open'), 'exact hidden open count survives truncation');
    assert.ok(digest.includes('truncated at 8192 bytes'), 'and the truncation is still declared');
  });

  it('the byte ceiling holds when every title and gap note is at its maximum length', () => {
    const repo = hugeRepo(200, (i) => {
      const id = `area-${String(i).padStart(4, '0')}`;
      return {
        id,
        title: 'T'.repeat(200),
        children: [{ id: `${id}/leaf`, title: 'L'.repeat(200), coverage: 'gap', gap: 'G'.repeat(1000) }],
      };
    });
    const digest = shape(repo, 'tree', '--compact', '--budget', '10');
    const bytes = Buffer.byteLength(digest, 'utf8');
    assert.ok(bytes <= 8192, `digest is ${bytes} bytes`);
    assert.ok(digest.includes('truncated at 8192 bytes'), 'truncation is declared, not silent');
    // Truncation lands on a line boundary: no line is cut mid-way, and the
    // marker is the last thing on the page.
    const lines = digest.trimEnd().split('\n');
    assert.ok(lines[lines.length - 1].startsWith('(truncated at'));
    assert.ok(lines[1].startsWith('(budget mode:'), 'counts precede the body');
    assert.ok(
      lines.slice(2, -1).every((line) => line.includes('G'.repeat(1000)) || /^ {2}\[/.test(line)),
      'every surviving body line is a complete rendered node line',
    );
  });

  it('ranks areas by open work descending, then by id, so two renders are byte-identical', () => {
    const repo = hugeRepo(40, (i) => {
      const id = `area-${String(i).padStart(4, '0')}`;
      // Areas 0-4 carry core-weighted open work; the rest carry one normal leaf.
      const importance = i < 5 ? 'core' : 'normal';
      return {
        id,
        title: `Area ${i}`,
        children: [{ id: `${id}/leaf`, title: `Leaf ${i}`, coverage: 'missing', importance }],
      };
    });
    const first = shape(repo, 'tree', '--compact', '--budget', '10');
    assert.equal(shape(repo, 'tree', '--compact', '--budget', '10'), first, 'rendering is deterministic');
    const areaLines = first.split('\n').filter((l) => /^ {2}\[/.test(l));
    assert.ok(areaLines[0].includes('area-0000'), 'heaviest open work first, id breaking the tie');
    assert.ok(areaLines[4].includes('area-0004'));
    assert.ok(areaLines[5].includes('area-0005'), 'equal-weight areas fall back to id order');
  });
});

describe('evidence path canonicalization', () => {
  it('refuses traversal, absolute, Windows drive, and UNC evidence paths', () => {
    const repo = seededRepo();
    for (const [spec, pattern] of [
      ['file:../outside.ts', /resolves outside the repo root/],
      ['file:src/../../outside.ts', /resolves outside the repo root/],
      ['file:/etc/passwd', /is absolute - evidence must be relative/],
      ['file:C:\\Windows\\system32.dll', /is absolute \(Windows drive\)/],
      ['file:\\\\server\\share\\x.ts', /is a UNC path/],
    ]) {
      assert.throws(
        () => shape(repo, 'set', 'auth/login', '--coverage', 'partial', '--evidence', spec),
        pattern,
        `expected ${spec} to be refused`,
      );
    }
  });

  it('canonicalizes ./ prefixes, backslashes, and interior dot segments on write', () => {
    const repo = seededRepo();
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'login.ts'), 'export const login = 1;\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'partial', '--evidence', 'file:./src/login.ts');
    assert.equal(JSON.parse(shape(repo, 'show', 'auth/login')).evidence[0].path, 'src/login.ts');

    shape(repo, 'set', 'auth/oauth-login', '--coverage', 'partial', '--evidence', 'file:src\\..\\src\\login.ts');
    assert.equal(JSON.parse(shape(repo, 'show', 'auth/oauth-login')).evidence[0].path, 'src/login.ts');
  });

  it('a legacy ./x evidence path still resolves and audits clean', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'partial', '--evidence', 'file:login.ts');
    // Rewrite the stored path to the uncanonical legacy form.
    const areaFile = join(repo, '.shape', 'auth.json');
    const area = JSON.parse(readFileSync(areaFile, 'utf8'));
    area.children.find((c) => c.id === 'auth/login').evidence[0].path = './login.ts';
    writeFileSync(areaFile, JSON.stringify(area, null, 2));
    assert.ok(shape(repo, 'audit').includes('audit clean'), 'canonical comparison finds the file');
  });

  it('a legacy out-of-root evidence path fails audit as suspect', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'partial', '--evidence', 'file:login.ts');
    const areaFile = join(repo, '.shape', 'auth.json');
    const area = JSON.parse(readFileSync(areaFile, 'utf8'));
    area.children.find((c) => c.id === 'auth/login').evidence[0].path = '../elsewhere/login.ts';
    writeFileSync(areaFile, JSON.stringify(area, null, 2));
    let output = '';
    try {
      shape(repo, 'audit');
    } catch (error) {
      output = error.stdout;
    }
    assert.ok(output.includes('SUSPECT auth/login: evidence path ../elsewhere/login.ts is not inside the repo'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[P?] auth/login'));
  });
});

describe('structural audit failures', () => {
  /** Writes a claim straight to disk that the CLI gates would now refuse. */
  function plantClaim(repo, node) {
    const areaFile = join(repo, '.shape', 'auth.json');
    const area = JSON.parse(readFileSync(areaFile, 'utf8'));
    Object.assign(area.children.find((c) => c.id === 'auth/login'), node);
    writeFileSync(areaFile, JSON.stringify(area, null, 2));
  }

  function auditOutput(repo) {
    try {
      return { output: shape(repo, 'audit'), failed: false };
    } catch (error) {
      return { output: error.stdout, failed: true };
    }
  }

  it('a claim tier with no evidence is suspect and fails the audit', () => {
    const repo = seededRepo();
    plantClaim(repo, { coverage: 'covered' });
    const { output, failed } = auditOutput(repo);
    assert.ok(failed, 'audit exits nonzero');
    assert.ok(output.includes('SUSPECT auth/login: covered with no evidence links'));
    assert.ok(!output.includes('WARN'), 'unevidenced claims are no longer mere warnings');
  });

  it('linked without named test evidence is suspect', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    // Fingerprint honestly via the CLI, then promote the level behind its back:
    // the evidence has not drifted, so only the structural rule can catch this.
    shape(repo, 'set', 'auth/login', '--coverage', 'covered', '--evidence', 'file:login.ts');
    plantClaim(repo, { coverage: 'linked' });
    const { output, failed } = auditOutput(repo);
    assert.ok(failed);
    assert.ok(output.includes('linked without named test evidence'));
  });

  it('claim-tier evidence lacking a fingerprint is suspect', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    plantClaim(repo, { coverage: 'covered', evidence: [{ type: 'file', path: 'login.ts' }] });
    const { output, failed } = auditOutput(repo);
    assert.ok(failed);
    assert.ok(output.includes('covered with unfingerprinted evidence login.ts'));
  });

  it('verified in a repo with no verify command is suspect', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'v.test.ts'), "test('v holds', () => {});\n");
    shape(repo, 'set', 'auth/login', '--coverage', 'linked', '--evidence', 'test:v.test.ts#v holds');
    // Promote to verified behind the CLI's back, exactly as a legacy map would.
    plantClaim(repo, { coverage: 'verified' });
    const { output, failed } = auditOutput(repo);
    assert.ok(failed);
    assert.ok(output.includes('verified with no verify command configured'));
  });

  it('partial claims are exempt from the claim-tier evidence rules', () => {
    const repo = seededRepo();
    plantClaim(repo, { coverage: 'partial' });
    assert.ok(shape(repo, 'audit').includes('audit clean'), 'partial does not assert the intent is realized');
  });
});

describe('coverage gates', () => {
  it('Sol spacecraft repro: restating intent and coverage in one call is refused without fresh evidence', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    assert.throws(
      () =>
        shape(
          repo,
          'set',
          'auth/login',
          '--intent',
          'WHEN a spacecraft docks THE SYSTEM SHALL equalize pressure',
          '--coverage',
          'covered',
        ),
      /changing --intent and --coverage together requires fresh --evidence/,
      'the old login evidence must not silently vouch for a spacecraft intent',
    );
    // The refusal is total: nothing about the node moved.
    const detail = JSON.parse(shape(repo, 'show', 'auth/login'));
    assert.ok(!detail.intent?.includes('spacecraft'));
  });

  it('the same-call rule applies only to nodes already carrying a verdict', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'fresh.ts'), 'export const fresh = 1;\n');
    // auth/oauth-login has no coverage yet, so there is no stale verdict to launder.
    shape(repo, 'set', 'auth/oauth-login', '--intent', 'WHEN a user picks OAuth THE SYSTEM SHALL redirect', '--coverage', 'covered', '--evidence', 'file:fresh.ts');
    assert.equal(JSON.parse(shape(repo, 'show', 'auth/oauth-login')).coverage, 'covered');
  });

  it('the same-call rule is satisfied by passing fresh evidence', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    writeFileSync(join(repo, 'rotate.ts'), 'export const rotate = 1;\n');
    shape(repo, 'set', 'auth/login', '--intent', 'WHEN a user logs in THE SYSTEM SHALL rotate the token', '--coverage', 'covered', '--evidence', 'file:rotate.ts');
    const detail = JSON.parse(shape(repo, 'show', 'auth/login'));
    assert.equal(detail.evidence[0].path, 'rotate.ts');
    assert.ok(!detail.suspect);
  });

  it('Sol README-heading repro: a heading that only looks like a test is linked at best, never verified', () => {
    const repo = seededRepo();
    // extractUnit finds this heading, so it is citable evidence - but no runner
    // is configured, so nothing can prove it passes.
    writeFileSync(join(repo, 'README.md'), '# Project\n\n## login works\n\nSome prose.\n');
    assert.throws(
      () => shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'test:README.md#login works'),
      /verified refused - no verify command configured/,
    );
    shape(repo, 'set', 'auth/login', '--coverage', 'linked', '--evidence', 'test:README.md#login works');
    assert.ok(shape(repo, 'tree', '--compact').includes('[L] auth/login'));
  });

  it('verified without a configured runner is refused, not warned about', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 't.test.mjs'), "test('t holds', () => {});\n");
    let stderr = '';
    assert.throws(
      () => {
        try {
          shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'test:t.test.mjs#t holds');
        } catch (error) {
          stderr = error.stderr;
          throw error;
        }
      },
      /verified refused - no verify command configured/,
    );
    assert.ok(stderr.includes('use --coverage linked'), 'the error offers the honest alternative');
    assert.ok(!stderr.includes('note: verified is unexecuted'), 'the old warning path is gone');
    assert.ok(shape(repo, 'tree', '--compact').includes('[M] auth/login'), 'nothing was written');
  });

  it('linked requires named test evidence, not a bare file or an unnamed test', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    assert.throws(
      () => shape(repo, 'set', 'auth/login', '--coverage', 'linked', '--evidence', 'file:login.ts'),
      /linked requires named test evidence/,
    );
    writeFileSync(join(repo, 'x.test.ts'), "test('x holds', () => {});\n");
    assert.throws(
      () => shape(repo, 'set', 'auth/login', '--coverage', 'linked', '--evidence', 'test:x.test.ts'),
      /linked requires named test evidence/,
      'an unnamed test file names nothing in particular',
    );
    shape(repo, 'set', 'auth/login', '--coverage', 'linked', '--evidence', 'test:x.test.ts#x holds');
    assert.ok(shape(repo, 'tree', '--compact').includes('[L] auth/login'));
  });

  it('linked requires evidence at all', () => {
    const repo = seededRepo();
    assert.throws(
      () => shape(repo, 'set', 'auth/login', '--coverage', 'linked'),
      /"linked" requires --evidence/,
    );
  });

  it('review is removed and points at the replacement', () => {
    const repo = seededRepo();
    assert.throws(
      () => shape(repo, 'review', 'auth/login'),
      /review was removed.*shape set <id> --coverage <level> --evidence/s,
    );
    assert.ok(!shape(repo, 'help').includes('review'), 'usage no longer advertises review');
  });
});

describe('schema v2 migration', () => {
  it('a v1 map never displays verified, even before any migration runs', () => {
    const repo = legacyRepo();
    const tree = shape(repo, 'tree', '--compact');
    assert.ok(tree.includes('[L] auth/login'), 'v1 verified reads as linked');
    assert.ok(!tree.includes('[V]'));
    assert.equal(
      JSON.parse(readFileSync(join(repo, '.shape', 'shape.json'), 'utf8')).schemaVersion,
      1,
      'a read-only command does not migrate on disk',
    );
  });

  it('migration keeps verified only when the cited test executes and passes', () => {
    const repo = legacyRepo({
      verifyCommand: 'node --test --test-name-pattern {name} {path}',
      node: {
        id: 'auth/login',
        title: 'Login',
        coverage: 'verified',
        evidence: [{ type: 'test', path: 'ok.test.mjs', name: 'login works' }],
      },
    });
    writeFileSync(
      join(repo, 'ok.test.mjs'),
      "import { test } from 'node:test';\ntest('login works', () => {});\n",
    );
    const output = shape(repo, 'add', 'auth', '--title', 'Other');
    assert.ok(output.includes('migrated .shape to schema 2: 1 verified re-proven by execution, 0 demoted to linked, 0 demoted to covered'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[V] auth/login'));
    assert.equal(JSON.parse(readFileSync(join(repo, '.shape', 'shape.json'), 'utf8')).schemaVersion, 2);
  });

  it('migration demotes a legacy verified whose cited test now fails', () => {
    const repo = legacyRepo({
      verifyCommand: 'node --test --test-name-pattern {name} {path}',
      node: {
        id: 'auth/login',
        title: 'Login',
        coverage: 'verified',
        evidence: [{ type: 'test', path: 'bad.test.mjs', name: 'login works' }],
      },
    });
    writeFileSync(
      join(repo, 'bad.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('login works', () => { assert.equal(1, 2); });\n",
    );
    const output = shape(repo, 'add', 'auth', '--title', 'Other');
    assert.ok(output.includes('0 verified re-proven by execution, 1 demoted to linked, 0 demoted to covered'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[L] auth/login'));
  });

  it('migration refuses to promote a passing but nameless test, settling at covered', () => {
    // A {name}-less template runs the whole file and exits zero, so execution
    // alone would promote this. The CLI would never accept the resulting state.
    const testBody = "import { test } from 'node:test';\ntest('login works', () => {});\n";
    const repo = legacyRepo({
      verifyCommand: 'node --test {path}',
      node: {
        id: 'auth/login',
        title: 'Login',
        coverage: 'verified',
        evidence: [
          {
            type: 'test',
            path: 'ok.test.mjs',
            hash: createHash('sha256').update(testBody).digest('hex').slice(0, 16),
          },
        ],
      },
    });
    writeFileSync(join(repo, 'ok.test.mjs'), testBody);
    const output = shape(repo, 'add', 'auth', '--title', 'Other');
    assert.ok(output.includes('0 verified re-proven by execution, 0 demoted to linked, 1 demoted to covered'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[C] auth/login'), 'nameless test evidence never supported more than covered');
    // Every state migration can produce is one the CLI's gates accept, so a
    // freshly migrated map audits clean rather than flagging itself.
    assert.ok(shape(repo, 'audit').includes('audit clean'));
  });

  it('migration demotes a named-test verified to linked when no verify command is configured', () => {
    const repo = legacyRepo({
      node: {
        id: 'auth/login',
        title: 'Login',
        coverage: 'verified',
        evidence: [{ type: 'test', path: 'ok.test.mjs', name: 'login works' }],
      },
    });
    writeFileSync(join(repo, 'ok.test.mjs'), "test('login works', () => {});\n");
    const output = shape(repo, 'add', 'auth', '--title', 'Other');
    assert.ok(output.includes('0 verified re-proven by execution, 1 demoted to linked, 0 demoted to covered (no verify command configured)'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[L] auth/login'));
  });

  it('migration settles a legacy verified carrying no evidence at all to covered', () => {
    const repo = legacyRepo();
    const output = shape(repo, 'add', 'auth', '--title', 'Other');
    assert.ok(output.includes('0 demoted to linked, 1 demoted to covered'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[C] auth/login'));
  });

  it('migration is idempotent: a second mutating run changes no bytes and prints no summary', () => {
    const repo = legacyRepo();
    shape(repo, 'add', 'auth', '--title', 'Other');
    const manifestPath = join(repo, '.shape', 'shape.json');
    const areaPath = join(repo, '.shape', 'auth.json');
    const before = [readFileSync(manifestPath, 'utf8'), readFileSync(areaPath, 'utf8')];
    const second = shape(repo, 'add', 'auth', '--title', 'Third');
    assert.ok(!second.includes('migrated .shape'), 'v2 map is a no-op');
    assert.equal(readFileSync(manifestPath, 'utf8'), before[0]);
    // The area file changes only by the node this call added, never by migration.
    const area = JSON.parse(readFileSync(areaPath, 'utf8'));
    assert.deepEqual(area.children.map((c) => c.coverage), ['covered', undefined, undefined]);
  });

  it('config --verify-command none demotes every verified node in the same write', () => {
    const repo = seededRepo();
    shape(repo, 'config', '--verify-command', 'node --test --test-name-pattern {name} {path}');
    writeFileSync(join(repo, 'login.mjs'), 'export const login = 1;\n');
    writeFileSync(
      join(repo, 'ok.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { login } from './login.mjs';\ntest('login works', () => { assert.equal(login, 1); });\n",
    );
    shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'test:ok.test.mjs#login works');
    const output = shape(repo, 'config', '--verify-command', 'none');
    assert.ok(output.includes('verify command cleared (1 verified node(s) demoted to linked)'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[L] auth/login'));
    assert.equal(JSON.parse(shape(repo, 'config')).verifyCommand, null);
  });

  it('init writes schemaVersion 2', () => {
    const repo = tempRepo();
    shape(repo, 'init', '--name', 'fresh');
    assert.equal(JSON.parse(readFileSync(join(repo, '.shape', 'shape.json'), 'utf8')).schemaVersion, 2);
  });
});

describe('shape CLI', () => {
  it('init + add + tree round-trips through the filesystem', () => {
    const repo = seededRepo();
    const tree = shape(repo, 'tree', '--compact');
    assert.equal(tree.split('\n')[0], 'shape demo 0% asserted (V 0 L 0 ?0)');
    assert.ok(tree.includes('[M] auth/login Login'));
    assert.ok(tree.includes('[M] auth/oauth-login OAuth Login'));
  });

  it('the tree header reports asserted percent with the verified/linked/suspect split', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'login.ts'), 'export const login = 1;\n');
    writeFileSync(join(repo, 'login.test.ts'), "test('login works', () => {});\n");
    shape(repo, 'set', 'auth/login', '--coverage', 'linked', '--evidence', 'test:login.test.ts#login works');
    assert.equal(
      shape(repo, 'tree', '--compact').split('\n')[0],
      'shape demo 50% asserted (V 0 L 1 ?0)',
    );
    // The non-compact header carries the identical split, only unprefixed.
    assert.equal(shape(repo, 'tree').split('\n')[0], 'demo 50% asserted (V 0 L 1 ?0)');
  });

  it('a suspect node shows in the header count without changing the asserted percent', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    shape(repo, 'set', 'auth/login', '--intent', 'WHEN a user logs in THE SYSTEM SHALL rotate the session');
    assert.equal(shape(repo, 'tree', '--compact').split('\n')[0], 'shape demo 50% asserted (V 0 L 0 ?1)');
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

  it('refuses covered without evidence and verified without named test evidence', () => {
    const repo = seededRepo();
    shape(repo, 'config', '--verify-command', 'node --test --test-name-pattern {name} {path}');
    assert.throws(() => shape(repo, 'set', 'auth/login', '--coverage', 'covered'), /requires --evidence/);
    writeFileSync(join(repo, 'login.mjs'), 'export const login = 1;\n');
    assert.throws(
      () => shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'file:login.mjs'),
      /verified requires named test evidence/,
    );
    writeFileSync(
      join(repo, 'login.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { login } from './login.mjs';\ntest('login works', () => { assert.equal(login, 1); });\n",
    );
    shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'file:login.mjs', '--evidence', 'test:login.test.mjs#login works');
    assert.ok(shape(repo, 'tree', '--compact').includes('[V] auth/login'));
  });

  it('renders linked leaves as [L] and rolls a mixed verified/linked parent up to [L]', () => {
    const repo = seededRepo();
    shape(repo, 'config', '--verify-command', 'node --test --test-name-pattern {name} {path}');
    writeFileSync(join(repo, 'login.mjs'), 'export const login = 1;\n');
    writeFileSync(
      join(repo, 'ok.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { login } from './login.mjs';\ntest('login works', () => { assert.equal(login, 1); });\n",
    );
    writeFileSync(join(repo, 'oauth.test.mjs'), "test('oauth works', () => {});\n");
    shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'test:ok.test.mjs#login works');
    shape(repo, 'set', 'auth/oauth-login', '--coverage', 'linked', '--evidence', 'test:oauth.test.mjs#oauth works');
    const tree = shape(repo, 'tree', '--compact');
    assert.ok(tree.includes('[V] auth/login'));
    assert.ok(tree.includes('[L] auth/oauth-login'));
    assert.ok(tree.includes('[L] auth Auth'), 'one unexecuted child pulls the parent down to linked');
  });

  it('--gaps treats linked as closed work and hides it', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'l.test.ts'), "test('l holds', () => {});\n");
    shape(repo, 'set', 'auth/login', '--coverage', 'linked', '--evidence', 'test:l.test.ts#l holds');
    const tree = shape(repo, 'tree', '--compact', '--gaps');
    assert.ok(!tree.includes('auth/login Login'));
    assert.ok(tree.includes('auth/oauth-login'));
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
    // Suspicion clears only by re-asserting the claim against fresh evidence.
    writeFileSync(join(repo, 'rotate.ts'), 'export const rotate = 1;\n');
    shape(repo, 'set', 'auth/login', '--coverage', 'covered', '--evidence', 'file:rotate.ts');
    assert.ok(shape(repo, 'tree', '--compact').includes('[C] auth/login'));
  });

  it('re-asserting coverage with fresh evidence alongside a new intent does not mark suspect', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    writeFileSync(join(repo, 'session.ts'), 'export const session = 1;\n');
    shape(repo, 'set', 'auth/login', '--intent', 'WHEN a user logs in THE SYSTEM SHALL create a session', '--coverage', 'partial', '--evidence', 'file:session.ts');
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
    assert.ok(readFileSync(join(withAgents, 'AGENTS.md'), 'utf8').includes('<!-- VIBESHAPE START -->'));

    const without = tempRepo();
    shape(without, 'init', '--name', 'demo');
    assert.equal(existsSync(join(without, 'AGENTS.md')), false);
    assert.ok(readFileSync(join(without, 'CLAUDE.md'), 'utf8').includes('<!-- VIBESHAPE START -->'));
  });

  it('snapshot writes a self-contained HTML file with embedded shape data', () => {
    const repo = seededRepo();
    shape(repo, 'snapshot');
    const html = readFileSync(join(repo, '.shape', 'snapshot.html'), 'utf8');
    assert.ok(html.includes('window.__SHAPE__'));
    assert.ok(html.includes('OAuth Login'));
    assert.ok(!/src="https?:|href="https?:/.test(html));
  });

  it('init appends the guidance block to an existing CLAUDE.md, preserving its content', () => {
    const repo = tempRepo();
    writeFileSync(join(repo, 'CLAUDE.md'), '# My project\n');
    shape(repo, 'init', '--name', 'demo');
    const content = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('# My project'));
    assert.ok(content.includes('<!-- VIBESHAPE START -->'));
    assert.equal(content.match(/VIBESHAPE START/g).length, 1);
  });

  it('init replaces a legacy APPSHAPE block instead of stacking a second one', () => {
    const repo = tempRepo();
    writeFileSync(
      join(repo, 'CLAUDE.md'),
      '# My project\n<!-- APPSHAPE START -->\nold guidance\n<!-- APPSHAPE END -->\ntrailing prose\n'
    );
    shape(repo, 'init', '--name', 'demo');
    const content = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('# My project'));
    assert.ok(content.includes('trailing prose'));
    assert.ok(!content.includes('APPSHAPE'));
    assert.ok(!content.includes('old guidance'));
    assert.equal(content.match(/VIBESHAPE START/g).length, 1);
  });

  it('audit flags a claim as suspect when its evidence file changes, re-asserting clears it', () => {
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

    // Re-asserting against the changed file re-fingerprints and clears suspicion.
    shape(repo, 'set', 'auth/login', '--coverage', 'covered', '--evidence', 'file:login.ts');
    assert.ok(shape(repo, 'audit').includes('audit clean'));
    assert.ok(shape(repo, 'tree', '--compact').includes('[C] auth/login'));
  });

  it('audit flags deleted evidence files and unevidenced covered claims as suspect', () => {
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
    assert.ok(output.includes('SUSPECT auth/oauth-login: covered with no evidence links'));
  });

  it('refuses evidence naming a unit that does not exist in the file', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'a.test.mjs'), "test('real thing', () => {});\n");
    assert.throws(
      () => shape(repo, 'set', 'auth/login', '--coverage', 'partial', '--evidence', 'test:a.test.mjs#fake name'),
      /"fake name" not found in a\.test\.mjs/,
    );
  });

  it('unit-scoped hashing: unrelated edits to an evidence file do not drift the claim', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'u.test.mjs'), "test('alpha holds', () => {\n  ok(1);\n});\ntest('beta holds', () => {\n  ok(2);\n});\n");
    shape(repo, 'set', 'auth/login', '--coverage', 'partial', '--evidence', 'test:u.test.mjs#alpha holds');
    writeFileSync(join(repo, 'u.test.mjs'), "test('alpha holds', () => {\n  ok(1);\n});\ntest('beta holds', () => {\n  ok(3);\n});\n");
    assert.ok(shape(repo, 'audit').includes('audit clean'));
    writeFileSync(join(repo, 'u.test.mjs'), "test('alpha holds', () => {\n  ok(99);\n});\ntest('beta holds', () => {\n  ok(3);\n});\n");
    let output = '';
    try {
      shape(repo, 'audit');
    } catch (error) {
      output = error.stdout;
    }
    assert.ok(output.includes('"alpha holds" in u.test.mjs changed since assessment'));
  });

  it('audit reports a named unit that vanished from its file', () => {
    const repo = seededRepo();
    writeFileSync(join(repo, 'v.test.mjs'), "test('gamma holds', () => {});\n");
    shape(repo, 'set', 'auth/login', '--coverage', 'partial', '--evidence', 'test:v.test.mjs#gamma holds');
    writeFileSync(join(repo, 'v.test.mjs'), "test('renamed entirely', () => {});\n");
    let output = '';
    try {
      shape(repo, 'audit');
    } catch (error) {
      output = error.stdout;
    }
    assert.ok(output.includes('"gamma holds" no longer found in v.test.mjs'));
  });

  it('with a verify command, verified requires the cited test to pass right now', () => {
    const repo = seededRepo();
    shape(repo, 'config', '--verify-command', 'node --test --test-name-pattern {name} {path}');
    writeFileSync(join(repo, 'login.mjs'), 'export const login = 1;\n');
    writeFileSync(
      join(repo, 'ok.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { login } from './login.mjs';\ntest('login works', () => { assert.equal(login, 1); });\n",
    );
    writeFileSync(
      join(repo, 'bad.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { login } from './login.mjs';\ntest('login breaks', () => { assert.equal(login, 2); });\n",
    );
    assert.throws(
      () => shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'file:login.mjs', '--evidence', 'test:bad.test.mjs#login breaks'),
      /verified refused/,
    );
    shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'file:login.mjs', '--evidence', 'test:ok.test.mjs#login works');
    assert.ok(shape(repo, 'tree', '--compact').includes('[V] auth/login'));
  });

  it('audit --run flags a verified node whose test now fails', () => {
    const repo = seededRepo();
    shape(repo, 'config', '--verify-command', 'node --test --test-name-pattern {name} {path}');
    writeFileSync(join(repo, 'login.mjs'), 'export const login = 1;\n');
    const realTest = "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { login } from './login.mjs';\ntest('rotates fine', () => { assert.equal(login, 1); });\n";
    writeFileSync(join(repo, 'r.test.mjs'), realTest);
    // Cite only the test: the regression below then lands in a file no hash
    // covers, so nothing but execution can catch it.
    shape(repo, 'set', 'auth/login', '--coverage', 'verified', '--evidence', 'test:r.test.mjs#rotates fine');
    let output = '';
    try {
      output = shape(repo, 'audit', '--run');
    } catch (error) {
      output = error.stdout;
    }
    assert.ok(output.includes('audit clean'), 'passing test stays clean under --run');
    // Regress the code the test asserts against, not the test itself.
    writeFileSync(join(repo, 'login.mjs'), 'export const login = 2;\n');
    try {
      shape(repo, 'audit', '--run');
      output = '';
    } catch (error) {
      output = error.stdout;
    }
    assert.ok(output.includes('test run failed'), 'failing test marks the node suspect');
    assert.ok(shape(repo, 'tree', '--compact').includes('[V?] auth/login'));
  });

  it('a clean audit leaves area files untouched (no mtime churn)', () => {
    const repo = seededRepo();
    markCovered(repo, 'auth/login');
    const areaFile = join(repo, '.shape', 'auth.json');
    const before = statSync(areaFile).mtimeMs;
    assert.ok(shape(repo, 'audit').includes('audit clean'));
    assert.equal(statSync(areaFile).mtimeMs, before);
  });

  it('prime output is budget-capped like injection', () => {
    const repo = tempRepo();
    shape(repo, 'init', '--name', 'huge');
    const children = Array.from({ length: 130 }, (_, i) => ({ id: `zone/n-${i}`, title: `N ${i}` }));
    writeFileSync(join(repo, '.shape', 'zone.json'), JSON.stringify({ id: 'zone', title: 'Zone', children }));
    writeFileSync(join(repo, '.shape', 'shape.json'), JSON.stringify({ name: 'huge', schemaVersion: 1, areas: ['zone'] }));
    const prime = shape(repo, 'prime');
    assert.ok(prime.includes('budget mode'), 'prime engages the budget digest');
    assert.ok(prime.split('\n').length < 80, `prime stays capped (${prime.split('\n').length} lines)`);
  });

  it('budget digest caps open work at the top importance-sorted items', () => {
    const repo = tempRepo();
    shape(repo, 'init', '--name', 'big');
    shape(repo, 'add', '/', '--title', 'Zone');
    shape(repo, 'add', 'zone', '--title', 'Vital', '--importance', 'core');
    for (let i = 0; i < 60; i++) shape(repo, 'add', 'zone', '--title', `Item ${i}`);
    const digest = shape(repo, 'tree', '--compact', '--budget', '10');
    const lines = digest.split('\n');
    assert.ok(lines.length < 50, `digest stays capped (got ${lines.length} lines)`);
    assert.ok(digest.includes('+21 more open'), 'hidden count reported');
    assert.ok(digest.includes('showing 1 of 1 areas'), 'no areas hidden when they fit under the cap');
    const firstOpenItem = lines.findIndex((l) => l.includes('zone/'));
    assert.ok(lines[firstOpenItem].includes('zone/vital'), 'core item sorts first among open work');
  });

  it('sanitizes control characters out of text fields and caps their length', () => {
    const repo = seededRepo();
    shape(repo, 'set', 'auth/login', '--gap', 'broken\x1b[31m over\u200Btwo\nlines');
    const detail = JSON.parse(shape(repo, 'show', 'auth/login'));
    assert.equal(detail.gap, 'broken [31m over two lines');
    assert.throws(() => shape(repo, 'set', 'auth/login', '--gap', 'x'.repeat(1200)), /max 1000/);
  });

  it('rejects a malformed explicit --id instead of corrupting the map', () => {
    const repo = seededRepo();
    assert.throws(() => shape(repo, 'add', 'auth', '--title', 'Bad', '--id', 'UPPER CASE!'), /kebab-case slug/);
    assert.ok(shape(repo, 'tree', '--compact').includes('[M] auth/login'));
  });

  it('init refuses to create a nested map inside an existing one', () => {
    const repo = tempRepo();
    shape(repo, 'init', '--name', 'outer');
    const sub = join(repo, 'packages', 'web');
    mkdirSync(sub, { recursive: true });
    assert.throws(() => shape(sub, 'init', '--name', 'inner'), /already inside the vibeshape map/);
    assert.equal(existsSync(join(sub, '.shape')), false);
  });

  it('init writes a .shape/.gitignore covering generated files', () => {
    const repo = tempRepo();
    shape(repo, 'init', '--name', 'demo');
    const ignore = readFileSync(join(repo, '.shape', '.gitignore'), 'utf8');
    assert.ok(ignore.includes('snapshot.html'));
    assert.ok(ignore.includes('.lock/'));
  });

  it('refuses a slug segment longer than 64 characters', () => {
    const repo = seededRepo();
    const long = 'a'.repeat(65);
    assert.throws(
      () => shape(repo, 'add', 'auth', '--title', 'Long', '--id', long),
      /id "a{65}" is 65 chars \(max 64\)/,
    );
    assert.equal(shape(repo, 'add', 'auth', '--title', 'Long', '--id', 'a'.repeat(64)).trim(), `added auth/${'a'.repeat(64)}`);
  });

  it('refuses to load a map whose stored id exceeds the segment cap', () => {
    const repo = seededRepo();
    const long = 'b'.repeat(65);
    writeFileSync(
      join(repo, '.shape', 'auth.json'),
      JSON.stringify({ id: 'auth', title: 'Auth', children: [{ id: `auth/${long}`, title: 'Long' }] }),
    );
    assert.throws(() => shape(repo, 'tree'), new RegExp(`segment "b{65}" is 65 chars \\(max 64\\)`));
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
