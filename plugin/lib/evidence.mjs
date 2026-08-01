import { EVIDENCE_TYPES } from './types.mjs';
import { hashFile } from './fingerprint.mjs';
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
    const evidence = { type, path };
    if (hashIndex !== -1 && rest.slice(hashIndex + 1))
        evidence.name = rest.slice(hashIndex + 1);
    return evidence;
}
/** Stamps content hashes onto evidence whose files exist under repoRoot. */
export function fingerprintEvidence(repoRoot, evidence) {
    return evidence.map((e) => {
        const hash = hashFile(repoRoot, e.path);
        return hash ? { ...e, hash } : e;
    });
}
