import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Short content hash of a repo-relative file, or null if unreadable. */
export function hashFile(repoRoot: string, relativePath: string): string | null {
  try {
    const content = readFileSync(join(repoRoot, relativePath));
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}
