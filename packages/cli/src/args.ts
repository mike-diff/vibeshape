export interface ParsedArgs {
  command: string;
  positionals: string[];
  /** true for boolean flags; string[] for value flags (repeatable). */
  flags: Map<string, true | string[]>;
}

export interface FlagSpec {
  /** Flags that take a value; all are repeatable, most read only the last. */
  value: string[];
  boolean: string[];
}

/**
 * Parses `shape <command> [positionals] [--flag [value]]...`.
 * `--dir <path>` is accepted anywhere and returned like any other flag.
 */
export function parseArgs(argv: string[], spec: FlagSpec): ParsedArgs {
  const flags = new Map<string, true | string[]>();
  const positionals: string[] = [];
  let command = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (spec.boolean.includes(name)) {
        flags.set(name, true);
      } else if (spec.value.includes(name) || name === 'dir') {
        const value = argv[++i];
        if (value === undefined || value.startsWith('--')) {
          throw new Error(`--${name} requires a value`);
        }
        const existing = flags.get(name);
        if (Array.isArray(existing)) existing.push(value);
        else flags.set(name, [value]);
      } else {
        throw new Error(`unknown option --${name}`);
      }
    } else if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

export function strFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return Array.isArray(value) ? value[value.length - 1] : undefined;
}

export function listFlag(parsed: ParsedArgs, name: string): string[] {
  const value = parsed.flags.get(name);
  return Array.isArray(value) ? value : [];
}

export function boolFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.get(name) === true;
}

export function requireFlag(parsed: ParsedArgs, name: string): string {
  const value = strFlag(parsed, name);
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

export function intFlag(parsed: ParsedArgs, name: string): number | undefined {
  const value = strFlag(parsed, name);
  if (value === undefined) return undefined;
  const parsed_ = Number.parseInt(value, 10);
  if (Number.isNaN(parsed_)) throw new Error(`--${name} must be a number`);
  return parsed_;
}

export function enumFlag<T extends string>(parsed: ParsedArgs, name: string, allowed: readonly T[]): T | undefined {
  const value = strFlag(parsed, name);
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) {
    throw new Error(`invalid ${name} "${value}" (allowed: ${allowed.join(', ')})`);
  }
  return value as T;
}

export function requirePositionals(parsed: ParsedArgs, names: string[]): string[] {
  if (parsed.positionals.length < names.length) {
    throw new Error(`usage: shape ${parsed.command} ${names.map((n) => `<${n}>`).join(' ')}`);
  }
  return parsed.positionals;
}
