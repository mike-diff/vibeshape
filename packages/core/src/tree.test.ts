import { describe, expect, it } from 'vitest';
import { addNode, findNode, moveNode, removeNode, slugify } from './tree.js';
import type { Shape } from './types.js';

function emptyShape(): Shape {
  return { manifest: { name: 'app', schemaVersion: 1, areas: [] }, areas: [] };
}

describe('slugify', () => {
  it('lowercases and collapses punctuation into single hyphens', () => {
    expect(slugify('OAuth 2.0 Login!')).toBe('oauth-2-0-login');
  });

  it('rejects titles with no usable characters', () => {
    expect(() => slugify('!!!')).toThrow();
  });
});

describe('addNode', () => {
  it('creates a new area with "/" as parent and records it in the manifest', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Checkout' });
    expect(shape.manifest.areas).toEqual(['checkout']);
    expect(findNode(shape, 'checkout')?.title).toBe('Checkout');
  });

  it('creates path-like ids under the parent', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, 'auth', { title: 'OAuth Login' });
    expect(findNode(shape, 'auth/oauth-login')).toBeDefined();
  });

  it('rejects duplicate siblings and duplicate areas', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, 'auth', { title: 'Login' });
    expect(() => addNode(shape, 'auth', { title: 'Login' })).toThrow(/already exists/);
    expect(() => addNode(shape, '/', { title: 'Auth' })).toThrow(/already exists/);
  });

  it('rejects adding under a nonexistent parent', () => {
    expect(() => addNode(emptyShape(), 'nope', { title: 'X' })).toThrow(/not found/);
  });
});

describe('removeNode', () => {
  it('removes a nested node', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, 'auth', { title: 'Login' });
    removeNode(shape, 'auth/login');
    expect(findNode(shape, 'auth/login')).toBeUndefined();
  });

  it('removes an area and its manifest entry', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    removeNode(shape, 'auth');
    expect(shape.manifest.areas).toEqual([]);
    expect(findNode(shape, 'auth')).toBeUndefined();
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
    expect(findNode(shape, 'account/mfa/totp')).toBeDefined();
    expect(findNode(shape, 'auth/mfa')).toBeUndefined();
  });

  it('refuses to move a node into its own subtree', () => {
    const shape = emptyShape();
    addNode(shape, '/', { title: 'Auth' });
    addNode(shape, 'auth', { title: 'MFA' });
    expect(() => moveNode(shape, 'auth', 'auth/mfa')).toThrow(/into itself/);
  });
});
