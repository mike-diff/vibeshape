import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coverageScore, derivedCoverage, derivedSuspect } from '../plugin/lib/rollup.mjs';
import { assertionCounts } from '../plugin/lib/render.mjs';

function leaf(id, coverage, importance) {
  const node = { id, title: id };
  if (coverage) node.coverage = coverage;
  if (importance) node.importance = importance;
  return node;
}

function parent(id, children) {
  return { id, title: id, children };
}

describe('derivedCoverage', () => {
  it('treats a leaf with no asserted coverage as missing', () => {
    assert.equal(derivedCoverage(leaf('a')), 'missing');
  });

  it('returns the asserted coverage for a leaf', () => {
    assert.equal(derivedCoverage(leaf('a', 'partial')), 'partial');
  });

  it('is verified only when every child is verified', () => {
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'verified'), leaf('p/b', 'verified')])), 'verified');
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'verified'), leaf('p/b', 'covered')])), 'covered');
  });

  it('demotes verified to linked when any child is only linked', () => {
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'verified'), leaf('p/b', 'linked')])), 'linked');
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'linked'), leaf('p/b', 'linked')])), 'linked');
  });

  it('is covered only when every child is at least covered (deep-coverage rule)', () => {
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'verified')])), 'covered');
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'linked')])), 'covered');
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'partial')])), 'partial');
  });

  it('drops to partial when a linked child sits beside open work', () => {
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'linked'), leaf('p/b', 'missing')])), 'partial');
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'linked'), leaf('p/b', 'gap')])), 'partial');
  });

  it('is missing when every child is missing, gap when children are only missing/gap', () => {
    assert.equal(derivedCoverage(parent('p', [leaf('p/a'), leaf('p/b', 'missing')])), 'missing');
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'gap'), leaf('p/b', 'missing')])), 'gap');
  });

  it('is partial for any mix of covered and uncovered children', () => {
    assert.equal(derivedCoverage(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'missing')])), 'partial');
  });

  it('rolls up through intermediate parents, not just direct children', () => {
    const tree = parent('p', [
      parent('p/x', [leaf('p/x/a', 'covered')]),
      parent('p/y', [leaf('p/y/a', 'missing')]),
    ]);
    assert.equal(derivedCoverage(tree), 'partial');
  });
});

describe('derivedSuspect', () => {
  it('bubbles a suspect flag up from any descendant', () => {
    const tree = parent('p', [parent('p/x', [{ id: 'p/x/a', title: 'a', suspect: true }])]);
    assert.equal(derivedSuspect(tree), true);
    assert.equal(derivedSuspect(parent('p', [leaf('p/a', 'covered')])), false);
  });
});

describe('coverageScore', () => {
  it('weights core leaves more heavily than normal leaves', () => {
    const coreCovered = parent('p', [leaf('p/a', 'covered', 'core'), leaf('p/b', 'missing')]);
    const coreMissing = parent('p', [leaf('p/a', 'missing', 'core'), leaf('p/b', 'covered')]);
    assert.ok(coverageScore(coreCovered) > 0.5);
    assert.ok(coverageScore(coreMissing) < 0.5);
  });

  it('scores an all-covered tree as 1 and an all-missing tree as 0', () => {
    assert.equal(coverageScore(parent('p', [leaf('p/a', 'covered'), leaf('p/b', 'verified')])), 1);
    assert.equal(coverageScore(parent('p', [leaf('p/a'), leaf('p/b')])), 0);
  });

  it('scores linked exactly as covered and verified: the claim is asserted either way', () => {
    assert.equal(coverageScore(parent('p', [leaf('p/a', 'linked'), leaf('p/b', 'linked')])), 1);
    assert.equal(
      coverageScore(parent('p', [leaf('p/a', 'linked'), leaf('p/b', 'missing')])),
      coverageScore(parent('p', [leaf('p/a', 'verified'), leaf('p/b', 'missing')])),
    );
  });
});

describe('assertionCounts', () => {
  it('counts verified and linked leaves separately and suspects by stored flag', () => {
    const areas = [
      parent('p', [leaf('p/a', 'verified'), leaf('p/b', 'linked'), leaf('p/c', 'covered')]),
      parent('q', [{ id: 'q/a', title: 'a', coverage: 'linked', suspect: true }]),
    ];
    assert.deepEqual(assertionCounts(areas), { verified: 1, linked: 2, suspect: 1 });
  });

  it('counts a parent that derives verified as zero: only leaves are counted', () => {
    const areas = [parent('p', [leaf('p/a', 'verified'), leaf('p/b', 'verified')])];
    assert.equal(assertionCounts(areas).verified, 2);
  });
});
