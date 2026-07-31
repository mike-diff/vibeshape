#!/usr/bin/env node
import { basename } from 'node:path';
import { Command } from 'commander';
import {
  COVERAGE_LEVELS,
  IMPORTANCE_LEVELS,
  addNode,
  auditShape,
  coverageScore,
  derivedCoverage,
  findNode,
  initShape,
  loadShape,
  moveNode,
  removeNode,
  suspectNodes,
  updateShape,
} from '@appshape/core';
import type { Coverage, Importance } from '@appshape/core';
import { upsertClaudeMdBlock } from './claudemd.js';
import { fingerprintEvidence, parseEvidenceSpec } from './evidence.js';
import { renderPrime, renderShape } from './render.js';
import { findRepoRoot, gitShortRef, todayISO } from './repo.js';

const program = new Command();

program
  .name('shape')
  .description('appshape: a living coverage map for agent-built apps')
  .option('--dir <path>', 'repo directory (default: walk up from cwd)', process.cwd());

function repoRoot(): string {
  return findRepoRoot(program.opts<{ dir: string }>().dir);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function enumOption<T extends string>(name: string, allowed: readonly T[]): (value: string) => T {
  return (value) => {
    if (!allowed.includes(value as T)) {
      throw new Error(`invalid ${name} "${value}" (allowed: ${allowed.join(', ')})`);
    }
    return value as T;
  };
}

program
  .command('init')
  .description('scaffold a .shape/ folder in the current directory')
  .option('--name <name>', 'app name (default: directory basename)')
  .action((options: { name?: string }) => {
    const dir = program.opts<{ dir: string }>().dir;
    const name = options.name ?? basename(dir);
    initShape(dir, name);
    const claudeMd = upsertClaudeMdBlock(dir);
    console.log(`initialized .shape/ for "${name}" (${claudeMd} CLAUDE.md guidance)`);
    console.log('add your first area:  shape add / --title "Checkout"');
  });

program
  .command('tree')
  .description('render the shape tree')
  .option('--compact', 'plain, token-efficient output for agent context')
  .option('--gaps', 'only nodes that are not covered (or are suspect)')
  .option('--area <slug>', 'limit to one top-level area')
  .action((options: { compact?: boolean; gaps?: boolean; area?: string }) => {
    const shape = loadShape(repoRoot());
    console.log(
      renderShape(shape, {
        compact: options.compact,
        gapsOnly: options.gaps,
        area: options.area,
        color: !options.compact && process.stdout.isTTY,
      }),
    );
  });

program
  .command('show')
  .description('full detail for one node')
  .argument('<id>', 'node id, e.g. auth/oauth-login')
  .action((id: string) => {
    const shape = loadShape(repoRoot());
    const node = findNode(shape, id);
    if (!node) throw new Error(`node "${id}" not found`);
    const { children, ...detail } = node;
    console.log(
      JSON.stringify(
        {
          ...detail,
          derived: {
            coverage: derivedCoverage(node),
            percent: Math.round(coverageScore(node) * 100),
          },
          children: (children ?? []).map((c) => `${c.id} (${derivedCoverage(c)})`),
        },
        null,
        2,
      ),
    );
  });

program
  .command('add')
  .description('add a node ("/" as parent creates a new top-level area)')
  .argument('<parent>', 'parent node id, or / for a new area')
  .requiredOption('--title <title>', 'node title')
  .option('--id <slug>', 'slug override (default: derived from title)')
  .option('--intent <intent>', 'EARS-style intent statement')
  .option('--importance <level>', `one of: ${IMPORTANCE_LEVELS.join(', ')}`, enumOption('importance', IMPORTANCE_LEVELS))
  .action((parent: string, options: { title: string; id?: string; intent?: string; importance?: Importance }) => {
    let createdId = '';
    updateShape(repoRoot(), (shape) => {
      createdId = addNode(shape, parent, {
        title: options.title,
        slug: options.id,
        intent: options.intent,
        importance: options.importance,
      }).id;
    });
    console.log(`added ${createdId}`);
  });

program
  .command('set')
  .description('update a node; setting --coverage stamps the assessment date and git ref')
  .argument('<id>', 'node id')
  .option('--coverage <level>', `one of: ${COVERAGE_LEVELS.join(', ')}`, enumOption('coverage', COVERAGE_LEVELS))
  .option('--gap <text>', 'what is missing or weak')
  .option('--clear-gap', 'remove the gap note')
  .option('--title <title>')
  .option('--intent <intent>')
  .option('--importance <level>', `one of: ${IMPORTANCE_LEVELS.join(', ')}`, enumOption('importance', IMPORTANCE_LEVELS))
  .option('--evidence <spec>', 'type:path or type:path#name (repeatable, replaces prior evidence)', collect, [])
  .option('--clear-evidence', 'remove all evidence')
  .action((id: string, options: {
    coverage?: Coverage;
    gap?: string;
    clearGap?: boolean;
    title?: string;
    intent?: string;
    importance?: Importance;
    evidence: string[];
    clearEvidence?: boolean;
  }) => {
    const root = repoRoot();
    updateShape(root, (shape) => {
      const node = findNode(shape, id);
      if (!node) throw new Error(`node "${id}" not found`);
      if ((node.children?.length ?? 0) > 0 && options.coverage) {
        throw new Error(`"${id}" has children — coverage is derived; set it on leaves`);
      }
      if (options.title) node.title = options.title;
      if (options.intent) node.intent = options.intent;
      if (options.importance) node.importance = options.importance;
      if (options.gap) node.gap = options.gap;
      if (options.clearGap) delete node.gap;
      if (options.clearEvidence) delete node.evidence;
      if (options.evidence.length > 0) {
        node.evidence = fingerprintEvidence(root, options.evidence.map(parseEvidenceSpec));
      }
      if (options.coverage) {
        node.coverage = options.coverage;
        delete node.suspect;
        node.assessed = { at: todayISO(), gitRef: gitShortRef(root) };
      }
    });
    console.log(`updated ${id}`);
  });

program
  .command('rm')
  .description('remove a node (and its subtree)')
  .argument('<id>', 'node id')
  .option('--force', 'required when the node has children')
  .action((id: string, options: { force?: boolean }) => {
    updateShape(repoRoot(), (shape) => {
      const node = findNode(shape, id);
      if (!node) throw new Error(`node "${id}" not found`);
      if ((node.children?.length ?? 0) > 0 && !options.force) {
        throw new Error(`"${id}" has ${node.children!.length} children — pass --force to remove the subtree`);
      }
      removeNode(shape, id);
    });
    console.log(`removed ${id}`);
  });

program
  .command('mv')
  .description('move a node (and its subtree) under a new parent')
  .argument('<id>', 'node id')
  .argument('<new-parent>', 'new parent node id')
  .action((id: string, newParent: string) => {
    let movedId = '';
    updateShape(repoRoot(), (shape) => {
      movedId = moveNode(shape, id, newParent).id;
    });
    console.log(`moved to ${movedId}`);
  });

program
  .command('audit')
  .description('flag coverage claims whose evidence drifted; nonzero exit if any suspects remain')
  .action(() => {
    const root = repoRoot();
    let findings: ReturnType<typeof auditShape> = [];
    let suspects = 0;
    updateShape(root, (shape) => {
      findings = auditShape(root, shape);
      suspects = suspectNodes(shape).length;
    });
    for (const finding of findings) {
      console.log(`${finding.kind === 'drifted' ? 'SUSPECT' : 'WARN   '} ${finding.id}: ${finding.detail}`);
    }
    if (suspects > 0) {
      console.log(`${suspects} suspect node(s) — re-assess against the code, then run: shape review <id>`);
      process.exitCode = 1;
    } else {
      console.log(`audit clean${findings.length > 0 ? ` (${findings.length} warning(s))` : ''}`);
    }
  });

program
  .command('review')
  .description('clear a suspect flag after re-assessing: re-fingerprints evidence and re-stamps the assessment')
  .argument('<id>', 'node id')
  .action((id: string) => {
    const root = repoRoot();
    updateShape(root, (shape) => {
      const node = findNode(shape, id);
      if (!node) throw new Error(`node "${id}" not found`);
      delete node.suspect;
      if (node.evidence) node.evidence = fingerprintEvidence(root, node.evidence);
      node.assessed = { at: todayISO(), gitRef: gitShortRef(root) };
    });
    console.log(`reviewed ${id} — suspect cleared, evidence re-fingerprinted`);
  });

program
  .command('view')
  .description('open the live visual map in the browser')
  .option('--port <port>', 'port to serve on (default 4820)', (value) => Number.parseInt(value, 10))
  .action(async (options: { port?: number }) => {
    const { startViewer } = await import('@appshape/viewer');
    const viewer = await startViewer(repoRoot(), options.port);
    console.log(`appshape viewer at ${viewer.url}  (ctrl-c to stop)`);
  });

program
  .command('prime')
  .description('orientation block for agent context: usage plus compact tree')
  .action(() => {
    console.log(renderPrime(loadShape(repoRoot())));
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`shape: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
