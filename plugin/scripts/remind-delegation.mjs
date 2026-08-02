// PreToolUse (Task): subagents never receive the shape injection, so remind
// the lead at the exact delegation moment to carry the map into the brief.
import { readFileSync } from 'node:fs';
import { findShapeRootOrNull } from '../lib/repo.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

if (!findShapeRootOrNull(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd())) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext:
        'Delegation check: this repo has an appshape map, and subagents do not receive it automatically. ' +
        'If this teammate will build or change features, include the relevant shape node ids and intents in its prompt, ' +
        'and apply resulting coverage updates via the shape CLI when it reports back.',
    },
  }),
);
