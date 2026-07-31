// PreToolUse guard: .shape/*.json is CLI-managed; direct edits corrupt the map.
import { readFileSync } from 'node:fs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const filePath = (input.tool_input?.file_path ?? '').replaceAll('\\', '/');
if (!/(^|\/)\.shape\/[^/]+\.json$/.test(filePath)) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `${filePath} is managed by the shape CLI - direct edits bypass validation and locking. ` +
        'Use shape add/set/rm/mv instead (run "shape prime" for usage).',
    },
  }),
);
