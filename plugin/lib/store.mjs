import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
            rmSync(lockDir, { recursive: true, force: true });
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
            writeFileSync(join(lockDir, 'pid'), String(process.pid));
            return;
        }
        catch {
            try {
                // Steal only from a provably dead owner: age alone is not proof,
                // a slow writer may legitimately hold the lock past the window.
                if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS && !lockOwnerAlive(lockDir)) {
                    rmSync(lockDir, { recursive: true, force: true });
                    continue;
                }
            }
            catch {
                continue; // lock vanished between attempts
            }
            sleepSync(LOCK_RETRY_MS);
        }
    }
    throw new Error(`could not acquire ${lockDir} - another shape process holds it; remove it only if that process is gone`);
}
function lockOwnerAlive(lockDir) {
    try {
        const pid = Number(readFileSync(join(lockDir, 'pid'), 'utf8').trim());
        if (!Number.isInteger(pid) || pid <= 0) return false;
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false; // no pid file or process gone: treat as dead
    }
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
