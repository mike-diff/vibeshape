import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addNode, findNode, moveNode, removeNode, slugify } from './tree.mjs';

function emptyShape() {
  return { manifest: { name: 'app', schemaVersion: 1, areas: [] }, areas: [] };
}

describe('slugify', () => {
  it('lowercases and collapses punctuation into single hyphens', () => {
    assert.equal(slugify('OAuth 2.0 Login!'), 'oauth-2-0-login');
  });

  it('rejects titles with no usable characters', () => {
    assert.throws(() => slugify('!!!'));
  });
});

describe('addNode', () => {
  it('creates a new area with "/" as parent and records it in the manifest', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Checkout' });
    assert.deepEqual(shape.manifest.areas, ['checkout']);
    assert.equal(findNode(shape, 'checkout')?.title, 'Checkout');
  });

  it('creates path-like ids under the parent', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, 'auth', { title: 'OAuth Login' });
    assert.ok(findNode(shape, 'auth/oauth-login'));
  });

  it('rejects duplicate siblings and duplicate areas', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, 'auth', { title: 'Login' });
    assert.throws(() => addNode(shape, 'auth', { title: 'Login' }), /already exists/);
    assert.throws(() => addNode(shape, '/', { title: 'Auth' }), /already exists/);
  });

  it('rejects adding under a nonexistent parent', () => {
    assert.throws(() => addNode(emptyShape(), 'nope', { title: 'X' }), /not found/);
  });
});

describe('removeNode', () => {
  it('removes a nested node', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, 'auth', { title: 'Login' });
    removeNode(shape, 'auth/login');
    assert.equal(findNode(shape, 'auth/login'), undefined);
  });

  it('removes an area and its manifest entry', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    removeNode(shape, 'auth');
    assert.deepEqual(shape.manifest.areas, []);
    assert.equal(findNode(shape, 'auth'), undefined);
  });
});

describe('moveNode', () => {
  it('rewrites ids for the whole moved subtree', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, '/', { title: 'Account' });
    addNode(shape, 'auth', { title: 'MFA' });
    addNode(shape, 'auth/mfa', { title: 'TOTP' });
    moveNode(shape, 'auth/mfa', 'account');
    assert.ok(findNode(shape, 'account/mfa/totp'));
    assert.equal(findNode(shape, 'auth/mfa'), undefined);
  });

  it('refuses to move a node into its own subtree', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, 'auth', { title: 'MFA' });
    assert.throws(() => moveNode(shape, 'auth', 'auth/mfa'), /into itself/);
  });
});
