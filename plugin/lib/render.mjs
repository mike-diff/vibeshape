import { coverageScore, derivedCoverage, derivedSuspect, importanceWeight } from './rollup.mjs';
const COMPACT_CODE = {
    missing: 'M',
    gap: 'G',
    partial: 'P',
    covered: 'C',
    linked: 'L',
    verified: 'V',
};
const GLYPH = {
    missing: '·',
    gap: '○',
    partial: '◐',
    covered: '●',
    linked: '◆',
    verified: '✔',
};
const COLOR = {
    missing: '\x1b[90m',
    gap: '\x1b[31m',
    partial: '\x1b[33m',
    covered: '\x1b[32m',
    linked: '\x1b[36m',
    verified: '\x1b[92m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
function countNodes(areas) {
    let count = 0;
    for (const area of areas)
        walkCount(area, () => count++);
    return count;
}
function walkCount(node, visit) {
    visit(node);
    for (const child of node.children ?? [])
        walkCount(child, visit);
}
/**
 * The header split: how much of the map is executed fact (V), named-but-unrun
 * claim (L), and how much is under suspicion. "asserted" names what the
 * percentage actually measures - claims made, not truths proven.
 */
export function assertionCounts(areas) {
    let verified = 0;
    let linked = 0;
    let suspect = 0;
    for (const area of areas) {
        walkCount(area, (node) => {
            if (node.suspect === true)
                suspect++;
            if ((node.children?.length ?? 0) > 0)
                return;
            const coverage = derivedCoverage(node);
            if (coverage === 'verified')
                verified++;
            else if (coverage === 'linked')
                linked++;
        });
    }
    return { verified, linked, suspect };
}
export function renderShape(shape, options = {}) {
    const areas = options.area ? shape.areas.filter((a) => a.id === options.area) : shape.areas;
    if (options.area && areas.length === 0)
        throw new Error(`area "${options.area}" not found`);
    const total = countNodes(areas);
    const overBudget = options.budgetNodes !== undefined && total > options.budgetNodes;
    const lines = [];
    const whole = { id: 'root', title: shape.manifest.name, children: areas };
    const percent = Math.round(coverageScore(whole) * 100);
    const split = assertionCounts(areas);
    const summary = `${percent}% asserted (V ${split.verified} L ${split.linked} ?${split.suspect})`;
    lines.push(options.compact
        ? `shape ${shape.manifest.name} ${summary}`
        : `${shape.manifest.name} ${summary}`);
    if (overBudget) {
        renderBudgetDigest(areas, total, lines, options);
        return clampToBytes(lines.join('\n'), BUDGET_MAX_BYTES);
    }
    for (const area of areas)
        renderNode(area, 0, lines, options, true);
    return lines.join('\n');
}

// Over budget the payload must be CAPPED, not merely filtered: a young map
// that is mostly open work would otherwise render nearly in full. Areas and
// open items are each capped by count, the leftovers are counted honestly,
// and the whole thing is finally clamped to a byte ceiling - because a cap on
// lines is not a cap on bytes when titles and gap notes can be long.
const BUDGET_TOP_OPEN = 40;
const BUDGET_TOP_AREAS = 20;
const BUDGET_MAX_BYTES = 8192;
/**
 * Ranking for what earns a place in a truncated digest: the areas and items
 * carrying the most open work come first, ties broken by id so two renders of
 * the same map are byte-identical.
 */
function byOpenWork(weightOf) {
    return (a, b) => weightOf(b) - weightOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function openWeight(node) {
    let sum = 0;
    const open = [];
    collectOpenLeaves(node, open);
    for (const leaf of open)
        sum += importanceWeight(leaf);
    return sum;
}
function renderBudgetDigest(areas, total, lines, options) {
    const rankedAreas = [...areas].sort(byOpenWork(openWeight));
    const shownAreas = rankedAreas.slice(0, BUDGET_TOP_AREAS);
    const open = [];
    for (const area of areas)
        collectOpenLeaves(area, open);
    open.sort(byOpenWork(importanceWeight));
    const shownOpen = Math.min(open.length, BUDGET_TOP_OPEN);
    const hiddenAreas = areas.length - shownAreas.length;
    const hiddenOpen = open.length - shownOpen;
    // Counts come FIRST, before any body line. They are the honest part of a
    // truncated payload, so they must not be what the byte clamp drops.
    lines.push(`(budget mode: ${total} nodes; showing ${shownAreas.length} of ${areas.length} areas and top ${shownOpen} open items${hiddenAreas > 0 ? `, +${hiddenAreas} more areas` : ''}${hiddenOpen > 0 ? `, +${hiddenOpen} more open` : ''}; run shape tree --compact --gaps for everything open)`);
    for (const area of shownAreas)
        renderNode(area, 0, lines, { ...options, gapsOnly: false }, true, false);
    for (const leaf of open.slice(0, BUDGET_TOP_OPEN))
        renderNode(leaf, 1, lines, { ...options, gapsOnly: false });
}
/**
 * The last word on size. Line caps bound how MANY lines render, not how long
 * they are, so a map with maximal titles and gap notes can still blow the
 * context budget this whole mode exists to protect. Truncates at a line
 * boundary and says so.
 */
function clampToBytes(text, maxBytes) {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes)
        return text;
    const lines = text.split('\n');
    const kept = [];
    let bytes = 0;
    for (const line of lines) {
        const cost = Buffer.byteLength(line, 'utf8') + 1;
        if (bytes + cost > maxBytes - TRUNCATION_RESERVE)
            break;
        kept.push(line);
        bytes += cost;
    }
    kept.push(`(truncated at ${maxBytes} bytes: ${lines.length - kept.length} more line(s); run shape tree --compact --gaps for everything open)`);
    return kept.join('\n');
}
// Headroom for the truncation marker itself, which must always fit.
const TRUNCATION_RESERVE = 160;
/** Levels that count as closed work: everything else is still open. */
const CLOSED = new Set(['covered', 'linked', 'verified']);
function collectOpenLeaves(node, out) {
    const children = node.children ?? [];
    if (children.length === 0) {
        if (!CLOSED.has(derivedCoverage(node)) || node.suspect)
            out.push(node);
        return;
    }
    for (const child of children)
        collectOpenLeaves(child, out);
}
function includeNode(node, options) {
    if (!options.gapsOnly)
        return true;
    if (!CLOSED.has(derivedCoverage(node)))
        return true;
    return derivedSuspect(node);
}
function renderNode(node, depth, lines, options, isArea = false, recurse = true) {
    if (!includeNode(node, options) && !(isArea && options.forceAreaLines))
        return;
    const coverage = derivedCoverage(node);
    const suspect = node.suspect === true;
    const indent = '  '.repeat(depth + 1);
    const hasChildren = (node.children?.length ?? 0) > 0;
    const percent = hasChildren ? ` ${Math.round(coverageScore(node) * 100)}%` : '';
    const importance = node.importance && node.importance !== 'normal' ? ` [${node.importance}]` : '';
    if (options.compact) {
        const code = `[${COMPACT_CODE[coverage]}${suspect ? '?' : ''}]`;
        const gap = node.gap ? ` !${node.gap}` : '';
        lines.push(`${indent}${code} ${node.id} ${node.title}${percent}${importance}${gap}`);
    }
    else {
        const paint = options.color ? COLOR[coverage] : '';
        const reset = options.color ? RESET : '';
        const dim = options.color ? DIM : '';
        const glyph = `${paint}${GLYPH[coverage]}${suspect ? '?' : ''}${reset}`;
        const gap = node.gap ? `  ${dim}gap: ${node.gap}${reset}` : '';
        const label = hasChildren ? `${node.title}${percent}` : node.title;
        lines.push(`${indent}${glyph} ${dim}${node.id}${reset} ${label}${importance}${gap}`);
    }
    // In filtered views, surface important open work first; the full tree
    // keeps authored order.
    if (!recurse)
        return;
    const children = options.gapsOnly
        ? [...(node.children ?? [])].sort((a, b) => importanceWeight(b) - importanceWeight(a))
        : node.children ?? [];
    for (const child of children)
        renderNode(child, depth + 1, lines, options);
}
/** Orientation block for agent context: usage summary plus compact tree. */
export const DEFAULT_BUDGET_NODES = 120;
export function renderPrime(shape, budgetNodes = DEFAULT_BUDGET_NODES) {
    return [
        'This repo has a vibeshape coverage map in .shape/ - a living tree of intended',
        'features scored against the code. Consult it before choosing work; update it',
        'after building. Never edit .shape/*.json directly; use the shape CLI:',
        '  shape tree --compact         current map (statuses: V verified, L linked, C covered, P partial, G gap, M missing, ? suspect)',
        '  shape show <id>              full node detail',
        '  shape add <parent> --title <t> [--intent <EARS statement>] [--importance core|high|normal|low]',
        '  shape set <id> --coverage <level> [--gap <what is missing>] [--evidence file:path] [--evidence test:path#name]',
        '  shape rm <id> / shape mv <id> <new-parent>',
        'When you implement, change, or remove a feature, update its node (coverage,',
        'gap note, evidence) in the same session.',
        '',
        renderShape(shape, { compact: true, budgetNodes }),
    ].join('\n');
}
