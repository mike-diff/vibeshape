const NODE_KEYS = [
    'id',
    'title',
    'intent',
    'coverage',
    'suspect',
    'gap',
    'importance',
    'evidence',
    'assessed',
    'children',
];
const EVIDENCE_KEYS = ['type', 'path', 'name', 'hash'];
const ASSESSED_KEYS = ['at', 'gitRef'];
const MANIFEST_KEYS = ['name', 'schemaVersion', 'verifyCommand', 'areas'];
function pick(obj, keys) {
    const out = {};
    for (const key of keys) {
        const value = obj[key];
        if (value !== undefined)
            out[key] = value;
    }
    return out;
}
function orderNode(node) {
    const ordered = pick(node, NODE_KEYS);
    if (node.suspect === false)
        delete ordered.suspect;
    if (node.evidence)
        ordered.evidence = node.evidence.map((e) => pick(e, EVIDENCE_KEYS));
    if (node.assessed)
        ordered.assessed = pick(node.assessed, ASSESSED_KEYS);
    if (node.children) {
        if (node.children.length === 0)
            delete ordered.children;
        else
            ordered.children = node.children.map(orderNode);
    }
    return ordered;
}
/** Deterministic serialization: fixed key order, 2-space indent, trailing newline. */
export function serializeArea(root) {
    return `${JSON.stringify(orderNode(root), null, 2)}\n`;
}
export function serializeManifest(manifest) {
    return `${JSON.stringify(pick(manifest, MANIFEST_KEYS), null, 2)}\n`;
}
