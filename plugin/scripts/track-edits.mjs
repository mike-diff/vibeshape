// PostToolUse (Write|Edit|MultiEdit): record edited files into a session
// ledger so the injector can flag edits that no shape node references.
// The audit verifies claims made; this closes the omission side.
// Append-only: parallel hook invocations must never lose each other's lines.
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { findShapeRootOrNull } from '../lib/repo.mjs';
import { readHookInput } from '../lib/hook-input.mjs';

const input = readHookInput();
if (!input) process.exit(0);

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

const repoRoot = findShapeRootOrNull(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
if (!repoRoot) process.exit(0);

const rel = relative(repoRoot, filePath);
if (rel.startsWith('..') || rel.startsWith('.shape/') || rel.startsWith('.claude/')) process.exit(0);

const sessionKey = createHash('sha256')
  .update(`${repoRoot}\n${input.session_id ?? ''}`)
  .digest('hex')
  .slice(0, 16);
appendFileSync(join(tmpdir(), `appshape-edits-${sessionKey}`), `${rel}\n`);
