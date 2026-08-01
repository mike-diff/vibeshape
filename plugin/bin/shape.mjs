#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/core/dist/types.js
var COVERAGE_LEVELS, IMPORTANCE_LEVELS, EVIDENCE_TYPES;
var init_types = __esm({
  "packages/core/dist/types.js"() {
    "use strict";
    COVERAGE_LEVELS = ["missing", "gap", "partial", "covered", "verified"];
    IMPORTANCE_LEVELS = ["core", "high", "normal", "low"];
    EVIDENCE_TYPES = ["file", "test", "other"];
  }
});

// packages/core/dist/fingerprint.js
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
function hashFile(repoRoot, relativePath) {
  try {
    const content = readFileSync(join(repoRoot, relativePath));
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}
var init_fingerprint = __esm({
  "packages/core/dist/fingerprint.js"() {
    "use strict";
  }
});

// packages/core/dist/tree.js
function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug)
    throw new Error(`cannot derive a slug from "${text}"`);
  return slug;
}
function findNode(shape, id) {
  for (const area of shape.areas) {
    const found = findInSubtree(area, id);
    if (found)
      return found;
  }
  return void 0;
}
function findInSubtree(node, id) {
  if (node.id === id)
    return node;
  if (!id.startsWith(`${node.id}/`))
    return void 0;
  for (const child of node.children ?? []) {
    const found = findInSubtree(child, id);
    if (found)
      return found;
  }
  return void 0;
}
function findParent(shape, id) {
  const lastSlash = id.lastIndexOf("/");
  if (lastSlash === -1)
    return void 0;
  return findNode(shape, id.slice(0, lastSlash));
}
function addNode(shape, parentId, options) {
  const slug = options.slug ?? slugify(options.title);
  const node = { id: slug, title: options.title };
  if (options.intent)
    node.intent = options.intent;
  if (options.importance)
    node.importance = options.importance;
  if (parentId === "/") {
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
  parent.children = [...parent.children ?? [], node];
  return node;
}
function removeNode(shape, id) {
  if (!id.includes("/")) {
    const index2 = shape.areas.findIndex((a) => a.id === id);
    if (index2 === -1)
      throw new Error(`node "${id}" not found`);
    const [removed2] = shape.areas.splice(index2, 1);
    shape.manifest.areas = shape.manifest.areas.filter((a) => a !== id);
    return removed2;
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
function moveNode(shape, id, newParentId) {
  if (id === newParentId || newParentId.startsWith(`${id}/`)) {
    throw new Error(`cannot move "${id}" into itself`);
  }
  const newParent = findNode(shape, newParentId);
  if (!newParent)
    throw new Error(`parent node "${newParentId}" not found`);
  const node = removeNode(shape, id);
  const slug = node.id.split("/").pop();
  reId(node, `${newParent.id}/${slug}`);
  if ((newParent.children ?? []).some((c) => c.id === node.id)) {
    throw new Error(`node "${node.id}" already exists`);
  }
  newParent.children = [...newParent.children ?? [], node];
  return node;
}
function reId(node, newId) {
  const oldId = node.id;
  node.id = newId;
  for (const child of node.children ?? []) {
    reId(child, newId + child.id.slice(oldId.length));
  }
}
function walk(node, visit, depth = 0) {
  visit(node, depth);
  for (const child of node.children ?? [])
    walk(child, visit, depth + 1);
}
var init_tree = __esm({
  "packages/core/dist/tree.js"() {
    "use strict";
  }
});

// packages/core/dist/audit.js
function auditShape(repoRoot, shape) {
  const findings = [];
  for (const area of shape.areas) {
    walk(area, (node) => {
      if (!node.coverage || !CLAIMS_COVERAGE.has(node.coverage))
        return;
      const drift = evidenceDrift(repoRoot, node);
      if (drift) {
        node.suspect = true;
        findings.push({ id: node.id, kind: "drifted", detail: drift });
        return;
      }
      if ((node.coverage === "covered" || node.coverage === "verified") && !node.evidence?.length) {
        findings.push({ id: node.id, kind: "unevidenced", detail: `${node.coverage} with no evidence links` });
      }
    });
  }
  return findings;
}
function evidenceDrift(repoRoot, node) {
  for (const evidence of node.evidence ?? []) {
    const current = hashFile(repoRoot, evidence.path);
    if (current === null)
      return `${evidence.path} no longer exists`;
    if (evidence.hash && current !== evidence.hash)
      return `${evidence.path} changed since assessment`;
  }
  return null;
}
function suspectNodes(shape) {
  const flagged = [];
  for (const area of shape.areas) {
    walk(area, (node) => {
      if (node.suspect)
        flagged.push(node);
    });
  }
  return flagged;
}
var CLAIMS_COVERAGE;
var init_audit = __esm({
  "packages/core/dist/audit.js"() {
    "use strict";
    init_fingerprint();
    init_tree();
    CLAIMS_COVERAGE = /* @__PURE__ */ new Set(["partial", "covered", "verified"]);
  }
});

// packages/core/dist/schema.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function checkString(errors, path, value, options = {}) {
  if (value === void 0) {
    if (!options.optional)
      errors.push(`${path}: required`);
    return;
  }
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path}: must be a non-empty string`);
    return;
  }
  if (options.pattern && !options.pattern.test(value)) {
    errors.push(`${path}: ${options.patternHint ?? `must match ${options.pattern}`}`);
  }
}
function checkEnum(errors, path, value, allowed) {
  if (value === void 0)
    return;
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${path}: must be one of ${allowed.join(", ")}`);
  }
}
function nodeErrors(raw, path = "node") {
  const errors = [];
  if (!isRecord(raw))
    return [`${path}: must be an object`];
  checkString(errors, `${path}.id`, raw.id, { pattern: NODE_ID_PATTERN, patternHint: "must be a path of kebab-case slugs" });
  checkString(errors, `${path}.title`, raw.title);
  checkString(errors, `${path}.intent`, raw.intent, { optional: true });
  checkEnum(errors, `${path}.coverage`, raw.coverage, COVERAGE_LEVELS);
  if (raw.suspect !== void 0 && typeof raw.suspect !== "boolean") {
    errors.push(`${path}.suspect: must be a boolean`);
  }
  checkString(errors, `${path}.gap`, raw.gap, { optional: true });
  checkEnum(errors, `${path}.importance`, raw.importance, IMPORTANCE_LEVELS);
  if (raw.evidence !== void 0) {
    if (!Array.isArray(raw.evidence)) {
      errors.push(`${path}.evidence: must be an array`);
    } else {
      raw.evidence.forEach((entry, i) => {
        const entryPath = `${path}.evidence.${i}`;
        if (!isRecord(entry)) {
          errors.push(`${entryPath}: must be an object`);
          return;
        }
        if (typeof entry.type !== "string" || !EVIDENCE_TYPES.includes(entry.type)) {
          errors.push(`${entryPath}.type: must be one of ${EVIDENCE_TYPES.join(", ")}`);
        }
        checkString(errors, `${entryPath}.path`, entry.path);
        checkString(errors, `${entryPath}.name`, entry.name, { optional: true });
        checkString(errors, `${entryPath}.hash`, entry.hash, { optional: true, pattern: HASH_PATTERN, patternHint: "must be 12-64 hex chars" });
      });
    }
  }
  if (raw.assessed !== void 0) {
    if (!isRecord(raw.assessed)) {
      errors.push(`${path}.assessed: must be an object`);
    } else {
      checkString(errors, `${path}.assessed.at`, raw.assessed.at, { pattern: DATE_PATTERN, patternHint: "must be an ISO date" });
      if (raw.assessed.gitRef !== void 0 && (typeof raw.assessed.gitRef !== "string" || raw.assessed.gitRef.length < 4)) {
        errors.push(`${path}.assessed.gitRef: must be at least 4 chars`);
      }
    }
  }
  if (raw.children !== void 0) {
    if (!Array.isArray(raw.children)) {
      errors.push(`${path}.children: must be an array`);
    } else {
      raw.children.forEach((child, i) => errors.push(...nodeErrors(child, `${path}.children.${i}`)));
    }
  }
  return errors;
}
function manifestErrors(raw) {
  const errors = [];
  if (!isRecord(raw))
    return ["manifest: must be an object"];
  checkString(errors, "manifest.name", raw.name);
  if (raw.schemaVersion !== 1)
    errors.push("manifest.schemaVersion: must be 1");
  if (!Array.isArray(raw.areas)) {
    errors.push("manifest.areas: must be an array");
  } else {
    raw.areas.forEach((area, i) => checkString(errors, `manifest.areas.${i}`, area, { pattern: SLUG_PATTERN, patternHint: "must be a kebab-case slug" }));
  }
  return errors;
}
function parseNode(raw) {
  const errors = nodeErrors(raw);
  if (errors.length > 0)
    throw new Error(errors.join("; "));
  return raw;
}
function parseManifest(raw) {
  const errors = manifestErrors(raw);
  if (errors.length > 0)
    throw new Error(errors.join("; "));
  return raw;
}
function validateAreaTree(root, areaSlug) {
  const structural = nodeErrors(root);
  if (structural.length > 0)
    return structural;
  const errors = [];
  if (root.id !== areaSlug) {
    errors.push(`root id "${root.id}" must equal area slug "${areaSlug}"`);
  }
  const seen = /* @__PURE__ */ new Set();
  const walk2 = (node) => {
    if (seen.has(node.id))
      errors.push(`duplicate id "${node.id}"`);
    seen.add(node.id);
    for (const child of node.children ?? []) {
      if (!child.id.startsWith(`${node.id}/`)) {
        errors.push(`child id "${child.id}" must start with "${node.id}/"`);
      }
      walk2(child);
    }
  };
  walk2(root);
  return errors;
}
var SLUG_PATTERN, NODE_ID_PATTERN, HASH_PATTERN, DATE_PATTERN;
var init_schema = __esm({
  "packages/core/dist/schema.js"() {
    "use strict";
    init_types();
    SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    NODE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
    HASH_PATTERN = /^[0-9a-f]{12,64}$/;
    DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;
  }
});

// packages/core/dist/rollup.js
function importanceWeight(node) {
  return IMPORTANCE_WEIGHT[node.importance ?? "normal"];
}
function isLeaf(node) {
  return !node.children || node.children.length === 0;
}
function derivedCoverage(node) {
  if (isLeaf(node))
    return node.coverage ?? "missing";
  const children = node.children.map(derivedCoverage);
  if (children.every((c) => c === "verified"))
    return "verified";
  if (children.every((c) => c === "covered" || c === "verified"))
    return "covered";
  if (children.every((c) => c === "missing"))
    return "missing";
  if (children.every((c) => c === "missing" || c === "gap"))
    return "gap";
  return "partial";
}
function derivedSuspect(node) {
  if (node.suspect)
    return true;
  return (node.children ?? []).some(derivedSuspect);
}
function coverageScore(node) {
  const leaves = collectLeaves(node);
  const totalWeight = leaves.reduce((sum, leaf) => sum + importanceWeight(leaf), 0);
  if (totalWeight === 0)
    return 0;
  const scored = leaves.reduce((sum, leaf) => sum + importanceWeight(leaf) * COVERAGE_SCORE[leaf.coverage ?? "missing"], 0);
  return scored / totalWeight;
}
function collectLeaves(node) {
  if (isLeaf(node))
    return [node];
  return node.children.flatMap(collectLeaves);
}
var COVERAGE_SCORE, IMPORTANCE_WEIGHT;
var init_rollup = __esm({
  "packages/core/dist/rollup.js"() {
    "use strict";
    COVERAGE_SCORE = {
      missing: 0,
      gap: 0.15,
      partial: 0.5,
      covered: 1,
      verified: 1
    };
    IMPORTANCE_WEIGHT = {
      core: 3,
      high: 2,
      normal: 1,
      low: 0.5
    };
  }
});

// packages/core/dist/serialize.js
function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    const value = obj[key];
    if (value !== void 0)
      out[key] = value;
  }
  return out;
}
function orderNode(node) {
  const ordered = pick(node, NODE_KEYS);
  if (node.suspect === false)
    delete ordered.suspect;
  if (node.evidence)
    ordered.evidence = node.evidence.map((e) => pick(e, EVIDENCE_KEYS));
  if (node.assessed)
    ordered.assessed = pick(node.assessed, ASSESSED_KEYS);
  if (node.children) {
    if (node.children.length === 0)
      delete ordered.children;
    else
      ordered.children = node.children.map(orderNode);
  }
  return ordered;
}
function serializeArea(root) {
  return `${JSON.stringify(orderNode(root), null, 2)}
`;
}
function serializeManifest(manifest) {
  return `${JSON.stringify(pick(manifest, MANIFEST_KEYS), null, 2)}
`;
}
var NODE_KEYS, EVIDENCE_KEYS, ASSESSED_KEYS, MANIFEST_KEYS;
var init_serialize = __esm({
  "packages/core/dist/serialize.js"() {
    "use strict";
    NODE_KEYS = [
      "id",
      "title",
      "intent",
      "coverage",
      "suspect",
      "gap",
      "importance",
      "evidence",
      "assessed",
      "children"
    ];
    EVIDENCE_KEYS = ["type", "path", "name", "hash"];
    ASSESSED_KEYS = ["at", "gitRef"];
    MANIFEST_KEYS = ["name", "schemaVersion", "areas"];
  }
});

// packages/core/dist/store.js
import { mkdirSync, readdirSync, readFileSync as readFileSync2, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
function shapeDirPath(repoRoot) {
  return join2(repoRoot, SHAPE_DIR);
}
function shapeExists(repoRoot) {
  try {
    return statSync(join2(shapeDirPath(repoRoot), MANIFEST_FILE)).isFile();
  } catch {
    return false;
  }
}
function initShape(repoRoot, name) {
  const dir = shapeDirPath(repoRoot);
  if (shapeExists(repoRoot))
    throw new Error(`${SHAPE_DIR}/ already initialized`);
  mkdirSync(dir, { recursive: true });
  const shape = { manifest: { name, schemaVersion: 1, areas: [] }, areas: [] };
  atomicWrite(join2(dir, MANIFEST_FILE), serializeManifest(shape.manifest));
  return shape;
}
function loadShape(repoRoot) {
  const dir = shapeDirPath(repoRoot);
  const manifest = parseFile(join2(dir, MANIFEST_FILE), parseManifest);
  const areas = manifest.areas.map((slug) => {
    const root = parseFile(join2(dir, `${slug}.json`), parseNode);
    const errors = validateAreaTree(root, slug);
    if (errors.length > 0) {
      throw new Error(`invalid area "${slug}": ${errors.join("; ")}`);
    }
    return root;
  });
  return { manifest, areas };
}
function saveShape(repoRoot, shape) {
  const dir = shapeDirPath(repoRoot);
  atomicWrite(join2(dir, MANIFEST_FILE), serializeManifest(shape.manifest));
  for (const area of shape.areas) {
    atomicWrite(join2(dir, `${area.id}.json`), serializeArea(area));
  }
  const keep = /* @__PURE__ */ new Set([MANIFEST_FILE, ...shape.manifest.areas.map((a) => `${a}.json`)]);
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json") && !keep.has(file))
      unlinkSync(join2(dir, file));
  }
}
function updateShape(repoRoot, mutate) {
  return withLock(repoRoot, () => {
    const shape = loadShape(repoRoot);
    mutate(shape);
    saveShape(repoRoot, shape);
    return shape;
  });
}
function withLock(repoRoot, fn) {
  const lockDir = join2(shapeDirPath(repoRoot), ".lock");
  acquireLock(lockDir);
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lockDir);
    } catch {
    }
  }
}
function acquireLock(lockDir) {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      mkdirSync(lockDir);
      return;
    } catch {
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          rmdirSync(lockDir);
          continue;
        }
      } catch {
        continue;
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
    text = readFileSync2(filePath, "utf8");
  } catch {
    throw new Error(`cannot read ${filePath} - run "shape init" first?`);
  }
  return parse(JSON.parse(text));
}
var SHAPE_DIR, MANIFEST_FILE, LOCK_STALE_MS, LOCK_RETRIES, LOCK_RETRY_MS;
var init_store = __esm({
  "packages/core/dist/store.js"() {
    "use strict";
    init_schema();
    init_serialize();
    SHAPE_DIR = ".shape";
    MANIFEST_FILE = "shape.json";
    LOCK_STALE_MS = 5e3;
    LOCK_RETRIES = 100;
    LOCK_RETRY_MS = 20;
  }
});

// packages/core/dist/index.js
var init_dist = __esm({
  "packages/core/dist/index.js"() {
    "use strict";
    init_types();
    init_audit();
    init_fingerprint();
    init_schema();
    init_rollup();
    init_serialize();
    init_tree();
    init_store();
  }
});

// packages/viewer/dist/decorate.js
function decorateNode(node) {
  const { children, ...rest } = node;
  const decorated = {
    ...rest,
    derived: {
      coverage: derivedCoverage(node),
      suspect: derivedSuspect(node),
      percent: Math.round(coverageScore(node) * 100)
    }
  };
  if (children && children.length > 0)
    decorated.children = children.map(decorateNode);
  return decorated;
}
function countLeaves(node, counts) {
  if (!node.children)
    counts[node.derived.coverage]++;
  for (const child of node.children ?? [])
    countLeaves(child, counts);
}
function decorateShape(shape) {
  const whole = { id: "", title: shape.manifest.name, children: shape.areas };
  const counts = {
    missing: 0,
    gap: 0,
    partial: 0,
    covered: 0,
    verified: 0
  };
  const areas = shape.areas.map(decorateNode);
  for (const area of areas)
    countLeaves(area, counts);
  return {
    name: shape.manifest.name,
    derived: {
      coverage: derivedCoverage(whole),
      suspect: derivedSuspect(whole),
      percent: Math.round(coverageScore(whole) * 100)
    },
    counts,
    areas
  };
}
var init_decorate = __esm({
  "packages/viewer/dist/decorate.js"() {
    "use strict";
    init_dist();
  }
});

// packages/viewer/dist/client-html.js
var SNAPSHOT_MARKER, CLIENT_HTML;
var init_client_html = __esm({
  "packages/viewer/dist/client-html.js"() {
    "use strict";
    SNAPSHOT_MARKER = "<!--__SNAPSHOT_DATA__-->";
    CLIENT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>appshape</title>
    <link rel="icon" href="data:," />
    <style>
      :root {
  --bg: #ffffff;
  --fg: #1b1f23;
  --dim: #6a737d;
  --line: #e3e6ea;
  --hover: #f2f4f7;
  --accent: #2f6feb;

  --missing: #9aa0a6;
  --gap: #d13438;
  --partial: #c78a15;
  --covered: #2c9a4a;
  --verified: #0fa88a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171a;
    --fg: #e6e9ec;
    --dim: #8b949e;
    --line: #262b31;
    --hover: #1d2126;
    --accent: #6ea0ff;

    --missing: #7d848b;
    --gap: #f2686c;
    --partial: #e0aa3e;
    --covered: #4fc06f;
    --verified: #2ed3b0;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}

h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}

.spacer {
  flex: 1;
}

.overall {
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.counts {
  color: var(--dim);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.counts b {
  font-weight: 600;
}

.live {
  color: var(--covered);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.live[hidden] {
  display: none;
}

button,
.toggle {
  font: inherit;
  font-size: 12px;
  color: var(--fg);
  background: none;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
}

button:hover,
.toggle:hover {
  background: var(--hover);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  user-select: none;
}

.tree {
  padding: 8px 0 40vh;
}

.row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 1px 16px 1px 0;
  border-left: 3px solid transparent;
  cursor: default;
  white-space: nowrap;
}

.row:hover {
  background: var(--hover);
}

.row.core {
  border-left-color: var(--accent);
}

.row.high {
  border-left-color: var(--dim);
}

.row.suspect .glyph {
  outline: 1px dashed var(--partial);
  outline-offset: 2px;
  border-radius: 2px;
}

.disclosure {
  width: 12px;
  flex: none;
  color: var(--dim);
  text-align: center;
  cursor: pointer;
  user-select: none;
}

.disclosure.leaf {
  cursor: default;
  opacity: 0;
}

.glyph {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.glyph.missing {
  color: var(--missing);
}
.glyph.gap {
  color: var(--gap);
}
.glyph.partial {
  color: var(--partial);
}
.glyph.covered {
  color: var(--covered);
}
.glyph.verified {
  color: var(--verified);
}

.title {
  font-weight: 500;
}

.id,
.percent {
  color: var(--dim);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
}

.percent {
  font-variant-numeric: tabular-nums;
}

.gap-note {
  color: var(--gap);
  font-style: italic;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prompts {
  flex: none;
  margin-left: auto;
  padding: 0 6px;
  border: none;
  color: var(--dim);
  opacity: 0;
  font-size: 12px;
}

.row:hover .prompts,
.prompts:focus {
  opacity: 1;
}

.children.collapsed {
  display: none;
}

.palette {
  position: absolute;
  z-index: 2;
  width: 300px;
  max-width: calc(100vw - 24px);
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
}

.palette[hidden] {
  display: none;
}

.palette-head {
  padding: 2px 6px 6px;
  border-bottom: 1px solid var(--line);
}

.palette-title {
  color: var(--dim);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.palette-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 6px;
}

.palette-item {
  display: block;
  width: 100%;
  border: none;
  border-radius: 5px;
  padding: 5px 7px;
  text-align: left;
  white-space: normal;
}

.palette-item b {
  display: block;
  font-size: 12px;
  font-weight: 600;
}

.palette-item i {
  display: block;
  color: var(--dim);
  font-size: 11px;
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%) translateY(8px);
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--fg);
  color: var(--bg);
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s, transform 0.15s;
}

.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
    </style>
  </head>
  <body>
    <header id="header">
      <h1 id="app-name">appshape</h1>
      <span id="overall" class="overall"></span>
      <span id="counts" class="counts"></span>
      <span id="live" class="live" title="watching .shape for changes">live</span>
      <div class="spacer"></div>
      <button id="expand-all" type="button">expand all</button>
      <button id="collapse-all" type="button">collapse all</button>
      <label class="toggle"><input id="gaps-only" type="checkbox" /> gaps only</label>
    </header>
    <main id="tree" class="tree"></main>
    <div id="palette" class="palette" hidden>
      <div class="palette-head"><span id="palette-title" class="palette-title"></span></div>
      <div id="palette-body" class="palette-body"></div>
    </div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <!--__SNAPSHOT_DATA__-->
    <script>
      /**
 * The appshape viewer client. No imports, no bundler: gen-client.mjs inlines this
 * file into index.html. Types are mirrored from src/decorate.ts via JSDoc so
 * \`tsc --checkJs\` can hold them honest.
 *
 * @typedef {'missing' | 'gap' | 'partial' | 'covered' | 'verified'} Coverage
 *
 * @typedef {object} Derived
 * @property {Coverage} coverage
 * @property {boolean} suspect
 * @property {number} percent
 *
 * @typedef {object} DecoratedNode
 * @property {string} id
 * @property {string} title
 * @property {Derived} derived
 * @property {string} [intent]
 * @property {string} [gap]
 * @property {'core' | 'high' | 'normal' | 'low'} [importance]
 * @property {DecoratedNode[]} [children]
 *
 * @typedef {object} DecoratedShape
 * @property {string} name
 * @property {Derived} derived
 * @property {Record<Coverage, number>} counts
 * @property {DecoratedNode[]} areas
 *
 * @typedef {object} RowElements
 * @property {HTMLElement} container
 * @property {HTMLElement} row
 * @property {HTMLElement} disclosure
 * @property {HTMLElement} glyph
 * @property {HTMLElement} title
 * @property {HTMLElement} id
 * @property {HTMLElement} percent
 * @property {HTMLElement} gapNote
 * @property {HTMLElement} children
 *
 * @typedef {object} PromptStep
 * @property {string} label
 * @property {string} text
 */

/** @type {Record<Coverage, string>} */
const GLYPH = {
  missing: '\xB7',
  gap: '\u25CB',
  partial: '\u25D0',
  covered: '\u25CF',
  verified: '\u2714',
};

const DEFAULT_EXPAND_DEPTH = 2;

/** Ids explicitly collapsed by the user; everything else follows depth defaults. */
const collapsed = new Set();
/** Ids we have already applied the default expand depth to, so it only seeds once. */
const seeded = new Set();
/** @type {Map<string, RowElements>} Live row elements by node id, the anchor for in-place patching. */
const rows = new Map();
/** @type {Map<string, DecoratedNode>} Latest node data by id, so the palette reads current values. */
const nodesById = new Map();

let gapsOnly = false;
/** @type {DecoratedShape | undefined} */
let shape;

const treeEl = must('tree');
const toastEl = must('toast');
const liveEl = must('live');
const paletteEl = must('palette');
const paletteTitleEl = must('palette-title');
const paletteBodyEl = must('palette-body');

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function must(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(\`missing #\${id}\`);
  return el;
}

/**
 * @param {DecoratedNode} node
 * @returns {boolean}
 */
function isVisible(node) {
  if (!gapsOnly) return true;
  if (node.derived.suspect) return true;
  return node.derived.coverage !== 'covered' && node.derived.coverage !== 'verified';
}

/**
 * @param {DecoratedNode} node
 * @param {number} depth
 */
function seedCollapse(node, depth) {
  if (seeded.has(node.id)) return;
  seeded.add(node.id);
  if (depth >= DEFAULT_EXPAND_DEPTH && node.children) collapsed.add(node.id);
}

/**
 * The four steering prompts offered per node. Each one is a complete instruction
 * a user can paste straight into their agent.
 *
 * @param {DecoratedNode} node
 * @returns {PromptStep[]}
 */
function steeringPrompts(node) {
  return [
    {
      label: 'Mark covered',
      text: \`In the app shape, mark "\${node.id}" covered. Evidence: <fill in file/test paths you verified>.\`,
    },
    {
      label: 'Add children',
      text: \`In the app shape, add child features under "\${node.id}": <describe them>\`,
    },
    {
      label: 'Re-assess',
      text: \`Re-assess "\${node.id}" (\${node.title}) against the code and update its coverage, gap note, and evidence honestly.\`,
    },
    {
      label: 'Challenge',
      text: \`Is "\${node.id}" really \${node.derived.coverage}? Re-read its evidence and demote it if the intent is not fully met.\`,
    },
  ];
}

/**
 * @param {DecoratedNode} node
 * @returns {RowElements}
 */
function createRow(node) {
  const container = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';

  const disclosure = document.createElement('span');
  disclosure.className = 'disclosure';
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  const title = document.createElement('span');
  title.className = 'title';
  const id = document.createElement('span');
  id.className = 'id';
  const percent = document.createElement('span');
  percent.className = 'percent';
  const gapNote = document.createElement('span');
  gapNote.className = 'gap-note';
  const prompts = document.createElement('button');
  prompts.className = 'prompts';
  prompts.type = 'button';
  prompts.textContent = '\u29C9';
  prompts.title = 'Steering prompts for this node';

  row.append(disclosure, glyph, title, id, percent, gapNote, prompts);
  const children = document.createElement('div');
  children.className = 'children';
  container.append(row, children);

  row.addEventListener('click', () => {
    if (collapsed.has(node.id)) collapsed.delete(node.id);
    else collapsed.add(node.id);
    render();
  });
  prompts.addEventListener('click', (event) => {
    event.stopPropagation();
    openPalette(node.id, prompts);
  });

  return { container, row, disclosure, glyph, title, id, percent, gapNote, children };
}

/**
 * @param {RowElements} el
 * @param {DecoratedNode} node
 * @param {number} depth
 */
function updateRow(el, node, depth) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isCollapsed = collapsed.has(node.id);
  const emphasis = node.importance === 'core' || node.importance === 'high' ? \` \${node.importance}\` : '';

  el.row.style.paddingLeft = \`\${8 + depth * 16}px\`;
  el.row.className = \`row\${emphasis}\${node.derived.suspect ? ' suspect' : ''}\`;
  el.row.title = node.intent ?? '';

  el.disclosure.className = \`disclosure\${hasChildren ? '' : ' leaf'}\`;
  el.disclosure.textContent = hasChildren ? (isCollapsed ? '\u25B8' : '\u25BE') : '\xB7';

  el.glyph.className = \`glyph \${node.derived.coverage}\`;
  el.glyph.textContent = \`\${GLYPH[node.derived.coverage]}\${node.derived.suspect ? '?' : ''}\`;

  el.title.textContent = node.title;
  el.id.textContent = node.id;
  el.percent.textContent = hasChildren ? \`\${node.derived.percent}%\` : '';
  el.gapNote.textContent = node.gap ? \`gap: \${node.gap}\` : '';
  el.children.className = \`children\${isCollapsed ? ' collapsed' : ''}\`;
}

/**
 * Patches \`parent\`'s child rows to match \`nodes\`, reusing existing elements by
 * node id so collapse state, scroll position, and focus survive a refresh.
 *
 * @param {HTMLElement} parent
 * @param {DecoratedNode[]} nodes
 * @param {number} depth
 * @param {Set<string>} alive
 */
function syncLevel(parent, nodes, depth, alive) {
  const visible = nodes.filter((node) => isVisible(node) || hasVisibleDescendant(node));
  visible.forEach((node, index) => {
    alive.add(node.id);
    nodesById.set(node.id, node);
    seedCollapse(node, depth);
    let el = rows.get(node.id);
    if (!el) {
      el = createRow(node);
      rows.set(node.id, el);
    }
    updateRow(el, node, depth);
    if (parent.children[index] !== el.container) {
      parent.insertBefore(el.container, parent.children[index] ?? null);
    }
    syncLevel(el.children, node.children ?? [], depth + 1, alive);
  });
  while (parent.children.length > visible.length) parent.lastElementChild?.remove();
}

/**
 * @param {DecoratedNode} node
 * @returns {boolean}
 */
function hasVisibleDescendant(node) {
  return (node.children ?? []).some((child) => isVisible(child) || hasVisibleDescendant(child));
}

function render() {
  if (!shape) return;
  /** @type {Set<string>} */
  const alive = new Set();
  syncLevel(treeEl, shape.areas, 0, alive);
  for (const id of rows.keys()) {
    if (!alive.has(id)) {
      rows.delete(id);
      nodesById.delete(id);
    }
  }
  renderHeader(shape);
}

/** @param {DecoratedShape} current */
function renderHeader(current) {
  must('app-name').textContent = current.name;
  must('overall').textContent = \`\${current.derived.percent}%\`;
  const counts = must('counts');
  counts.textContent = '';
  for (const entry of Object.entries(current.counts)) {
    const level = entry[0];
    const count = entry[1];
    if (count === 0) continue;
    const label = document.createElement('b');
    label.className = \`glyph \${level}\`;
    label.textContent = \`\${count} \${level}\`;
    counts.append(label, '  ');
  }
}

/**
 * @param {DecoratedNode[]} nodes
 * @param {(node: DecoratedNode) => void} visit
 */
function forEachNode(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    forEachNode(node.children ?? [], visit);
  }
}

/**
 * Anchors the prompt popover under the clicked button, clamped to the viewport.
 *
 * @param {string} id
 * @param {HTMLElement} anchor
 */
function openPalette(id, anchor) {
  const node = nodesById.get(id);
  if (!node) return;
  if (paletteEl.dataset.for === id && !paletteEl.hidden) {
    closePalette();
    return;
  }

  paletteEl.dataset.for = id;
  paletteTitleEl.textContent = \`\${node.id} \xB7 \${node.derived.coverage}\`;
  paletteBodyEl.textContent = '';
  for (const step of steeringPrompts(node)) {
    const item = document.createElement('button');
    item.className = 'palette-item';
    item.type = 'button';
    const label = document.createElement('b');
    label.textContent = step.label;
    const preview = document.createElement('i');
    preview.textContent = step.text;
    item.append(label, preview);
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      copy(step.text);
      closePalette();
    });
    paletteBodyEl.append(item);
  }

  paletteEl.hidden = false;
  const box = anchor.getBoundingClientRect();
  const width = paletteEl.offsetWidth;
  const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
  paletteEl.style.left = \`\${left + window.scrollX}px\`;
  paletteEl.style.top = \`\${box.bottom + window.scrollY + 4}px\`;
}

function closePalette() {
  paletteEl.hidden = true;
  delete paletteEl.dataset.for;
}

/** @param {string} text */
function copy(text) {
  if (!navigator.clipboard) {
    toast('clipboard unavailable');
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => toast('steering prompt copied'),
    () => toast('copy failed'),
  );
}

/** @type {number | undefined} */
let toastTimer;
/** @param {string} message */
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1600);
}

/** @returns {Promise<void>} */
async function refresh() {
  const response = await fetch('/shape');
  if (!response.ok) {
    toast('failed to load shape');
    return;
  }
  shape = /** @type {DecoratedShape} */ (await response.json());
  render();
}

must('expand-all').addEventListener('click', () => {
  collapsed.clear();
  if (shape) forEachNode(shape.areas, (node) => seeded.add(node.id));
  render();
});

must('collapse-all').addEventListener('click', () => {
  if (shape) {
    forEachNode(shape.areas, (node) => {
      seeded.add(node.id);
      if (node.children) collapsed.add(node.id);
    });
  }
  render();
});

must('gaps-only').addEventListener('change', (event) => {
  const target = /** @type {HTMLInputElement} */ (event.target);
  gapsOnly = target.checked;
  render();
});

document.addEventListener('click', (event) => {
  const target = /** @type {Node | null} */ (event.target);
  if (paletteEl.hidden || (target && paletteEl.contains(target))) return;
  closePalette();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePalette();
});

/**
 * Snapshot mode: a self-contained page carries its data inline, so it neither
 * fetches nor opens an event stream. Live mode does both.
 */
const embedded = /** @type {DecoratedShape | undefined} */ (
  /** @type {{ __SHAPE__?: DecoratedShape }} */ (window).__SHAPE__
);
if (embedded) {
  liveEl.hidden = true;
  shape = embedded;
  render();
} else {
  const events = new EventSource('/events');
  events.addEventListener('shape-changed', () => {
    void refresh();
  });
  void refresh();
}
    </script>
  </body>
</html>
`;
  }
});

// packages/viewer/dist/server.js
import { readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { createServer } from "node:http";
import { join as join5 } from "node:path";
function makeSnapshotHtml(shape) {
  const json = JSON.stringify(shape).replace(/</g, "\\u003c");
  return CLIENT_HTML.replace(SNAPSHOT_MARKER, () => `<script>window.__SHAPE__=${json}</script>`);
}
async function startViewer(repoRoot, port = DEFAULT_PORT, host = DEFAULT_HOST) {
  const clients = /* @__PURE__ */ new Set();
  const shapeDir = shapeDirPath(repoRoot);
  const server = createServer((req, res) => {
    handle(req, res, repoRoot, clients);
  });
  const bound = await listen(server, port, host);
  let fingerprint = shapeFingerprint(shapeDir);
  const poll = setInterval(() => {
    const next = shapeFingerprint(shapeDir);
    if (next === fingerprint)
      return;
    fingerprint = next;
    for (const client of clients)
      client.write("event: shape-changed\ndata: {}\n\n");
  }, POLL_MS);
  poll.unref();
  const keepAlive = setInterval(() => {
    for (const client of clients)
      client.write(": keep-alive\n\n");
  }, KEEP_ALIVE_MS);
  keepAlive.unref();
  return {
    url: `http://${host}:${bound}`,
    async close() {
      clearInterval(poll);
      clearInterval(keepAlive);
      for (const client of clients)
        client.end();
      clients.clear();
      await new Promise((resolve2, reject) => {
        server.close((err) => err ? reject(err) : resolve2());
      });
    }
  };
}
function shapeFingerprint(shapeDir) {
  let stamp = "";
  try {
    for (const file of readdirSync2(shapeDir).sort()) {
      if (!file.endsWith(".json"))
        continue;
      const stats = statSync2(join5(shapeDir, file));
      stamp += `${file}:${stats.mtimeMs}:${stats.size};`;
    }
  } catch {
    return "missing";
  }
  return stamp;
}
function handle(req, res, repoRoot, clients) {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(CLIENT_HTML);
    return;
  }
  if (path === "/shape") {
    sendShape(res, repoRoot);
    return;
  }
  if (path === "/snapshot") {
    sendSnapshot(res, repoRoot);
    return;
  }
  if (path === "/events") {
    subscribe(req, res, clients);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
}
function sendShape(res, repoRoot) {
  try {
    const body = JSON.stringify(decorateShape(loadShape(repoRoot)));
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
function sendSnapshot(res, repoRoot) {
  try {
    const body = makeSnapshotHtml(decorateShape(loadShape(repoRoot)));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": 'attachment; filename="shape-snapshot.html"'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(err instanceof Error ? err.message : String(err));
  }
}
function subscribe(req, res, clients) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive"
  });
  res.write(": connected\n\n");
  clients.add(res);
  req.on("close", () => {
    clients.delete(res);
  });
}
function listen(server, port, host) {
  return new Promise((resolve2, reject) => {
    let attempt = 0;
    const onError = (err) => {
      if (err.code !== "EADDRINUSE" || ++attempt >= PORT_ATTEMPTS) {
        server.removeListener("error", onError);
        reject(err);
        return;
      }
      server.listen(port + attempt, host);
    };
    server.on("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve2(port + attempt);
    });
  });
}
var DEFAULT_PORT, DEFAULT_HOST, PORT_ATTEMPTS, KEEP_ALIVE_MS, POLL_MS;
var init_server = __esm({
  "packages/viewer/dist/server.js"() {
    "use strict";
    init_dist();
    init_client_html();
    init_decorate();
    DEFAULT_PORT = 4820;
    DEFAULT_HOST = "127.0.0.1";
    PORT_ATTEMPTS = 21;
    KEEP_ALIVE_MS = 25e3;
    POLL_MS = 300;
  }
});

// packages/viewer/dist/index.js
var dist_exports = {};
__export(dist_exports, {
  DEFAULT_HOST: () => DEFAULT_HOST,
  DEFAULT_PORT: () => DEFAULT_PORT,
  decorateShape: () => decorateShape,
  makeSnapshotHtml: () => makeSnapshotHtml,
  startViewer: () => startViewer
});
var init_dist2 = __esm({
  "packages/viewer/dist/index.js"() {
    "use strict";
    init_decorate();
    init_server();
  }
});

// packages/cli/dist/main.js
init_dist();
import { basename } from "node:path";

// packages/cli/dist/args.js
function parseArgs(argv, spec) {
  const flags = /* @__PURE__ */ new Map();
  const positionals = [];
  let command = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (spec.boolean.includes(name)) {
        flags.set(name, true);
      } else if (spec.value.includes(name) || name === "dir") {
        const value = argv[++i];
        if (value === void 0 || value.startsWith("--")) {
          throw new Error(`--${name} requires a value`);
        }
        const existing = flags.get(name);
        if (Array.isArray(existing))
          existing.push(value);
        else
          flags.set(name, [value]);
      } else {
        throw new Error(`unknown option --${name}`);
      }
    } else if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}
function strFlag(parsed, name) {
  const value = parsed.flags.get(name);
  return Array.isArray(value) ? value[value.length - 1] : void 0;
}
function listFlag(parsed, name) {
  const value = parsed.flags.get(name);
  return Array.isArray(value) ? value : [];
}
function boolFlag(parsed, name) {
  return parsed.flags.get(name) === true;
}
function requireFlag(parsed, name) {
  const value = strFlag(parsed, name);
  if (value === void 0)
    throw new Error(`--${name} is required`);
  return value;
}
function intFlag(parsed, name) {
  const value = strFlag(parsed, name);
  if (value === void 0)
    return void 0;
  const parsed_ = Number.parseInt(value, 10);
  if (Number.isNaN(parsed_))
    throw new Error(`--${name} must be a number`);
  return parsed_;
}
function enumFlag(parsed, name, allowed) {
  const value = strFlag(parsed, name);
  if (value === void 0)
    return void 0;
  if (!allowed.includes(value)) {
    throw new Error(`invalid ${name} "${value}" (allowed: ${allowed.join(", ")})`);
  }
  return value;
}
function requirePositionals(parsed, names) {
  if (parsed.positionals.length < names.length) {
    throw new Error(`usage: shape ${parsed.command} ${names.map((n) => `<${n}>`).join(" ")}`);
  }
  return parsed.positionals;
}

// packages/cli/dist/claudemd.js
import { existsSync, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
var START = "<!-- APPSHAPE START -->";
var END = "<!-- APPSHAPE END -->";
var BLOCK = `${START}
This repo has an appshape coverage map in \`.shape/\` - a living tree of intended
features scored against the code. For every feature-related task: consult it
(\`shape tree --compact\`), steer toward gaps, and update the nodes you affect
(\`shape set ...\`). Never edit \`.shape/*.json\` directly - use the \`shape\` CLI.
Run \`shape prime\` for full usage.
${END}`;
function upsertGuidanceBlock(repoRoot, filename, options) {
  const file = join3(repoRoot, filename);
  if (!existsSync(file)) {
    if (!options.createIfMissing)
      return "skipped";
    writeFileSync2(file, `${BLOCK}
`);
    return "added";
  }
  const content = readFileSync3(file, "utf8");
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  if (start !== -1 && end > start) {
    writeFileSync2(file, content.slice(0, start) + BLOCK + content.slice(end + END.length));
    return "updated";
  }
  writeFileSync2(file, `${content.trimEnd()}

${BLOCK}
`);
  return "added";
}

// packages/cli/dist/evidence.js
init_dist();
function parseEvidenceSpec(spec) {
  const colon = spec.indexOf(":");
  if (colon === -1) {
    throw new Error(`evidence "${spec}" must be type:path (types: ${EVIDENCE_TYPES.join(", ")})`);
  }
  const type = spec.slice(0, colon);
  if (!EVIDENCE_TYPES.includes(type)) {
    throw new Error(`unknown evidence type "${type}" (types: ${EVIDENCE_TYPES.join(", ")})`);
  }
  const rest = spec.slice(colon + 1);
  const hashIndex = rest.indexOf("#");
  const path = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  if (!path)
    throw new Error(`evidence "${spec}" has an empty path`);
  const evidence = { type, path };
  if (hashIndex !== -1 && rest.slice(hashIndex + 1))
    evidence.name = rest.slice(hashIndex + 1);
  return evidence;
}
function fingerprintEvidence(repoRoot, evidence) {
  return evidence.map((e) => {
    const hash = hashFile(repoRoot, e.path);
    return hash ? { ...e, hash } : e;
  });
}

// packages/cli/dist/render.js
init_dist();
var COMPACT_CODE = {
  missing: "M",
  gap: "G",
  partial: "P",
  covered: "C",
  verified: "V"
};
var GLYPH = {
  missing: "\xB7",
  gap: "\u25CB",
  partial: "\u25D0",
  covered: "\u25CF",
  verified: "\u2714"
};
var COLOR = {
  missing: "\x1B[90m",
  gap: "\x1B[31m",
  partial: "\x1B[33m",
  covered: "\x1B[32m",
  verified: "\x1B[92m"
};
var RESET = "\x1B[0m";
var DIM = "\x1B[2m";
function countNodes(areas) {
  let count = 0;
  for (const area of areas)
    walkCount(area, () => count++);
  return count;
}
function walkCount(node, visit) {
  visit();
  for (const child of node.children ?? [])
    walkCount(child, visit);
}
function renderShape(shape, options = {}) {
  const areas = options.area ? shape.areas.filter((a) => a.id === options.area) : shape.areas;
  if (options.area && areas.length === 0)
    throw new Error(`area "${options.area}" not found`);
  const total = countNodes(areas);
  const overBudget = options.budgetNodes !== void 0 && total > options.budgetNodes;
  const effective = overBudget ? { ...options, gapsOnly: true, forceAreaLines: true } : options;
  const lines = [];
  const whole = { id: "root", title: shape.manifest.name, children: areas };
  const percent = Math.round(coverageScore(whole) * 100);
  lines.push(options.compact ? `shape ${shape.manifest.name} ${percent}%` : `${shape.manifest.name} - ${percent}% covered`);
  for (const area of areas)
    renderNode(area, 0, lines, effective, true);
  if (overBudget) {
    lines.push(`(budget mode: ${total} nodes, showing areas and open work only; run shape tree --compact for the full map)`);
  }
  return lines.join("\n");
}
function includeNode(node, options) {
  if (!options.gapsOnly)
    return true;
  const coverage = derivedCoverage(node);
  if (coverage !== "covered" && coverage !== "verified")
    return true;
  return derivedSuspect(node);
}
function renderNode(node, depth, lines, options, isArea = false) {
  if (!includeNode(node, options) && !(isArea && options.forceAreaLines))
    return;
  const coverage = derivedCoverage(node);
  const suspect = node.suspect === true;
  const indent = "  ".repeat(depth + 1);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const percent = hasChildren ? ` ${Math.round(coverageScore(node) * 100)}%` : "";
  const importance = node.importance && node.importance !== "normal" ? ` [${node.importance}]` : "";
  if (options.compact) {
    const code = `[${COMPACT_CODE[coverage]}${suspect ? "?" : ""}]`;
    const gap = node.gap ? ` !${node.gap}` : "";
    lines.push(`${indent}${code} ${node.id} ${node.title}${percent}${importance}${gap}`);
  } else {
    const paint = options.color ? COLOR[coverage] : "";
    const reset = options.color ? RESET : "";
    const dim = options.color ? DIM : "";
    const glyph = `${paint}${GLYPH[coverage]}${suspect ? "?" : ""}${reset}`;
    const gap = node.gap ? `  ${dim}gap: ${node.gap}${reset}` : "";
    const label = hasChildren ? `${node.title}${percent}` : node.title;
    lines.push(`${indent}${glyph} ${dim}${node.id}${reset} ${label}${importance}${gap}`);
  }
  const children = options.gapsOnly ? [...node.children ?? []].sort((a, b) => importanceWeight(b) - importanceWeight(a)) : node.children ?? [];
  for (const child of children)
    renderNode(child, depth + 1, lines, options);
}
function renderPrime(shape) {
  return [
    "This repo has an appshape coverage map in .shape/ - a living tree of intended",
    "features scored against the code. Consult it before choosing work; update it",
    "after building. Never edit .shape/*.json directly; use the shape CLI:",
    "  shape tree --compact         current map (statuses: V verified, C covered, P partial, G gap, M missing, ? suspect)",
    "  shape show <id>              full node detail",
    "  shape add <parent> --title <t> [--intent <EARS statement>] [--importance core|high|normal|low]",
    "  shape set <id> --coverage <level> [--gap <what is missing>] [--evidence file:path] [--evidence test:path#name]",
    "  shape rm <id> / shape mv <id> <new-parent>",
    "When you implement, change, or remove a feature, update its node (coverage,",
    "gap note, evidence) in the same session.",
    "",
    renderShape(shape, { compact: true })
  ].join("\n");
}

// packages/cli/dist/repo.js
init_dist();
import { execFileSync } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { dirname, join as join4, resolve } from "node:path";
function findRepoRoot(start) {
  let dir = resolve(start);
  for (; ; ) {
    if (existsSync2(join4(dir, SHAPE_DIR, "shape.json")))
      return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`no ${SHAPE_DIR}/ found from ${start} upward - run "shape init" first`);
    }
    dir = parent;
  }
}
function gitShortRef(repoRoot) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
  } catch {
    return void 0;
  }
}
function todayISO() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}

// packages/cli/dist/main.js
var FLAG_SPEC = {
  value: ["name", "area", "budget", "title", "id", "intent", "importance", "coverage", "gap", "evidence", "port", "host", "out"],
  boolean: ["compact", "gaps", "clear-gap", "clear-evidence", "force", "help"]
};
var USAGE = `appshape: a living coverage map for agent-built apps

usage: shape [--dir <path>] <command>

  init [--name <name>]                    scaffold .shape/ plus CLAUDE.md/AGENTS.md guidance
  tree [--compact] [--gaps] [--area <slug>] [--budget <n>]
                                          render the map (budget: degrade to areas + gaps past n nodes)
  show <id>                               full node detail plus derived status
  add <parent> --title <t> [--id <slug>] [--intent <ears>] [--importance core|high|normal|low]
                                          add a node (/ as parent creates a top-level area)
  set <id> [--coverage <level>] [--gap <text>] [--clear-gap] [--title <t>] [--intent <ears>]
           [--importance <level>] [--evidence type:path[#name]]... [--clear-evidence]
                                          update a node; --coverage stamps the assessment
  rm <id> [--force]                       remove a node or subtree
  mv <id> <new-parent>                    move a subtree (ids rewritten)
  audit                                   flag drifted claims suspect; nonzero exit if any remain
  review <id>                             clear suspect after re-assessing
  snapshot [--out <file>]                 write a self-contained HTML snapshot of the map
  view [--port <port>] [--host <host>]    live visual map in the browser
  prime                                   orientation block for agent context`;
async function run(argv) {
  const parsed = parseArgs(argv, FLAG_SPEC);
  const dir = strFlag(parsed, "dir") ?? process.cwd();
  const repoRoot = () => findRepoRoot(dir);
  switch (parsed.command) {
    case "init": {
      const name = strFlag(parsed, "name") ?? basename(dir);
      initShape(dir, name);
      const claudeMd = upsertGuidanceBlock(dir, "CLAUDE.md", { createIfMissing: true });
      const agentsMd = upsertGuidanceBlock(dir, "AGENTS.md", { createIfMissing: false });
      console.log(`initialized .shape/ for "${name}" (CLAUDE.md: ${claudeMd}, AGENTS.md: ${agentsMd})`);
      console.log('add your first area:  shape add / --title "Checkout"');
      return;
    }
    case "tree": {
      const shape = loadShape(repoRoot());
      console.log(renderShape(shape, {
        compact: boolFlag(parsed, "compact"),
        gapsOnly: boolFlag(parsed, "gaps"),
        area: strFlag(parsed, "area"),
        budgetNodes: intFlag(parsed, "budget"),
        color: !boolFlag(parsed, "compact") && process.stdout.isTTY
      }));
      return;
    }
    case "show": {
      const [id] = requirePositionals(parsed, ["id"]);
      const shape = loadShape(repoRoot());
      const node = findNode(shape, id);
      if (!node)
        throw new Error(`node "${id}" not found`);
      const { children, ...detail } = node;
      console.log(JSON.stringify({
        ...detail,
        derived: { coverage: derivedCoverage(node), percent: Math.round(coverageScore(node) * 100) },
        children: (children ?? []).map((c) => `${c.id} (${derivedCoverage(c)})`)
      }, null, 2));
      return;
    }
    case "add": {
      const [parent] = requirePositionals(parsed, ["parent"]);
      const title = requireFlag(parsed, "title");
      let createdId = "";
      updateShape(repoRoot(), (shape) => {
        createdId = addNode(shape, parent, {
          title,
          slug: strFlag(parsed, "id"),
          intent: strFlag(parsed, "intent"),
          importance: enumFlag(parsed, "importance", IMPORTANCE_LEVELS)
        }).id;
      });
      console.log(`added ${createdId}`);
      return;
    }
    case "set": {
      const [id] = requirePositionals(parsed, ["id"]);
      const root = repoRoot();
      const coverage = enumFlag(parsed, "coverage", COVERAGE_LEVELS);
      const importance = enumFlag(parsed, "importance", IMPORTANCE_LEVELS);
      const intent = strFlag(parsed, "intent");
      const evidence = listFlag(parsed, "evidence");
      let becameSuspect = false;
      updateShape(root, (shape) => {
        const node = findNode(shape, id);
        if (!node)
          throw new Error(`node "${id}" not found`);
        if ((node.children?.length ?? 0) > 0 && coverage) {
          throw new Error(`"${id}" has children - coverage is derived; set it on leaves`);
        }
        const title = strFlag(parsed, "title");
        if (title)
          node.title = title;
        if (intent) {
          if (!coverage && node.coverage && node.coverage !== "missing") {
            node.suspect = true;
            becameSuspect = true;
          }
          node.intent = intent;
        }
        if (importance)
          node.importance = importance;
        const gap = strFlag(parsed, "gap");
        if (gap)
          node.gap = gap;
        if (boolFlag(parsed, "clear-gap"))
          delete node.gap;
        if (boolFlag(parsed, "clear-evidence"))
          delete node.evidence;
        if (evidence.length > 0) {
          node.evidence = fingerprintEvidence(root, evidence.map(parseEvidenceSpec));
        }
        if (coverage) {
          const finalEvidence = evidence.length > 0 ? node.evidence : boolFlag(parsed, "clear-evidence") ? [] : node.evidence ?? [];
          if ((coverage === "covered" || coverage === "verified") && (finalEvidence?.length ?? 0) === 0) {
            throw new Error(`"${coverage}" requires --evidence linking the code that realizes the intent; without evidence use partial`);
          }
          if (coverage === "verified" && !finalEvidence?.some((e) => e.type === "test")) {
            throw new Error("verified requires test evidence (--evidence test:path#name); a claim without a test is covered at best");
          }
          node.coverage = coverage;
          delete node.suspect;
          node.assessed = { at: todayISO(), gitRef: gitShortRef(root) };
        }
      });
      console.log(`updated ${id}${becameSuspect ? " (marked suspect: intent changed, coverage needs re-assessment)" : ""}`);
      return;
    }
    case "rm": {
      const [id] = requirePositionals(parsed, ["id"]);
      updateShape(repoRoot(), (shape) => {
        const node = findNode(shape, id);
        if (!node)
          throw new Error(`node "${id}" not found`);
        if ((node.children?.length ?? 0) > 0 && !boolFlag(parsed, "force")) {
          throw new Error(`"${id}" has ${node.children.length} children - pass --force to remove the subtree`);
        }
        removeNode(shape, id);
      });
      console.log(`removed ${id}`);
      return;
    }
    case "mv": {
      const [id, newParent] = requirePositionals(parsed, ["id", "new-parent"]);
      let movedId = "";
      updateShape(repoRoot(), (shape) => {
        movedId = moveNode(shape, id, newParent).id;
      });
      console.log(`moved to ${movedId}`);
      return;
    }
    case "audit": {
      const root = repoRoot();
      let findings = [];
      let suspects = 0;
      updateShape(root, (shape) => {
        findings = auditShape(root, shape);
        suspects = suspectNodes(shape).length;
      });
      for (const finding of findings) {
        console.log(`${finding.kind === "drifted" ? "SUSPECT" : "WARN   "} ${finding.id}: ${finding.detail}`);
      }
      if (suspects > 0) {
        console.log(`${suspects} suspect node(s) - re-assess against the code, then run: shape review <id>`);
        process.exitCode = 1;
      } else {
        console.log(`audit clean${findings.length > 0 ? ` (${findings.length} warning(s))` : ""}`);
      }
      return;
    }
    case "review": {
      const [id] = requirePositionals(parsed, ["id"]);
      const root = repoRoot();
      updateShape(root, (shape) => {
        const node = findNode(shape, id);
        if (!node)
          throw new Error(`node "${id}" not found`);
        delete node.suspect;
        if (node.evidence)
          node.evidence = fingerprintEvidence(root, node.evidence);
        node.assessed = { at: todayISO(), gitRef: gitShortRef(root) };
      });
      console.log(`reviewed ${id} - suspect cleared, evidence re-fingerprinted`);
      return;
    }
    case "snapshot": {
      const root = repoRoot();
      const { decorateShape: decorateShape2, makeSnapshotHtml: makeSnapshotHtml2 } = await Promise.resolve().then(() => (init_dist2(), dist_exports));
      const { writeFileSync: writeFileSync3 } = await import("node:fs");
      const { join: join6 } = await import("node:path");
      const out = strFlag(parsed, "out") ?? join6(root, ".shape", "snapshot.html");
      writeFileSync3(out, makeSnapshotHtml2(decorateShape2(loadShape(root))));
      console.log(`snapshot written to ${out}`);
      return;
    }
    case "view": {
      const { startViewer: startViewer2 } = await Promise.resolve().then(() => (init_dist2(), dist_exports));
      const viewer = await startViewer2(repoRoot(), intFlag(parsed, "port"), strFlag(parsed, "host"));
      console.log(`appshape viewer at ${viewer.url}  (ctrl-c to stop)`);
      return;
    }
    case "prime": {
      console.log(renderPrime(loadShape(repoRoot())));
      return;
    }
    case "":
    case "help": {
      console.log(USAGE);
      return;
    }
    default:
      throw new Error(`unknown command "${parsed.command}" (run shape help)`);
  }
}
run(process.argv.slice(2)).catch((error) => {
  console.error(`shape: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
