import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifest, parseNode, validateAreaTree } from './schema.mjs';
import { serializeArea, serializeManifest } from './serialize.mjs';
export const SHAPE_DIR = '.shape';
/** v2 split the old unexecuted "verified" into linked (named) and verified (run). */
export const SCHEMA_VERSION = 2;
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
    const shape = { manifest: { name, schemaVersion: SCHEMA_VERSION, areas: [] }, areas: [] };
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
    const shape = { manifest, areas };
    // A v1 "verified" was never executed by this tool, so it may not be shown
    // as one. Demote in memory for every reader; migrate.mjs is what earns
    // verified back on disk by actually running the cited tests.
    if (manifest.schemaVersion === 1) {
        for (const area of areas)
            demoteVerified(area);
        Object.defineProperty(shape, 'legacyVersion', { value: 1, enumerable: false });
    }
    return shape;
}
function demoteVerified(node) {
    if (node.coverage === 'verified')
        node.coverage = 'linked';
    for (const child of node.children ?? [])
        demoteVerified(child);
}
/**
 * Persists the manifest and every area file, removing area files that no
 * longer appear in the manifest. Callers should wrap mutations in withLock.
 */
export function saveShape(repoRoot, shape) {
    const dir = shapeDirPath(repoRoot);
    // Anything written by this version is v2 by definition: the in-memory
    // shape has already been through the v1 demotion on load. Stamp a copy so
    // saving never mutates the caller's shape out from under it.
    writeIfChanged(join(dir, MANIFEST_FILE), serializeManifest({ ...shape.manifest, schemaVersion: SCHEMA_VERSION }));
    for (const area of shape.areas) {
        writeIfChanged(join(dir, `${area.id}.json`), serializeArea(area));
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
// Read-only operations flow through updateShape too (audit with no
// findings); leaving identical files untouched keeps mtimes, watchers,
// and git status quiet.
function writeIfChanged(filePath, content) {
    try {
        if (readFileSync(filePath, 'utf8') === content)
            return;
    }
    catch {
        // new file
    }
    atomicWrite(filePath, content);
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
