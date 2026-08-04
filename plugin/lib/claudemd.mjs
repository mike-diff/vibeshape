import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const START = '<!-- VIBESHAPE START -->';
const END = '<!-- VIBESHAPE END -->';
// Blocks written before the rename to vibeshape; found and replaced in place
// so re-running init never stacks a second block.
const LEGACY_MARKERS = [['<!-- APPSHAPE START -->', '<!-- APPSHAPE END -->']];
const BLOCK = `${START}
This repo has a vibeshape coverage map in \`.shape/\` - a living tree of intended
features scored against the code. For every feature-related task: consult it
(\`shape tree --compact\`), steer toward gaps, and update the nodes you affect
(\`shape set ...\`). Never edit \`.shape/*.json\` directly - use the \`shape\` CLI.
Run \`shape prime\` for full usage.
${END}`;
/**
 * Installs or refreshes the delimited vibeshape block in a guidance file
 * (CLAUDE.md, AGENTS.md). Upgrade-safe: re-running replaces only the block.
 */
export function upsertGuidanceBlock(repoRoot, filename, options) {
    const file = join(repoRoot, filename);
    if (!existsSync(file)) {
        if (!options.createIfMissing)
            return 'skipped';
        writeFileSync(file, `${BLOCK}\n`);
        return 'added';
    }
    const content = readFileSync(file, 'utf8');
    for (const [startMarker, endMarker] of [[START, END], ...LEGACY_MARKERS]) {
        const start = content.indexOf(startMarker);
        const end = content.indexOf(endMarker);
        if (start !== -1 && end > start) {
            writeFileSync(file, content.slice(0, start) + BLOCK + content.slice(end + endMarker.length));
            return 'updated';
        }
    }
    writeFileSync(file, `${content.trimEnd()}\n\n${BLOCK}\n`);
    return 'added';
}
