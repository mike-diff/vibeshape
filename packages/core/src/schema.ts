import { z } from 'zod';
import { COVERAGE_LEVELS, EVIDENCE_TYPES, IMPORTANCE_LEVELS } from './types.js';
import type { Manifest, ShapeNode } from './types.js';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NODE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export const evidenceSchema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  path: z.string().min(1),
  name: z.string().min(1).optional(),
  hash: z.string().regex(/^[0-9a-f]{12,64}$/).optional(),
});

export const assessedSchema = z.object({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  gitRef: z.string().min(4).optional(),
});

export const nodeSchema: z.ZodType<ShapeNode> = z.lazy(() =>
  z.object({
    id: z.string().regex(NODE_ID_PATTERN),
    title: z.string().min(1),
    intent: z.string().min(1).optional(),
    coverage: z.enum(COVERAGE_LEVELS).optional(),
    suspect: z.boolean().optional(),
    gap: z.string().min(1).optional(),
    importance: z.enum(IMPORTANCE_LEVELS).optional(),
    evidence: z.array(evidenceSchema).optional(),
    assessed: assessedSchema.optional(),
    children: z.array(nodeSchema).optional(),
  }),
);

export const manifestSchema: z.ZodType<Manifest> = z.object({
  name: z.string().min(1),
  schemaVersion: z.literal(1),
  areas: z.array(z.string().regex(SLUG_PATTERN)),
});

/** Validates a node tree and that every child id extends its parent id path. */
export function validateAreaTree(root: ShapeNode, areaSlug: string): string[] {
  const errors: string[] = [];
  const parsed = nodeSchema.safeParse(root);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  }
  if (root.id !== areaSlug) {
    errors.push(`root id "${root.id}" must equal area slug "${areaSlug}"`);
  }
  const seen = new Set<string>();
  const walk = (node: ShapeNode): void => {
    if (seen.has(node.id)) errors.push(`duplicate id "${node.id}"`);
    seen.add(node.id);
    for (const child of node.children ?? []) {
      if (!child.id.startsWith(`${node.id}/`)) {
        errors.push(`child id "${child.id}" must start with "${node.id}/"`);
      }
      walk(child);
    }
  };
  walk(root);
  return errors;
}
