import { describe, expect, it } from 'vitest';
import { coverageScore, derivedCoverage, derivedSuspect } from './rollup.js';
import type { Coverage, ShapeNode } from './types.js';

function leaf(id: string, coverage?: Coverage, importance?: ShapeNode['importance']): ShapeNode {
  const node: ShapeNode = { id, title: id };
  if (coverage) node.coverage = coverage;
  if (importance) node.importance = importance;
  return node;
}

function parent(id: string, children: ShapeNode[]): ShapeNode {
  return { id, title: id, children };
}

describe('derivedCoverage', () => {
  it('treats a leaf with no asserted coverage as missing', () => {
    expect(derivedCoverage(leaf('a'))).toBe('missing');
  });

  it('returns the asserted coverage for a leaf', () => {
    expect(derivedCoverage(leaf('a', 'partial'))).toBe('partial');
  });

  it('is verified only when every child is verified', () => {
    expect(derivedCoverage(parent('p', [leaf('p/a', 'verified'), leaf('p/b', 'verified')]))).toBe('verified');
    expect(derivedCoverage(parent('p', [leaf('p/a', 'verified'), leaf('p/b', 'covered')]))).toBe('covered');
  });

  it('is covered only when every child is at least covered (deep-coverage rule)', () => {
    expect(derivedCoverage(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'verified')]))).toBe('covered');
    expect(derivedCoverage(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'partial')]))).toBe('partial');
  });

  it('is missing when every child is missing, gap when children are only missing/gap', () => {
    expect(derivedCoverage(parent('p', [leaf('p/a'), leaf('p/b', 'missing')]))).toBe('missing');
    expect(derivedCoverage(parent('p', [leaf('p/a', 'gap'), leaf('p/b', 'missing')]))).toBe('gap');
  });

  it('is partial for any mix of covered and uncovered children', () => {
    expect(derivedCoverage(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'missing')]))).toBe('partial');
  });

  it('rolls up through intermediate parents, not just direct children', () => {
    const tree = parent('p', [
      parent('p/x', [leaf('p/x/a', 'covered')]),
      parent('p/y', [leaf('p/y/a', 'missing')]),
    ]);
    expect(derivedCoverage(tree)).toBe('partial');
  });
});

describe('derivedSuspect', () => {
  it('bubbles a suspect flag up from any descendant', () => {
    const tree = parent('p', [parent('p/x', [{ id: 'p/x/a', title: 'a', suspect: true }])]);
    expect(derivedSuspect(tree)).toBe(true);
    expect(derivedSuspect(parent('p', [leaf('p/a', 'covered')]))).toBe(false);
  });
});

describe('coverageScore', () => {
  it('weights core leaves more heavily than normal leaves', () => {
    const coreCovered = parent('p', [leaf('p/a', 'covered', 'core'), leaf('p/b', 'missing')]);
    const coreMissing = parent('p', [leaf('p/a', 'missing', 'core'), leaf('p/b', 'covered')]);
    expect(coverageScore(coreCovered)).toBeGreaterThan(0.5);
    expect(coverageScore(coreMissing)).toBeLessThan(0.5);
  });

  it('scores an all-covered tree as 1 and an all-missing tree as 0', () => {
    expect(coverageScore(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'verified')]))).toBe(1);
    expect(coverageScore(parent('p', [leaf('p/a'), leaf('p/b')]))).toBe(0);
  });
});
