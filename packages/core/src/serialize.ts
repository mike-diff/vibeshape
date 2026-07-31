import type { Evidence, Manifest, ShapeNode } from './types.js';

const NODE_KEYS: (keyof ShapeNode)[] = [
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
const EVIDENCE_KEYS: (keyof Evidence)[] = ['type', 'path', 'name', 'hash'];
const ASSESSED_KEYS = ['at', 'gitRef'] as const;
const MANIFEST_KEYS: (keyof Manifest)[] = ['name', 'schemaVersion', 'areas'];

function pick<T extends object>(obj: T, keys: readonly (keyof T)[]): T {
  const out = {} as T;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function orderNode(node: ShapeNode): ShapeNode {
  const ordered = pick(node, NODE_KEYS);
  if (node.suspect === false) delete ordered.suspect;
  if (node.evidence) ordered.evidence = node.evidence.map((e) => pick(e, EVIDENCE_KEYS));
  if (node.assessed) ordered.assessed = pick(node.assessed, ASSESSED_KEYS);
  if (node.children) {
    if (node.children.length === 0) delete ordered.children;
    else ordered.children = node.children.map(orderNode);
  }
  return ordered;
}

/** Deterministic serialization: fixed key order, 2-space indent, trailing newline. */
export function serializeArea(root: ShapeNode): string {
  return `${JSON.stringify(orderNode(root), null, 2)}\n`;
}

export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(pick(manifest, MANIFEST_KEYS), null, 2)}\n`;
}
