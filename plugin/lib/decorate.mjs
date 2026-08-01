import { coverageScore, derivedCoverage, derivedSuspect } from './rollup.mjs';

/**
 * @typedef {import('./types.mjs').Coverage} Coverage
 * @typedef {import('./types.mjs').Shape} Shape
 * @typedef {import('./types.mjs').ShapeNode} ShapeNode
 *
 * @typedef {object} Derived
 * @property {Coverage} coverage
 * @property {boolean} suspect
 * @property {number} percent
 *
 * @typedef {Omit<ShapeNode, 'children'> & { derived: Derived, children?: DecoratedNode[] }} DecoratedNode
 *
 * @typedef {object} DecoratedShape
 * @property {string} name
 * @property {Derived} derived
 * @property {Record<Coverage, number>} counts
 * @property {DecoratedNode[]} areas
 */

/**
 * @param {ShapeNode} node
 * @returns {DecoratedNode}
 */
function decorateNode(node) {
  const { children, ...rest } = node;
  /** @type {DecoratedNode} */
  const decorated = {
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

/**
 * Leaf counts by asserted coverage - what the header summarizes.
 *
 * @param {DecoratedNode} node
 * @param {Record<Coverage, number>} counts
 * @returns {void}
 */
function countLeaves(node, counts) {
  if (!node.children) counts[node.derived.coverage]++;
  for (const child of node.children ?? []) countLeaves(child, counts);
}

/**
 * The shape as the client consumes it: every node carries its rolled-up state.
 *
 * @param {Shape} shape
 * @returns {DecoratedShape}
 */
export function decorateShape(shape) {
  /** @type {ShapeNode} */
  const whole = { id: '', title: shape.manifest.name, children: shape.areas };
  /** @type {Record<Coverage, number>} */
  const counts = {
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
