import { normalize } from 'node:path/posix';
import { EVIDENCE_TYPES } from './types.mjs';
import { evidenceHash, hashFile } from './fingerprint.mjs';

/**
 * The one place an evidence path becomes canonical: repo-relative, forward
 * slashed, no leading `./`. Everything that escapes the repo root is refused
 * rather than normalized, because evidence the audit cannot re-read is
 * evidence that can never be checked again.
 *
 * Symlink containment is a stated non-goal: this is a textual containment
 * check, not a filesystem one.
 */
export function canonicalizeEvidencePath(raw) {
  const slashed = raw.replaceAll('\\', '/');
  if (/^[a-zA-Z]:/.test(raw)) {
    throw new Error(`evidence path "${raw}" is absolute (Windows drive) - evidence must be relative to the repo root`);
  }
  if (slashed.startsWith('//')) {
    throw new Error(`evidence path "${raw}" is a UNC path - evidence must be relative to the repo root`);
  }
  if (slashed.startsWith('/')) {
    throw new Error(`evidence path "${raw}" is absolute - evidence must be relative to the repo root`);
  }
  const normalized = normalize(slashed).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`evidence path "${raw}" resolves outside the repo root - evidence must live in the repo it describes`);
  }
  if (!normalized || normalized === '.') {
    throw new Error(`evidence path "${raw}" is empty after normalization`);
  }
  return normalized;
}
/**
 * Parses an evidence spec of the form `type:path` or `type:path#name`,
 * e.g. `file:src/auth/oauth.ts`, `test:tests/auth.test.ts#oauth login`.
 */
export function parseEvidenceSpec(spec) {
    const colon = spec.indexOf(':');
    if (colon === -1) {
        throw new Error(`evidence "${spec}" must be type:path (types: ${EVIDENCE_TYPES.join(', ')})`);
    }
    const type = spec.slice(0, colon);
    if (!EVIDENCE_TYPES.includes(type)) {
        throw new Error(`unknown evidence type "${type}" (types: ${EVIDENCE_TYPES.join(', ')})`);
    }
    const rest = spec.slice(colon + 1);
    const hashIndex = rest.indexOf('#');
    const path = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
    if (!path)
        throw new Error(`evidence "${spec}" has an empty path`);
    const evidence = { type, path: canonicalizeEvidencePath(path) };
    if (hashIndex !== -1 && rest.slice(hashIndex + 1))
        evidence.name = rest.slice(hashIndex + 1);
    return evidence;
}
/**
 * Whether a claim cites a test by name. This is the line between `covered`
 * and `linked`: a test file with no named unit inside it names nothing in
 * particular, and nothing can be executed or re-hashed at unit scope.
 */
export function hasNamedTestEvidence(evidence) {
    return (evidence ?? []).some((e) => e.type === 'test' && e.name);
}
/** Stamps content hashes onto evidence whose files exist under repoRoot. */
export function fingerprintEvidence(repoRoot, evidence) {
    return evidence.map((e) => {
        const hash = evidenceHash(repoRoot, e.path, e.name);
        if (hash === null && e.name && hashFile(repoRoot, e.path) !== null) {
            // The file exists but the cited unit does not: a claim naming a
            // nonexistent test must never enter the map.
            throw new Error(`"${e.name}" not found in ${e.path} - the cited unit must exist`);
        }
        return hash ? { ...e, hash } : e;
    });
}
