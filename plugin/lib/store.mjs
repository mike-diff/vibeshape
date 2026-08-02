import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest, parseNode, validateAreaTree } from './schema.mjs';
import { serializeArea, serializeManifest } from './serialize.mjs';
export const SHAPE_DIR = '.shape';
const MANIFEST_FILE = 'shape.json';
const LOCK_STALE_MS = 5_000;
const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 20;
export function shapeDirPath(repoRoot) {
    return join(repoRoot, SHAPE_DIR);
}
export function shapeExists(repoRoot) {
    try {
        return statSync(join(shapeDirPath(repoRoot), MANIFEST_FILE)).isFile();
    }
    catch {
        return false;
    }
}
export function initShape(repoRoot, name) {
    const dir = shapeDirPath(repoRoot);
    if (shapeExists(repoRoot))
        throw new Error(`${SHAPE_DIR}/ already initialized`);
    mkdirSync(dir, { recursive: true });
    const shape = { manifest: { name, schemaVersion: 1, areas: [] }, areas: [] };
    atomicWrite(join(dir, MANIFEST_FILE), serializeManifest(shape.manifest));
    // Generated files stay out of version control.
    atomicWrite(join(dir, '.gitignore'), 'snapshot.html\n.lock/\n*.tmp-*\n');
    return shape;
}
export function loadShape(repoRoot) {
    const dir = shapeDirPath(repoRoot);
    const manifest = parseFile(join(dir, MANIFEST_FILE), parseManifest);
    const areas = manifest.areas.map((slug) => {
        const root = parseFile(join(dir, `${slug}.json`), parseNode);
        const errors = validateAreaTree(root, slug);
        if (errors.length > 0) {
            throw new Error(`invalid area "${slug}": ${errors.join('; ')}`);
        }
        return root;
    });
    return { manifest, areas };
}
/**
 * Persists the manifest and every area file, removing area files that no
 * longer appear in the manifest. Callers should wrap mutations in withLock.
 */
export function saveShape(repoRoot, shape) {
    const dir = shapeDirPath(repoRoot);
    atomicWrite(join(dir, MANIFEST_FILE), serializeManifest(shape.manifest));
    for (const area of shape.areas) {
        atomicWrite(join(dir, `${area.id}.json`), serializeArea(area));
    }
    const keep = new Set([MANIFEST_FILE, ...shape.manifest.areas.map((a) => `${a}.json`)]);
    for (const file of readdirSync(dir)) {
        if (file.endsWith('.json') && !keep.has(file))
            unlinkSync(join(dir, file));
    }
}
/** Loads, applies `mutate`, and saves - under an advisory lock. */
export function updateShape(repoRoot, mutate) {
    return withLock(repoRoot, () => {
        const shape = loadShape(repoRoot);
        mutate(shape);
        saveShape(repoRoot, shape);
        return shape;
    });
}
export function withLock(repoRoot, fn) {
    const lockDir = join(shapeDirPath(repoRoot), '.lock');
    acquireLock(lockDir);
    try {
        return fn();
    }
    finally {
        try {
            rmdirSync(lockDir);
        }
        catch {
            // already released
        }
    }
}
function acquireLock(lockDir) {
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
        try {
            mkdirSync(lockDir);
            return;
        }
        catch {
            try {
                if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
                    rmdirSync(lockDir);
                    continue;
                }
            }
            catch {
                continue; // lock vanished between attempts
            }
            sleepSync(LOCK_RETRY_MS);
        }
    }
    throw new Error(`could not acquire ${lockDir} - remove it if no other shape process is running`);
}
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function atomicWrite(filePath, content) {
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, content);
    renameSync(tmp, filePath);
}
function parseFile(filePath, parse) {
    let text;
    try {
        text = readFileSync(filePath, 'utf8');
    }
    catch {
        throw new Error(`cannot read ${filePath} - run "shape init" first?`);
    }
    return parse(JSON.parse(text));
}
