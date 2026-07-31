export const COVERAGE_LEVELS = ['missing', 'gap', 'partial', 'covered', 'verified'] as const;
export type Coverage = (typeof COVERAGE_LEVELS)[number];

export const IMPORTANCE_LEVELS = ['core', 'high', 'normal', 'low'] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];

export const EVIDENCE_TYPES = ['file', 'test', 'other'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface Evidence {
  type: EvidenceType;
  path: string;
  /** Test name or other human label within the referenced path. */
  name?: string;
  /** sha256 hex of the referenced file's content at assessment time. */
  hash?: string;
}

export interface Assessed {
  /** ISO date of the last coverage assessment. */
  at: string;
  /** Short git SHA the assessment was made against. */
  gitRef?: string;
}

export interface ShapeNode {
  /** Path-like slug: `area/child/leaf`. Root node id equals the area slug. */
  id: string;
  title: string;
  /** EARS-style intent statement; required for leaves to be judged against. */
  intent?: string;
  /** Asserted on leaves only; parents derive coverage via roll-up. */
  coverage?: Coverage;
  /** Set by audit when evidence drifted since assessment; cleared by review. */
  suspect?: boolean;
  /** What specifically is missing or weak — the steerable delta. */
  gap?: string;
  importance?: Importance;
  evidence?: Evidence[];
  assessed?: Assessed;
  children?: ShapeNode[];
}

export interface Manifest {
  name: string;
  schemaVersion: 1;
  /** Top-level area slugs in display order; each has a `.shape/<area>.json`. */
  areas: string[];
}

export interface Shape {
  manifest: Manifest;
  /** Area root nodes, in manifest order. */
  areas: ShapeNode[];
}
