/**
 * Parses `shape <command> [positionals] [--flag [value]]...`.
 * `--dir <path>` is accepted anywhere and returned like any other flag.
 */
export function parseArgs(argv, spec) {
    const flags = new Map();
    const positionals = [];
    let command = '';
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const name = arg.slice(2);
            if (spec.boolean.includes(name)) {
                flags.set(name, true);
            }
            else if (spec.value.includes(name) || name === 'dir') {
                const value = argv[++i];
                if (value === undefined || value.startsWith('--')) {
                    throw new Error(`--${name} requires a value`);
                }
                const existing = flags.get(name);
                if (Array.isArray(existing))
                    existing.push(value);
                else
                    flags.set(name, [value]);
            }
            else {
                throw new Error(`unknown option --${name}`);
            }
        }
        else if (!command) {
            command = arg;
        }
        else {
            positionals.push(arg);
        }
    }
    return { command, positionals, flags };
}
export function strFlag(parsed, name) {
    const value = parsed.flags.get(name);
    return Array.isArray(value) ? value[value.length - 1] : undefined;
}
export function listFlag(parsed, name) {
    const value = parsed.flags.get(name);
    return Array.isArray(value) ? value : [];
}
export function boolFlag(parsed, name) {
    return parsed.flags.get(name) === true;
}
export function requireFlag(parsed, name) {
    const value = strFlag(parsed, name);
    if (value === undefined)
        throw new Error(`--${name} is required`);
    return value;
}
export function intFlag(parsed, name) {
    const value = strFlag(parsed, name);
    if (value === undefined)
        return undefined;
    const parsed_ = Number.parseInt(value, 10);
    if (Number.isNaN(parsed_))
        throw new Error(`--${name} must be a number`);
    return parsed_;
}
export function enumFlag(parsed, name, allowed) {
    const value = strFlag(parsed, name);
    if (value === undefined)
        return undefined;
    if (!allowed.includes(value)) {
        throw new Error(`invalid ${name} "${value}" (allowed: ${allowed.join(', ')})`);
    }
    return value;
}
export function requirePositionals(parsed, names) {
    if (parsed.positionals.length < names.length) {
        throw new Error(`usage: shape ${parsed.command} ${names.map((n) => `<${n}>`).join(' ')}`);
    }
    return parsed.positionals;
}
