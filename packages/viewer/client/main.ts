import './style.css';
import type { Coverage } from '@appshape/core';
import type { DecoratedNode, DecoratedShape } from '../src/decorate.js';

const GLYPH: Record<Coverage, string> = {
  missing: '·',
  gap: '○',
  partial: '◐',
  covered: '●',
  verified: '✔',
};

const DEFAULT_EXPAND_DEPTH = 2;

/** Ids explicitly collapsed by the user; everything else follows depth defaults. */
const collapsed = new Set<string>();
/** Ids we have already applied the default expand depth to, so it only seeds once. */
const seeded = new Set<string>();
/** Live row elements by node id — the anchor for in-place patching. */
const rows = new Map<string, RowElements>();

interface RowElements {
  container: HTMLElement;
  row: HTMLElement;
  disclosure: HTMLElement;
  glyph: HTMLElement;
  title: HTMLElement;
  id: HTMLElement;
  percent: HTMLElement;
  gapNote: HTMLElement;
  children: HTMLElement;
}

let gapsOnly = false;
let shape: DecoratedShape | undefined;

const treeEl = must('tree');
const toastEl = must('toast');

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function isVisible(node: DecoratedNode): boolean {
  if (!gapsOnly) return true;
  if (node.derived.suspect) return true;
  return node.derived.coverage !== 'covered' && node.derived.coverage !== 'verified';
}

function seedCollapse(node: DecoratedNode, depth: number): void {
  if (seeded.has(node.id)) return;
  seeded.add(node.id);
  if (depth >= DEFAULT_EXPAND_DEPTH && node.children) collapsed.add(node.id);
}

function steeringPrompt(node: DecoratedNode): string {
  const gap = node.gap ? `, gap: ${node.gap}` : '';
  return `In the app shape, look at "${node.id}" (${node.title}). Current: ${node.derived.coverage}${gap}. `;
}

function createRow(node: DecoratedNode): RowElements {
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
  const copy = document.createElement('button');
  copy.className = 'copy';
  copy.type = 'button';
  copy.textContent = 'copy';
  copy.title = 'Copy a steering prompt for this node';

  row.append(disclosure, glyph, title, id, percent, gapNote, copy);
  const children = document.createElement('div');
  children.className = 'children';
  container.append(row, children);

  row.addEventListener('click', () => {
    if (collapsed.has(node.id)) collapsed.delete(node.id);
    else collapsed.add(node.id);
    render();
  });
  copy.addEventListener('click', (event) => {
    event.stopPropagation();
    const current = rows.get(node.id)?.container.dataset.prompt ?? '';
    void navigator.clipboard.writeText(current).then(
      () => toast('steering prompt copied'),
      () => toast('copy failed'),
    );
  });

  return { container, row, disclosure, glyph, title, id, percent, gapNote, children };
}

function updateRow(el: RowElements, node: DecoratedNode, depth: number): void {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isCollapsed = collapsed.has(node.id);

  el.container.dataset.prompt = steeringPrompt(node);
  el.row.style.paddingLeft = `${8 + depth * 16}px`;
  el.row.className = `row${node.importance === 'core' || node.importance === 'high' ? ` ${node.importance}` : ''}${node.derived.suspect ? ' suspect' : ''}`;
  el.row.title = node.intent ?? '';

  el.disclosure.className = `disclosure${hasChildren ? '' : ' leaf'}`;
  el.disclosure.textContent = hasChildren ? (isCollapsed ? '▸' : '▾') : '·';

  el.glyph.className = `glyph ${node.derived.coverage}`;
  el.glyph.textContent = `${GLYPH[node.derived.coverage]}${node.derived.suspect ? '?' : ''}`;

  el.title.textContent = node.title;
  el.id.textContent = node.id;
  el.percent.textContent = hasChildren ? `${node.derived.percent}%` : '';
  el.gapNote.textContent = node.gap ? `gap: ${node.gap}` : '';
  el.children.className = `children${isCollapsed ? ' collapsed' : ''}`;
}

/**
 * Patches `parent`'s child rows to match `nodes`, reusing existing elements by
 * node id so collapse state, scroll position, and focus survive a refresh.
 */
function syncLevel(parent: HTMLElement, nodes: DecoratedNode[], depth: number, alive: Set<string>): void {
  const visible = nodes.filter((node) => isVisible(node) || hasVisibleDescendant(node));
  visible.forEach((node, index) => {
    alive.add(node.id);
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
  while (parent.children.length > visible.length) parent.lastElementChild!.remove();
}

function hasVisibleDescendant(node: DecoratedNode): boolean {
  return (node.children ?? []).some((child) => isVisible(child) || hasVisibleDescendant(child));
}

function render(): void {
  if (!shape) return;
  const alive = new Set<string>();
  syncLevel(treeEl, shape.areas, 0, alive);
  for (const id of rows.keys()) if (!alive.has(id)) rows.delete(id);
  renderHeader(shape);
}

function renderHeader(current: DecoratedShape): void {
  must('app-name').textContent = current.name;
  must('overall').textContent = `${current.derived.percent}%`;
  const counts = must('counts');
  counts.textContent = '';
  for (const [level, count] of Object.entries(current.counts) as [Coverage, number][]) {
    if (count === 0) continue;
    const label = document.createElement('b');
    label.className = `glyph ${level}`;
    label.textContent = `${count} ${level}`;
    counts.append(label, '  ');
  }
}

function forEachNode(nodes: DecoratedNode[], visit: (node: DecoratedNode) => void): void {
  for (const node of nodes) {
    visit(node);
    forEachNode(node.children ?? [], visit);
  }
}

let toastTimer: number | undefined;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1600);
}

async function refresh(): Promise<void> {
  const response = await fetch('/shape');
  if (!response.ok) {
    toast('failed to load shape');
    return;
  }
  shape = (await response.json()) as DecoratedShape;
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
  gapsOnly = (event.target as HTMLInputElement).checked;
  render();
});

const events = new EventSource('/events');
events.addEventListener('shape-changed', () => {
  void refresh();
});

void refresh();
