import { coverageScore, derivedCoverage, derivedSuspect, importanceWeight } from './rollup.mjs';
const COMPACT_CODE = {
    missing: 'M',
    gap: 'G',
    partial: 'P',
    covered: 'C',
    verified: 'V',
};
const GLYPH = {
    missing: '·',
    gap: '○',
    partial: '◐',
    covered: '●',
    verified: '✔',
};
const COLOR = {
    missing: '\x1b[90m',
    gap: '\x1b[31m',
    partial: '\x1b[33m',
    covered: '\x1b[32m',
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
    visit();
    for (const child of node.children ?? [])
        walkCount(child, visit);
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
    lines.push(options.compact
        ? `shape ${shape.manifest.name} ${percent}%`
        : `${shape.manifest.name} - ${percent}% covered`);
    if (overBudget) {
        renderBudgetDigest(areas, total, lines, options);
        return lines.join('\n');
    }
    for (const area of areas)
        renderNode(area, 0, lines, options, true);
    return lines.join('\n');
}

// Over budget the payload must be CAPPED, not merely filtered: a young map
// that is mostly open work would otherwise render nearly in full. One line
// per area, then the top open leaves by importance, then an honest count of
// what was left out.
const BUDGET_TOP_OPEN = 40;
function renderBudgetDigest(areas, total, lines, options) {
    for (const area of areas)
        renderNode(area, 0, lines, { ...options, gapsOnly: false }, true, false);
    const open = [];
    for (const area of areas)
        collectOpenLeaves(area, open);
    open.sort((a, b) => importanceWeight(b) - importanceWeight(a));
    for (const leaf of open.slice(0, BUDGET_TOP_OPEN))
        renderNode(leaf, 1, lines, { ...options, gapsOnly: false });
    const hidden = open.length - Math.min(open.length, BUDGET_TOP_OPEN);
    lines.push(`(budget mode: ${total} nodes; showing ${areas.length} areas and top ${Math.min(open.length, BUDGET_TOP_OPEN)} open items${hidden > 0 ? `, +${hidden} more open` : ''}; run shape tree --compact --gaps for everything open)`);
}
function collectOpenLeaves(node, out) {
    const children = node.children ?? [];
    if (children.length === 0) {
        const coverage = derivedCoverage(node);
        if (coverage !== 'covered' && coverage !== 'verified' || node.suspect)
            out.push(node);
        return;
    }
    for (const child of children)
        collectOpenLeaves(child, out);
}
function includeNode(node, options) {
    if (!options.gapsOnly)
        return true;
    const coverage = derivedCoverage(node);
    if (coverage !== 'covered' && coverage !== 'verified')
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
export function renderPrime(shape) {
    return [
        'This repo has an appshape coverage map in .shape/ - a living tree of intended',
        'features scored against the code. Consult it before choosing work; update it',
        'after building. Never edit .shape/*.json directly; use the shape CLI:',
        '  shape tree --compact         current map (statuses: V verified, C covered, P partial, G gap, M missing, ? suspect)',
        '  shape show <id>              full node detail',
        '  shape add <parent> --title <t> [--intent <EARS statement>] [--importance core|high|normal|low]',
        '  shape set <id> --coverage <level> [--gap <what is missing>] [--evidence file:path] [--evidence test:path#name]',
        '  shape rm <id> / shape mv <id> <new-parent>',
        'When you implement, change, or remove a feature, update its node (coverage,',
        'gap note, evidence) in the same session.',
        '',
        renderShape(shape, { compact: true }),
    ].join('\n');
}
