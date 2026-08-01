const COVERAGE_SCORE = {
    missing: 0,
    gap: 0.15,
    partial: 0.5,
    covered: 1,
    verified: 1,
};
const IMPORTANCE_WEIGHT = {
    core: 3,
    high: 2,
    normal: 1,
    low: 0.5,
};
export function importanceWeight(node) {
    return IMPORTANCE_WEIGHT[node.importance ?? 'normal'];
}
function isLeaf(node) {
    return !node.children || node.children.length === 0;
}
/**
 * Derived coverage. Leaves assert their own; parents follow the
 * OpenFastTrace deep-coverage rule: covered only when every child is.
 */
export function derivedCoverage(node) {
    if (isLeaf(node))
        return node.coverage ?? 'missing';
    const children = node.children.map(derivedCoverage);
    if (children.every((c) => c === 'verified'))
        return 'verified';
    if (children.every((c) => c === 'covered' || c === 'verified'))
        return 'covered';
    if (children.every((c) => c === 'missing'))
        return 'missing';
    if (children.every((c) => c === 'missing' || c === 'gap'))
        return 'gap';
    return 'partial';
}
/** A node is suspect if it or any descendant is flagged. */
export function derivedSuspect(node) {
    if (node.suspect)
        return true;
    return (node.children ?? []).some(derivedSuspect);
}
/** Importance-weighted coverage score over leaf descendants, 0..1. */
export function coverageScore(node) {
    const leaves = collectLeaves(node);
    const totalWeight = leaves.reduce((sum, leaf) => sum + importanceWeight(leaf), 0);
    if (totalWeight === 0)
        return 0;
    const scored = leaves.reduce((sum, leaf) => sum + importanceWeight(leaf) * COVERAGE_SCORE[leaf.coverage ?? 'missing'], 0);
    return scored / totalWeight;
}
export function collectLeaves(node) {
    if (isLeaf(node))
        return [node];
    return node.children.flatMap(collectLeaves);
}
