/**
 * The appshape viewer client. No imports, no bundler: lib/server.mjs inlines
 * this file into the page it serves. Types mirror lib/decorate.mjs via JSDoc.
 *
 * @typedef {'missing' | 'gap' | 'partial' | 'covered' | 'linked' | 'verified'} Coverage
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
 * @property {number} suspectCount
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
  missing: '·',
  gap: '○',
  partial: '◐',
  covered: '●',
  linked: '◆',
  verified: '✔',
};

const DEFAULT_EXPAND_DEPTH = 2;

/** Levels that count as closed work, hidden by the gaps-only filter. */
const CLOSED = ['covered', 'linked', 'verified'];

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
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/**
 * @param {DecoratedNode} node
 * @returns {boolean}
 */
function isVisible(node) {
  if (!gapsOnly) return true;
  if (node.derived.suspect) return true;
  return !CLOSED.includes(node.derived.coverage);
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
      text: `In the app shape, mark "${node.id}" covered. Evidence: <fill in file/test paths you verified>.`,
    },
    {
      label: 'Add children',
      text: `In the app shape, add child features under "${node.id}": <describe them>`,
    },
    {
      label: 'Re-assess',
      text: `Re-assess "${node.id}" (${node.title}) against the code and update its coverage, gap note, and evidence honestly.`,
    },
    {
      label: 'Challenge',
      text: `Is "${node.id}" really ${node.derived.coverage}? Re-read its evidence and demote it if the intent is not fully met.`,
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
  prompts.textContent = '⧉';
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
  const emphasis = node.importance === 'core' || node.importance === 'high' ? ` ${node.importance}` : '';

  el.row.style.paddingLeft = `${8 + depth * 16}px`;
  el.row.className = `row${emphasis}${node.derived.suspect ? ' suspect' : ''}`;
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
  // The same honest split the CLI header carries: how much is executed fact,
  // how much is a named-but-unrun claim, how much is under suspicion.
  must('overall').textContent =
    `${current.derived.percent}% asserted (V ${current.counts.verified} L ${current.counts.linked} ?${current.suspectCount})`;
  const counts = must('counts');
  counts.textContent = '';
  for (const entry of Object.entries(current.counts)) {
    const level = entry[0];
    const count = entry[1];
    if (count === 0) continue;
    const label = document.createElement('b');
    label.className = `glyph ${level}`;
    label.textContent = `${count} ${level}`;
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
  paletteTitleEl.textContent = `${node.id} · ${node.derived.coverage}`;
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
  paletteEl.style.left = `${left + window.scrollX}px`;
  paletteEl.style.top = `${box.bottom + window.scrollY + 4}px`;
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
