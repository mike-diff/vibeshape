import { coverageScore, derivedCoverage, derivedSuspect } from '@appshape/core';
import type { Coverage, Shape, ShapeNode } from '@appshape/core';

export interface Derived {
  coverage: Coverage;
  suspect: boolean;
  percent: number;
}

export type DecoratedNode = Omit<ShapeNode, 'children'> & {
  derived: Derived;
  children?: DecoratedNode[];
};

export interface DecoratedShape {
  name: string;
  derived: Derived;
  counts: Record<Coverage, number>;
  areas: DecoratedNode[];
}

function decorateNode(node: ShapeNode): DecoratedNode {
  const { children, ...rest } = node;
  const decorated: DecoratedNode = {
    ...rest,
    derived: {
      coverage: derivedCoverage(node),
      suspect: derivedSuspect(node),
      percent: Math.round(coverageScore(node) * 100),
    },
  };
  if (children && children.length > 0) decorated.children = children.map(decorateNode);
  return decorated;
}

/** Leaf counts by asserted coverage — what the header summarizes. */
function countLeaves(node: DecoratedNode, counts: Record<Coverage, number>): void {
  if (!node.children) counts[node.derived.coverage]++;
  for (const child of node.children ?? []) countLeaves(child, counts);
}

/** The shape as the client consumes it: every node carries its rolled-up state. */
export function decorateShape(shape: Shape): DecoratedShape {
  const whole: ShapeNode = { id: '', title: shape.manifest.name, children: shape.areas };
  const counts: Record<Coverage, number> = {
    missing: 0,
    gap: 0,
    partial: 0,
    covered: 0,
    verified: 0,
  };
  const areas = shape.areas.map(decorateNode);
  for (const area of areas) countLeaves(area, counts);
  return {
    name: shape.manifest.name,
    derived: {
      coverage: derivedCoverage(whole),
      suspect: derivedSuspect(whole),
      percent: Math.round(coverageScore(whole) * 100),
    },
    counts,
    areas,
  };
}
