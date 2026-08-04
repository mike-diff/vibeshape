import { COVERAGE_LEVELS, EVIDENCE_TYPES, IMPORTANCE_LEVELS } from './types.mjs';
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TEXT_LIMITS = { title: 200, intent: 1000, gap: 1000 };

/**
 * Normalizes human text fields before they enter the map: control characters,
 * zero-width characters, and line breaks collapse to plain spaces. The map is
 * injected into agent context every prompt; nothing invisible may ride along.
 */
export function cleanText(value, field) {
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u2066-\u2069\uFEFF]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const limit = TEXT_LIMITS[field];
  if (limit && cleaned.length > limit) {
    throw new Error(`${field} is ${cleaned.length} chars (max ${limit}) - keep it short enough to steer by`);
  }
  return cleaned;
}
export const NODE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const HASH_PATTERN = /^[0-9a-f]{12,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function checkString(errors, path, value, options = {}) {
    if (value === undefined) {
        if (!options.optional)
            errors.push(`${path}: required`);
        return;
    }
    if (typeof value !== 'string' || value.length === 0) {
        errors.push(`${path}: must be a non-empty string`);
        return;
    }
    if (options.pattern && !options.pattern.test(value)) {
        errors.push(`${path}: ${options.patternHint ?? `must match ${options.pattern}`}`);
    }
}
function checkEnum(errors, path, value, allowed) {
    if (value === undefined)
        return;
    if (typeof value !== 'string' || !allowed.includes(value)) {
        errors.push(`${path}: must be one of ${allowed.join(', ')}`);
    }
}
/** Structural validation of a raw node tree; returns zod-style "path: message" errors. */
export function nodeErrors(raw, path = 'node') {
    const errors = [];
    if (!isRecord(raw))
        return [`${path}: must be an object`];
    checkString(errors, `${path}.id`, raw.id, { pattern: NODE_ID_PATTERN, patternHint: 'must be a path of kebab-case slugs' });
    checkString(errors, `${path}.title`, raw.title);
    checkString(errors, `${path}.intent`, raw.intent, { optional: true });
    checkEnum(errors, `${path}.coverage`, raw.coverage, COVERAGE_LEVELS);
    if (raw.suspect !== undefined && typeof raw.suspect !== 'boolean') {
        errors.push(`${path}.suspect: must be a boolean`);
    }
    checkString(errors, `${path}.gap`, raw.gap, { optional: true });
    checkEnum(errors, `${path}.importance`, raw.importance, IMPORTANCE_LEVELS);
    if (raw.evidence !== undefined) {
        if (!Array.isArray(raw.evidence)) {
            errors.push(`${path}.evidence: must be an array`);
        }
        else {
            raw.evidence.forEach((entry, i) => {
                const entryPath = `${path}.evidence.${i}`;
                if (!isRecord(entry)) {
                    errors.push(`${entryPath}: must be an object`);
                    return;
                }
                if (typeof entry.type !== 'string' || !EVIDENCE_TYPES.includes(entry.type)) {
                    errors.push(`${entryPath}.type: must be one of ${EVIDENCE_TYPES.join(', ')}`);
                }
                checkString(errors, `${entryPath}.path`, entry.path);
                checkString(errors, `${entryPath}.name`, entry.name, { optional: true });
                checkString(errors, `${entryPath}.hash`, entry.hash, { optional: true, pattern: HASH_PATTERN, patternHint: 'must be 12-64 hex chars' });
            });
        }
    }
    if (raw.assessed !== undefined) {
        if (!isRecord(raw.assessed)) {
            errors.push(`${path}.assessed: must be an object`);
        }
        else {
            checkString(errors, `${path}.assessed.at`, raw.assessed.at, { pattern: DATE_PATTERN, patternHint: 'must be an ISO date' });
            if (raw.assessed.gitRef !== undefined && (typeof raw.assessed.gitRef !== 'string' || raw.assessed.gitRef.length < 4)) {
                errors.push(`${path}.assessed.gitRef: must be at least 4 chars`);
            }
        }
    }
    if (raw.children !== undefined) {
        if (!Array.isArray(raw.children)) {
            errors.push(`${path}.children: must be an array`);
        }
        else {
            raw.children.forEach((child, i) => errors.push(...nodeErrors(child, `${path}.children.${i}`)));
        }
    }
    return errors;
}
export function manifestErrors(raw) {
    const errors = [];
    if (!isRecord(raw))
        return ['manifest: must be an object'];
    checkString(errors, 'manifest.name', raw.name);
    if (raw.schemaVersion !== 1)
        errors.push('manifest.schemaVersion: must be 1');
    if (!Array.isArray(raw.areas)) {
        errors.push('manifest.areas: must be an array');
    }
    else {
        raw.areas.forEach((area, i) => checkString(errors, `manifest.areas.${i}`, area, { pattern: SLUG_PATTERN, patternHint: 'must be a kebab-case slug' }));
    }
    return errors;
}
export function parseNode(raw) {
    const errors = nodeErrors(raw);
    if (errors.length > 0)
        throw new Error(errors.join('; '));
    return raw;
}
export function parseManifest(raw) {
    const errors = manifestErrors(raw);
    if (errors.length > 0)
        throw new Error(errors.join('; '));
    return raw;
}
/** Validates a node tree and that every child id extends its parent id path. */
export function validateAreaTree(root, areaSlug) {
    const structural = nodeErrors(root);
    if (structural.length > 0)
        return structural;
    const errors = [];
    if (root.id !== areaSlug) {
        errors.push(`root id "${root.id}" must equal area slug "${areaSlug}"`);
    }
    const seen = new Set();
    const walk = (node) => {
        if (seen.has(node.id))
            errors.push(`duplicate id "${node.id}"`);
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
