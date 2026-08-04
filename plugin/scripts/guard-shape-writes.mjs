// PreToolUse guard: .shape/*.json is CLI-managed; direct edits corrupt the map.
// Covers file tools (Write|Edit|MultiEdit) and common Bash write patterns.
// This is a guardrail against the default edit paths, not a security boundary.
import { posix } from 'node:path';
import { readHookInput } from '../lib/hook-input.mjs';

const input = readHookInput();
if (!input) process.exit(0);

const SHAPE_JSON = /(^|\/)\.shape\/[^/]+\.json$/;

function isShapeJson(rawPath) {
  // Normalize separators and dot segments so `.shape/./x.json` and
  // `.shape/a/../x.json` cannot slip past the pattern.
  return SHAPE_JSON.test(posix.normalize(rawPath.replaceAll('\\', '/')));
}

let target = null;

const filePath = input.tool_input?.file_path;
if (filePath && isShapeJson(filePath)) target = filePath;

const command = input.tool_input?.command;
if (!target && typeof command === 'string') {
  const normalized = command.replaceAll('\\', '/');
  const mentionsShapeJson = /\.shape\/[^\s'"|;&]*\.json/.test(normalized);
  const writeIndicator =
    /(^|[\s|;&(])(rm|mv|cp|tee|truncate|sed\s+(-\S+\s+)*-i|perl\s+(-\S+\s+)*-i)\b[^|;&]*\.shape\/[^\s'"|;&]*\.json/.test(normalized) ||
    />{1,2}\s*['"]?[^\s'"]*\.shape\/[^\s'"]*\.json/.test(normalized);
  if (mentionsShapeJson && writeIndicator) target = 'a .shape/*.json file via shell';
}

if (!target) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `${target} is managed by the shape CLI - direct edits bypass validation and locking. ` +
        'Use shape add/set/rm/mv instead (run "shape prime" for usage).',
    },
  }),
);
