// UserPromptSubmit + SessionStart: inject the compact shape tree into context.
// Gated: full orientation once per session, then only when the tree changed
// or the last injection is older than REINJECT_MS (agents drift mid-session).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const REINJECT_MS = 10 * 60_000;

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // no stdin - proceed with env fallbacks
}

let dir = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
let repoRoot = null;
for (;;) {
  if (existsSync(join(dir, '.shape', 'shape.json'))) {
    repoRoot = dir;
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
if (!repoRoot) process.exit(0);

const pluginRoot = process.argv[2] ?? process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) process.exit(0);
const shapeBin = join(pluginRoot, 'bin', 'shape');

function shape(...args) {
  return execFileSync(shapeBin, ['--dir', repoRoot, ...args], { encoding: 'utf8' });
}

let tree;
try {
  // Budget mode: past 120 nodes the render degrades to area lines plus open
  // work, keeping per-prompt injection cost flat on large maps.
  tree = shape('tree', '--compact', '--budget', '120');
} catch {
  process.exit(0); // never block the prompt on a broken shape
}

const sessionKey = createHash('sha256')
  .update(`${repoRoot}\n${input.session_id ?? ''}`)
  .digest('hex')
  .slice(0, 16);
const marker = join(tmpdir(), `appshape-${sessionKey}`);
const treeHash = createHash('sha256').update(tree).digest('hex').slice(0, 16);

// Omission check: edited files (recorded by track-edits.mjs) that no node's
// evidence references. Nudged at most once per file per session.
const ledgerPath = join(tmpdir(), `appshape-ledger-${sessionKey}`);
let omissionNote = '';
try {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const pending = Object.keys(ledger).filter((f) => !ledger[f].nudged);
  if (pending.length > 0) {
    const referenced = evidencePaths(repoRoot);
    const unmapped = pending.filter((f) => !referenced.has(f));
    for (const f of pending) ledger[f].nudged = true;
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    if (unmapped.length > 0) {
      omissionNote =
        `\nEdited this session but referenced by no shape node: ${unmapped.slice(0, 6).join(', ')}` +
        `${unmapped.length > 6 ? ` (+${unmapped.length - 6} more)` : ''}. ` +
        'If user-facing behavior changed, add or update the covering nodes (shape add / shape set --evidence); if not, ignore.';
    }
  }
} catch {
  // no ledger yet
}

function evidencePaths(root) {
  const paths = new Set();
  const shapeDir = join(root, '.shape');
  for (const file of readdirSync(shapeDir)) {
    if (!file.endsWith('.json') || file === 'shape.json') continue;
    try {
      collect(JSON.parse(readFileSync(join(shapeDir, file), 'utf8')), paths);
    } catch {
      // skip unreadable area files
    }
  }
  return paths;
}

function collect(node, paths) {
  for (const e of node.evidence ?? []) paths.add(e.path);
  for (const child of node.children ?? []) collect(child, paths);
}

let last = null;
try {
  last = { hash: readFileSync(marker, 'utf8').trim(), ageMs: Date.now() - statSync(marker).mtimeMs };
} catch {
  // first injection this session
}
if (last && last.hash === treeHash && last.ageMs < REINJECT_MS && !omissionNote) process.exit(0);
writeFileSync(marker, treeHash);

const context =
  (last
    ? `Current app shape (consult before choosing work; update affected nodes with the shape CLI):\n${tree}`
    : shape('prime')) + omissionNote;
const eventName = input.hook_event_name === 'SessionStart' ? 'SessionStart' : 'UserPromptSubmit';
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: context } }));
