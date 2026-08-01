// PostToolUse (Write|Edit|MultiEdit): record edited files into a session
// ledger so the injector can flag edits that no shape node references.
// The audit verifies claims made; this closes the omission side.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

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

const rel = relative(repoRoot, filePath);
if (rel.startsWith('..') || rel.startsWith('.shape/') || rel.startsWith('.claude/')) process.exit(0);

const sessionKey = createHash('sha256')
  .update(`${repoRoot}\n${input.session_id ?? ''}`)
  .digest('hex')
  .slice(0, 16);
const ledgerPath = join(tmpdir(), `appshape-ledger-${sessionKey}`);
let ledger = {};
try {
  ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
} catch {
  // first edit this session
}
if (ledger[rel] === undefined) {
  ledger[rel] = { nudged: false };
  writeFileSync(ledgerPath, JSON.stringify(ledger));
}
