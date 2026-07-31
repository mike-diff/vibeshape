import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_TYPES } from '@appshape/core';
import type { Evidence, EvidenceType } from '@appshape/core';

/**
 * Parses an evidence spec of the form `type:path` or `type:path#name`,
 * e.g. `file:src/auth/oauth.ts`, `test:tests/auth.test.ts#oauth login`.
 */
export function parseEvidenceSpec(spec: string): Evidence {
  const colon = spec.indexOf(':');
  if (colon === -1) {
    throw new Error(`evidence "${spec}" must be type:path (types: ${EVIDENCE_TYPES.join(', ')})`);
  }
  const type = spec.slice(0, colon) as EvidenceType;
  if (!EVIDENCE_TYPES.includes(type)) {
    throw new Error(`unknown evidence type "${type}" (types: ${EVIDENCE_TYPES.join(', ')})`);
  }
  const rest = spec.slice(colon + 1);
  const hashIndex = rest.indexOf('#');
  const path = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  if (!path) throw new Error(`evidence "${spec}" has an empty path`);
  const evidence: Evidence = { type, path };
  if (hashIndex !== -1 && rest.slice(hashIndex + 1)) evidence.name = rest.slice(hashIndex + 1);
  return evidence;
}

/** Stamps content hashes onto evidence whose files exist under repoRoot. */
export function fingerprintEvidence(repoRoot: string, evidence: Evidence[]): Evidence[] {
  return evidence.map((e) => {
    try {
      const content = readFileSync(join(repoRoot, e.path));
      return { ...e, hash: createHash('sha256').update(content).digest('hex').slice(0, 16) };
    } catch {
      return e;
    }
  });
}
