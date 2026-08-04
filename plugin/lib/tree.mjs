import { SLUG_PATTERN } from './schema.mjs';

export function slugify(text) {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!slug)
        throw new Error(`cannot derive a slug from "${text}"`);
    return slug;
}
export function findNode(shape, id) {
    for (const area of shape.areas) {
        const found = findInSubtree(area, id);
        if (found)
            return found;
    }
    return undefined;
}
function findInSubtree(node, id) {
    if (node.id === id)
        return node;
    if (!id.startsWith(`${node.id}/`))
        return undefined;
    for (const child of node.children ?? []) {
        const found = findInSubtree(child, id);
        if (found)
            return found;
    }
    return undefined;
}
export function findParent(shape, id) {
    const lastSlash = id.lastIndexOf('/');
    if (lastSlash === -1)
        return undefined;
    return findNode(shape, id.slice(0, lastSlash));
}
export function areaOf(shape, id) {
    const areaSlug = id.split('/')[0];
    return shape.areas.find((a) => a.id === areaSlug);
}
/**
 * Adds a node under `parentId`, or a new top-level area when `parentId` is "/".
 * Returns the created node. Mutates `shape`.
 */
export function addNode(shape, parentId, options) {
    const slug = options.slug ?? slugify(options.title);
    if (!SLUG_PATTERN.test(slug)) {
        throw new Error(`invalid id "${slug}" - must be a kebab-case slug (lowercase letters, digits, hyphens)`);
    }
    const node = { id: slug, title: options.title };
    if (options.intent)
        node.intent = options.intent;
    if (options.importance)
        node.importance = options.importance;
    if (parentId === '/') {
        if (shape.areas.some((a) => a.id === slug))
            throw new Error(`area "${slug}" already exists`);
        shape.areas.push(node);
        shape.manifest.areas.push(slug);
        return node;
    }
    const parent = findNode(shape, parentId);
    if (!parent)
        throw new Error(`parent node "${parentId}" not found`);
    node.id = `${parent.id}/${slug}`;
    if ((parent.children ?? []).some((c) => c.id === node.id)) {
        throw new Error(`node "${node.id}" already exists`);
    }
    parent.children = [...(parent.children ?? []), node];
    return node;
}
/** Removes a node (or a whole area). Mutates `shape`. */
export function removeNode(shape, id) {
    if (!id.includes('/')) {
        const index = shape.areas.findIndex((a) => a.id === id);
        if (index === -1)
            throw new Error(`node "${id}" not found`);
        const [removed] = shape.areas.splice(index, 1);
        shape.manifest.areas = shape.manifest.areas.filter((a) => a !== id);
        return removed;
    }
    const parent = findParent(shape, id);
    const index = (parent?.children ?? []).findIndex((c) => c.id === id);
    if (!parent || index === -1)
        throw new Error(`node "${id}" not found`);
    const [removed] = parent.children.splice(index, 1);
    if (parent.children.length === 0)
        delete parent.children;
    return removed;
}
/** Moves a subtree under a new parent, re-writing ids throughout. Mutates `shape`. */
export function moveNode(shape, id, newParentId) {
    if (id === newParentId || newParentId.startsWith(`${id}/`)) {
        throw new Error(`cannot move "${id}" into itself`);
    }
    const newParent = findNode(shape, newParentId);
    if (!newParent)
        throw new Error(`parent node "${newParentId}" not found`);
    const node = removeNode(shape, id);
    const slug = node.id.split('/').pop();
    reId(node, `${newParent.id}/${slug}`);
    if ((newParent.children ?? []).some((c) => c.id === node.id)) {
        throw new Error(`node "${node.id}" already exists`);
    }
    newParent.children = [...(newParent.children ?? []), node];
    return node;
}
function reId(node, newId) {
    const oldId = node.id;
    node.id = newId;
    for (const child of node.children ?? []) {
        reId(child, newId + child.id.slice(oldId.length));
    }
}
export function walk(node, visit, depth = 0) {
    visit(node, depth);
    for (const child of node.children ?? [])
        walk(child, visit, depth + 1);
}
