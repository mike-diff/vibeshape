// Hook stdin is attacker-adjacent: any process that can write our fd 0 chooses
// these values. Parse once, accept only a plain object whose known fields carry
// the expected type, and hand callers null otherwise so every hook can exit 0
// silently. A wrong-typed field is a rejection, never a fallback: {cwd: 7} must
// not degrade into "no cwd" and pick up process.cwd().
import { readFileSync } from 'node:fs';

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typedOrMissing(container, key, check) {
    return container[key] === undefined || check(container[key]);
}

const isString = (v) => typeof v === 'string';

function isValidInput(input) {
    if (!isPlainObject(input))
        return false;
    for (const key of ['cwd', 'session_id', 'hook_event_name', 'tool_name']) {
        if (!typedOrMissing(input, key, isString))
            return false;
    }
    if (!typedOrMissing(input, 'tool_input', isPlainObject))
        return false;
    const toolInput = input.tool_input ?? {};
    return typedOrMissing(toolInput, 'file_path', isString) && typedOrMissing(toolInput, 'command', isString);
}

/** Reads and validates the hook payload on fd 0; null means "do nothing". */
export function readHookInput() {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(0, 'utf8'));
    }
    catch {
        return null;
    }
    return isValidInput(parsed) ? parsed : null;
}
