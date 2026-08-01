import { hashFile } from './fingerprint.mjs';
import { walk } from './tree.mjs';
const CLAIMS_COVERAGE = new Set(['partial', 'covered', 'verified']);
/**
 * Doorstop-style drift check: a coverage claim was assessed against specific
 * evidence content; if that content moved or vanished, the claim is suspect
 * until a human or agent re-reviews it. Mutates `shape` (sets suspect flags).
 */
export function auditShape(repoRoot, shape) {
    const findings = [];
    for (const area of shape.areas) {
        walk(area, (node) => {
            if (!node.coverage || !CLAIMS_COVERAGE.has(node.coverage))
                return;
            const drift = evidenceDrift(repoRoot, node);
            if (drift) {
                node.suspect = true;
                findings.push({ id: node.id, kind: 'drifted', detail: drift });
                return;
            }
            if ((node.coverage === 'covered' || node.coverage === 'verified') && !node.evidence?.length) {
                findings.push({ id: node.id, kind: 'unevidenced', detail: `${node.coverage} with no evidence links` });
            }
        });
    }
    return findings;
}
function evidenceDrift(repoRoot, node) {
    for (const evidence of node.evidence ?? []) {
        const current = hashFile(repoRoot, evidence.path);
        if (current === null)
            return `${evidence.path} no longer exists`;
        if (evidence.hash && current !== evidence.hash)
            return `${evidence.path} changed since assessment`;
    }
    return null;
}
/** Collects nodes currently flagged suspect (stored flags, not derived). */
export function suspectNodes(shape) {
    const flagged = [];
    for (const area of shape.areas) {
        walk(area, (node) => {
            if (node.suspect)
                flagged.push(node);
        });
    }
    return flagged;
}
