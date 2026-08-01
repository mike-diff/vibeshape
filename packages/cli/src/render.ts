import { coverageScore, derivedCoverage, derivedSuspect, importanceWeight } from '@appshape/core';
import type { Coverage, Shape, ShapeNode } from '@appshape/core';

const COMPACT_CODE: Record<Coverage, string> = {
  missing: 'M',
  gap: 'G',
  partial: 'P',
  covered: 'C',
  verified: 'V',
};

const GLYPH: Record<Coverage, string> = {
  missing: '·',
  gap: '○',
  partial: '◐',
  covered: '●',
  verified: '✔',
};

const COLOR: Record<Coverage, string> = {
  missing: '\x1b[90m',
  gap: '\x1b[31m',
  partial: '\x1b[33m',
  covered: '\x1b[32m',
  verified: '\x1b[92m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

export interface RenderOptions {
  compact?: boolean;
  gapsOnly?: boolean;
  area?: string;
  color?: boolean;
  /** Past this many total nodes, degrade to area lines plus gap/suspect leaves. */
  budgetNodes?: number;
  /** Internal: render top-level area lines even when gapsOnly would hide them. */
  forceAreaLines?: boolean;
}

function countNodes(areas: ShapeNode[]): number {
  let count = 0;
  for (const area of areas) walkCount(area, () => count++);
  return count;
}

function walkCount(node: ShapeNode, visit: () => void): void {
  visit();
  for (const child of node.children ?? []) walkCount(child, visit);
}

export function renderShape(shape: Shape, options: RenderOptions = {}): string {
  const areas = options.area ? shape.areas.filter((a) => a.id === options.area) : shape.areas;
  if (options.area && areas.length === 0) throw new Error(`area "${options.area}" not found`);
  const total = countNodes(areas);
  const overBudget = options.budgetNodes !== undefined && total > options.budgetNodes;
  const effective: RenderOptions = overBudget ? { ...options, gapsOnly: true, forceAreaLines: true } : options;
  const lines: string[] = [];
  const whole: ShapeNode = { id: 'root', title: shape.manifest.name, children: areas };
  const percent = Math.round(coverageScore(whole) * 100);
  lines.push(
    options.compact
      ? `shape ${shape.manifest.name} ${percent}%`
      : `${shape.manifest.name} - ${percent}% covered`,
  );
  for (const area of areas) renderNode(area, 0, lines, effective, true);
  if (overBudget) {
    lines.push(`(budget mode: ${total} nodes, showing areas and open work only; run shape tree --compact for the full map)`);
  }
  return lines.join('\n');
}

function includeNode(node: ShapeNode, options: RenderOptions): boolean {
  if (!options.gapsOnly) return true;
  const coverage = derivedCoverage(node);
  if (coverage !== 'covered' && coverage !== 'verified') return true;
  return derivedSuspect(node);
}

function renderNode(node: ShapeNode, depth: number, lines: string[], options: RenderOptions, isArea = false): void {
  if (!includeNode(node, options) && !(isArea && options.forceAreaLines)) return;
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
  } else {
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
  const children = options.gapsOnly
    ? [...(node.children ?? [])].sort((a, b) => importanceWeight(b) - importanceWeight(a))
    : node.children ?? [];
  for (const child of children) renderNode(child, depth + 1, lines, options);
}

/** Orientation block for agent context: usage summary plus compact tree. */
export function renderPrime(shape: Shape): string {
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
