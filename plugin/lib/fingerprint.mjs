import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Short content hash of a repo-relative file, or null if unreadable. */
export function hashFile(repoRoot, relativePath) {
    try {
        const content = readFileSync(join(repoRoot, relativePath));
        return createHash('sha256').update(content).digest('hex').slice(0, 16);
    }
    catch {
        return null;
    }
}

/**
 * Extracts the block of text belonging to a named unit (a test, a function)
 * using a language-agnostic heuristic: from the first line containing `name`,
 * follow brace balance when the block is brace-delimited, otherwise stop at
 * the first non-empty line that dedents back to the starting indentation.
 * Returns null when the name does not appear at all.
 */
export function extractUnit(text, name) {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line.includes(name));
    if (start === -1) return null;
    const baseIndent = indentOf(lines[start]);
    const out = [];
    let depth = 0;
    let braced = false;
    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        if (!braced && i > start && line.trim() && indentOf(line) <= baseIndent) break;
        out.push(line);
        for (const ch of line) {
            if (ch === '{') {
                depth++;
                braced = true;
            }
            else if (ch === '}') {
                depth--;
            }
        }
        if (braced && depth <= 0) break;
    }
    return out.join('\n');
}

function indentOf(line) {
    return line.length - line.trimStart().length;
}

/**
 * Hash of the evidence the assessment actually cites: the named unit when a
 * name is given (so unrelated edits to the same file do not invalidate the
 * claim), the whole file otherwise. Returns null when the file is unreadable
 * or the named unit is not present.
 */
export function evidenceHash(repoRoot, relativePath, name) {
    if (!name) return hashFile(repoRoot, relativePath);
    let text;
    try {
        text = readFileSync(join(repoRoot, relativePath), 'utf8');
    }
    catch {
        return null;
    }
    const unit = extractUnit(text, name);
    if (unit === null) return null;
    return createHash('sha256').update(unit).digest('hex').slice(0, 16);
}
