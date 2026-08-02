import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPTS = join(import.meta.dirname, '..', 'plugin', 'scripts');
const CLI = join(import.meta.dirname, '..', 'plugin', 'bin', 'shape.mjs');
const tempDirs = [];
let sessionCounter = 0;

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'appshape-hooks-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs a hook script the way Claude Code does: JSON on stdin, JSON or nothing on stdout. */
function hook(script, payload) {
  const stdout = execFileSync(process.execPath, [join(SCRIPTS, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return stdout.trim() === '' ? null : JSON.parse(stdout);
}

function shape(repo, ...args) {
  execFileSync(process.execPath, [CLI, '--dir', repo, ...args], { encoding: 'utf8' });
}

function mappedRepo() {
  const repo = tempRepo();
  shape(repo, 'init', '--name', 'hooks');
  shape(repo, 'add', '/', '--title', 'Area');
  shape(repo, 'add', 'area', '--title', 'One');
  writeFileSync(join(repo, 'mapped.ts'), 'export const one = 1;\n');
  shape(repo, 'set', 'area/one', '--coverage', 'covered', '--evidence', 'file:mapped.ts');
  return repo;
}

function session(repo) {
  return { cwd: repo, session_id: `hooks-test-${process.pid}-${sessionCounter++}` };
}

describe('guard-shape-writes hook', () => {
  it('denies direct writes to .shape JSON with a reason naming the CLI', () => {
    const out = hook('guard-shape-writes.mjs', {
      tool_name: 'Edit',
      tool_input: { file_path: '/some/repo/.shape/area.json' },
    });
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /shape add\/set\/rm\/mv/);
  });

  it('stays silent for writes outside .shape', () => {
    assert.equal(hook('guard-shape-writes.mjs', { tool_name: 'Edit', tool_input: { file_path: '/some/repo/src/app.ts' } }), null);
  });
});

describe('inject-tree hook', () => {
  it('injects the full orientation on first prompt, then goes silent while unchanged', () => {
    const repo = mappedRepo();
    const s = session(repo);
    const first = hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    assert.match(first.hookSpecificOutput.additionalContext, /appshape coverage map/);
    assert.match(first.hookSpecificOutput.additionalContext, /area\/one/);
    assert.equal(hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' }), null);
  });

  it('re-injects the compact tree when the map changes', () => {
    const repo = mappedRepo();
    const s = session(repo);
    hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    shape(repo, 'add', 'area', '--title', 'Two');
    const next = hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    assert.match(next.hookSpecificOutput.additionalContext, /Current app shape/);
    assert.match(next.hookSpecificOutput.additionalContext, /area\/two/);
  });

  it('stays silent when no map exists', () => {
    assert.equal(hook('inject-tree.mjs', { cwd: tempRepo(), session_id: 'none', hook_event_name: 'UserPromptSubmit' }), null);
  });
});

describe('omission nudge', () => {
  it('nudges once about edited files no node references, never about mapped ones', () => {
    const repo = mappedRepo();
    const s = session(repo);
    hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    hook('track-edits.mjs', { ...s, tool_input: { file_path: join(repo, 'unmapped.ts') } });
    hook('track-edits.mjs', { ...s, tool_input: { file_path: join(repo, 'mapped.ts') } });
    const nudge = hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    assert.match(nudge.hookSpecificOutput.additionalContext, /referenced by no shape node: unmapped\.ts/);
    assert.ok(!nudge.hookSpecificOutput.additionalContext.includes('mapped.ts,'));
    assert.equal(hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' }), null);
  });

  it('does not deliver nudges on SessionStart (resume race)', () => {
    const repo = mappedRepo();
    const s = session(repo);
    hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    hook('track-edits.mjs', { ...s, tool_input: { file_path: join(repo, 'unmapped.ts') } });
    assert.equal(hook('inject-tree.mjs', { ...s, hook_event_name: 'SessionStart' }), null);
    const prompt = hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    assert.match(prompt.hookSpecificOutput.additionalContext, /unmapped\.ts/);
  });

  it('survives parallel edit recording without losing entries (append-only ledger)', () => {
    const repo = mappedRepo();
    const s = session(repo);
    hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    for (let i = 0; i < 6; i++) {
      hook('track-edits.mjs', { ...s, tool_input: { file_path: join(repo, `file-${i}.ts`) } });
    }
    const nudge = hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    for (let i = 0; i < 6; i++) {
      assert.ok(nudge.hookSpecificOutput.additionalContext.includes(`file-${i}.ts`), `file-${i}.ts recorded`);
    }
  });

  it('ignores edits to .shape and .claude internals', () => {
    const repo = mappedRepo();
    const s = session(repo);
    hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' });
    hook('track-edits.mjs', { ...s, tool_input: { file_path: join(repo, '.shape', 'area.json') } });
    hook('track-edits.mjs', { ...s, tool_input: { file_path: join(repo, '.claude', 'settings.json') } });
    assert.equal(hook('inject-tree.mjs', { ...s, hook_event_name: 'UserPromptSubmit' }), null);
  });
});

describe('remind-delegation hook', () => {
  it('reminds about subagent briefs only when a map exists', () => {
    const repo = mappedRepo();
    const out = hook('remind-delegation.mjs', { cwd: repo, tool_name: 'Task' });
    assert.match(out.hookSpecificOutput.additionalContext, /Delegation check/);
    assert.equal(hook('remind-delegation.mjs', { cwd: tempRepo(), tool_name: 'Task' }), null);
  });
});
