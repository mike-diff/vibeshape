import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasNamedTestEvidence } from './evidence.mjs';
import { loadShape, shapeDirPath, updateShape } from './store.mjs';
import { findNode, walk } from './tree.mjs';
import { runTestEvidence } from './verify.mjs';

/**
 * Brings a v1 map to v2 before any mutating command touches it.
 *
 * A v1 `verified` was only ever a claim: nothing executed it. Migration gives
 * each one exactly one chance to earn the word back by running its cited tests
 * right now, and otherwise settles it at the level its evidence still supports
 * (see settleLevel). Every state it can produce is one the CLI's own gates
 * would accept, so a migrated map audits clean. Tests run BEFORE the write
 * lock is taken (a slow suite must not hold it), and the result lands in a
 * single updateShape so a reader never observes a half-migrated map.
 *
 * Idempotent: a v2 map returns without reading anything else, and the write
 * itself goes through writeIfChanged, so a second run produces zero diff.
 *
 * @param {string} repoRoot
 * @param {(message: string) => void} [log]
 * @returns {boolean} whether a migration was performed
 */
export function migrateOnWrite(repoRoot, log = console.log) {
  const shape = loadShape(repoRoot);
  if (shape.legacyVersion !== 1) return false;

  const legacyVerified = readLegacyVerifiedIds(repoRoot, shape.manifest.areas);
  const template = shape.manifest.verifyCommand;
  /** @type {Map<string, string>} */
  const settled = new Map();

  for (const id of legacyVerified) {
    const node = findNode(shape, id);
    if (!node) continue;
    settled.set(id, settleLevel(repoRoot, node, template));
  }

  updateShape(repoRoot, (current) => {
    for (const [id, coverage] of settled) {
      const node = findNode(current, id);
      if (node) node.coverage = coverage;
    }
  });

  const counts = { verified: 0, linked: 0, covered: 0 };
  for (const level of settled.values()) counts[level]++;
  log(
    `migrated .shape to schema 2: ${counts.verified} verified re-proven by execution, ` +
      `${counts.linked} demoted to linked, ${counts.covered} demoted to covered` +
      `${template ? '' : ' (no verify command configured)'}`,
  );
  return true;
}

/**
 * Where a legacy `verified` claim honestly lands. Only what its evidence can
 * still support, and only a state the CLI's own gates would accept: verified
 * needs a named test that executes and passes right now, linked needs the
 * named test, and evidence naming no test at all was never more than covered.
 *
 * @param {string} repoRoot
 * @param {import('./types.mjs').ShapeNode} node
 * @param {string | undefined} template
 * @returns {'verified' | 'linked' | 'covered'}
 */
function settleLevel(repoRoot, node, template) {
  if (!hasNamedTestEvidence(node.evidence)) return 'covered';
  if (!template) return 'linked';
  return runTestEvidence(repoRoot, template, node.evidence).ok ? 'verified' : 'linked';
}

/**
 * Ids that claimed `verified` on disk. Read from the raw files because
 * loadShape has already demoted them in memory - that demotion is exactly
 * what this function needs to see behind.
 *
 * @param {string} repoRoot
 * @param {string[]} areaSlugs
 * @returns {string[]}
 */
function readLegacyVerifiedIds(repoRoot, areaSlugs) {
  const dir = shapeDirPath(repoRoot);
  /** @type {string[]} */
  const ids = [];
  for (const slug of areaSlugs) {
    const raw = JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8'));
    walk(raw, (node) => {
      if (node.coverage === 'verified') ids.push(node.id);
    });
  }
  return ids;
}
