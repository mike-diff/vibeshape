import { canonicalizeEvidencePath } from './evidence.mjs';
import { evidenceHash, hashFile } from './fingerprint.mjs';
import { walk } from './tree.mjs';
const CLAIMS_COVERAGE = new Set(['partial', 'covered', 'linked', 'verified']);
/** Levels that assert the intent is realized, so they owe checkable evidence. */
const CLAIM_TIERS = new Set(['covered', 'linked', 'verified']);
/**
 * Doorstop-style drift check plus a structural honesty check.
 *
 * Drift: a claim was assessed against specific evidence content; if that
 * content moved or vanished, the claim is suspect. Structure: a claim whose
 * evidence could never have supported it (absent, unnamed, unfingerprinted,
 * or unexecutable) is suspect too - those used to be warnings, which meant a
 * map full of unfounded claims could still pass a clean audit.
 *
 * Mutates `shape` (sets suspect flags).
 */
export function auditShape(repoRoot, shape) {
    const findings = [];
    const hasRunner = Boolean(shape.manifest?.verifyCommand);
    for (const area of shape.areas) {
        walk(area, (node) => {
            if (!node.coverage || !CLAIMS_COVERAGE.has(node.coverage))
                return;
            const drift = evidenceDrift(repoRoot, node);
            if (drift) {
                node.suspect = true;
                findings.push({ id: node.id, detail: drift });
                return;
            }
            const unfounded = structuralFault(node, hasRunner);
            if (unfounded) {
                node.suspect = true;
                findings.push({ id: node.id, detail: unfounded });
            }
        });
    }
    return findings;
}
/**
 * What makes a claim structurally unfounded, independent of whether its
 * evidence drifted. Returns null for an honest claim.
 */
function structuralFault(node, hasRunner) {
    if (!CLAIM_TIERS.has(node.coverage))
        return null;
    const evidence = node.evidence ?? [];
    if (evidence.length === 0)
        return `${node.coverage} with no evidence links`;
    if ((node.coverage === 'linked' || node.coverage === 'verified') && !evidence.some((e) => e.type === 'test' && e.name)) {
        return `${node.coverage} without named test evidence`;
    }
    const unfingerprinted = evidence.find((e) => !e.hash);
    if (unfingerprinted)
        return `${node.coverage} with unfingerprinted evidence ${unfingerprinted.path}`;
    if (node.coverage === 'verified' && !hasRunner)
        return 'verified with no verify command configured, so nothing could have been executed';
    return null;
}
function evidenceDrift(repoRoot, node) {
    for (const evidence of node.evidence ?? []) {
        // Legacy maps hold uncanonical paths ("./x", backslashes). Compare on
        // the canonical form so those still resolve, and fail the ones that
        // point outside the repo entirely - nothing can ever re-check those.
        let path;
        try {
            path = canonicalizeEvidencePath(evidence.path);
        }
        catch (error) {
            return `evidence path ${evidence.path} is not inside the repo (${error.message})`;
        }
        // Named evidence is hashed at unit scope: unrelated edits to the same
        // file do not invalidate the claim, but the cited unit changing or
        // vanishing does.
        const current = evidenceHash(repoRoot, path, evidence.name);
        if (current === null) {
            if (hashFile(repoRoot, path) === null)
                return `${evidence.path} no longer exists`;
            return `"${evidence.name}" no longer found in ${evidence.path}`;
        }
        if (evidence.hash && current !== evidence.hash) {
            return evidence.name
                ? `"${evidence.name}" in ${evidence.path} changed since assessment`
                : `${evidence.path} changed since assessment`;
        }
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
