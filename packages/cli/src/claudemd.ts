import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const START = '<!-- APPSHAPE START -->';
const END = '<!-- APPSHAPE END -->';
const BLOCK = `${START}
This repo has an appshape coverage map in \`.shape/\` - a living tree of intended
features scored against the code. For every feature-related task: consult it
(\`shape tree --compact\`), steer toward gaps, and update the nodes you affect
(\`shape set ...\`). Never edit \`.shape/*.json\` directly - use the \`shape\` CLI.
Run \`shape prime\` for full usage.
${END}`;

/** Installs or refreshes the delimited appshape block in CLAUDE.md. */
export function upsertClaudeMdBlock(repoRoot: string): 'added' | 'updated' {
  const file = join(repoRoot, 'CLAUDE.md');
  if (!existsSync(file)) {
    writeFileSync(file, `${BLOCK}\n`);
    return 'added';
  }
  const content = readFileSync(file, 'utf8');
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start !== -1 && end > start) {
    writeFileSync(file, content.slice(0, start) + BLOCK + content.slice(end + END.length));
    return 'updated';
  }
  writeFileSync(file, `${content.trimEnd()}\n\n${BLOCK}\n`);
  return 'added';
}
