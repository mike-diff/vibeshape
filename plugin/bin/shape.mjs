#!/usr/bin/env node
import { basename } from 'node:path';
import { COVERAGE_LEVELS, IMPORTANCE_LEVELS } from '../lib/types.mjs';
import { addNode, findNode, moveNode, removeNode } from '../lib/tree.mjs';
import { auditShape, suspectNodes } from '../lib/audit.mjs';
import { coverageScore, derivedCoverage } from '../lib/rollup.mjs';
import { initShape, loadShape, updateShape } from '../lib/store.mjs';
import { boolFlag, enumFlag, intFlag, listFlag, parseArgs, requireFlag, requirePositionals, strFlag, } from '../lib/args.mjs';
import { upsertGuidanceBlock } from '../lib/claudemd.mjs';
import { fingerprintEvidence, parseEvidenceSpec } from '../lib/evidence.mjs';
import { renderPrime, renderShape } from '../lib/render.mjs';
import { findRepoRoot, findShapeRootOrNull, gitShortRef, todayISO } from '../lib/repo.mjs';
const FLAG_SPEC = {
    value: ['name', 'area', 'budget', 'title', 'id', 'intent', 'importance', 'coverage', 'gap', 'evidence', 'port', 'host', 'out'],
    boolean: ['compact', 'gaps', 'clear-gap', 'clear-evidence', 'force', 'help'],
};
const USAGE = `appshape: a living coverage map for agent-built apps

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
    const dir = strFlag(parsed, 'dir') ?? process.cwd();
    const repoRoot = () => findRepoRoot(dir);
    switch (parsed.command) {
        case 'init': {
            const ancestor = findShapeRootOrNull(dir);
            if (ancestor !== null) {
                throw new Error(`already inside the appshape map at ${ancestor} - run shape there, or init a directory outside it`);
            }
            const name = strFlag(parsed, 'name') ?? basename(dir);
            initShape(dir, name);
            const claudeMd = upsertGuidanceBlock(dir, 'CLAUDE.md', { createIfMissing: true });
            const agentsMd = upsertGuidanceBlock(dir, 'AGENTS.md', { createIfMissing: false });
            console.log(`initialized .shape/ for "${name}" (CLAUDE.md: ${claudeMd}, AGENTS.md: ${agentsMd})`);
            console.log('add your first area:  shape add / --title "Checkout"');
            return;
        }
        case 'tree': {
            const shape = loadShape(repoRoot());
            console.log(renderShape(shape, {
                compact: boolFlag(parsed, 'compact'),
                gapsOnly: boolFlag(parsed, 'gaps'),
                area: strFlag(parsed, 'area'),
                budgetNodes: intFlag(parsed, 'budget'),
                color: !boolFlag(parsed, 'compact') && process.stdout.isTTY,
            }));
            return;
        }
        case 'show': {
            const [id] = requirePositionals(parsed, ['id']);
            const shape = loadShape(repoRoot());
            const node = findNode(shape, id);
            if (!node)
                throw new Error(`node "${id}" not found`);
            const { children, ...detail } = node;
            console.log(JSON.stringify({
                ...detail,
                derived: { coverage: derivedCoverage(node), percent: Math.round(coverageScore(node) * 100) },
                children: (children ?? []).map((c) => `${c.id} (${derivedCoverage(c)})`),
            }, null, 2));
            return;
        }
        case 'add': {
            const [parent] = requirePositionals(parsed, ['parent']);
            const title = requireFlag(parsed, 'title');
            let createdId = '';
            updateShape(repoRoot(), (shape) => {
                createdId = addNode(shape, parent, {
                    title,
                    slug: strFlag(parsed, 'id'),
                    intent: strFlag(parsed, 'intent'),
                    importance: enumFlag(parsed, 'importance', IMPORTANCE_LEVELS),
                }).id;
            });
            console.log(`added ${createdId}`);
            return;
        }
        case 'set': {
            const [id] = requirePositionals(parsed, ['id']);
            const root = repoRoot();
            const coverage = enumFlag(parsed, 'coverage', COVERAGE_LEVELS);
            const importance = enumFlag(parsed, 'importance', IMPORTANCE_LEVELS);
            const intent = strFlag(parsed, 'intent');
            const evidence = listFlag(parsed, 'evidence');
            let becameSuspect = false;
            updateShape(root, (shape) => {
                const node = findNode(shape, id);
                if (!node)
                    throw new Error(`node "${id}" not found`);
                if ((node.children?.length ?? 0) > 0 && coverage) {
                    throw new Error(`"${id}" has children - coverage is derived; set it on leaves`);
                }
                const title = strFlag(parsed, 'title');
                if (title)
                    node.title = title;
                if (intent) {
                    // A coverage verdict was judged against the old intent; a new intent
                    // invalidates it until re-assessed (unless this call re-asserts coverage).
                    if (!coverage && node.coverage && node.coverage !== 'missing') {
                        node.suspect = true;
                        becameSuspect = true;
                    }
                    node.intent = intent;
                }
                if (importance)
                    node.importance = importance;
                const gap = strFlag(parsed, 'gap');
                if (gap)
                    node.gap = gap;
                if (boolFlag(parsed, 'clear-gap'))
                    delete node.gap;
                if (boolFlag(parsed, 'clear-evidence'))
                    delete node.evidence;
                if (evidence.length > 0) {
                    node.evidence = fingerprintEvidence(root, evidence.map(parseEvidenceSpec));
                }
                if (coverage) {
                    const finalEvidence = evidence.length > 0 ? node.evidence : boolFlag(parsed, 'clear-evidence') ? [] : node.evidence ?? [];
                    if ((coverage === 'covered' || coverage === 'verified') && (finalEvidence?.length ?? 0) === 0) {
                        throw new Error(`"${coverage}" requires --evidence linking the code that realizes the intent; without evidence use partial`);
                    }
                    if (coverage === 'verified' && !finalEvidence?.some((e) => e.type === 'test')) {
                        throw new Error('verified requires test evidence (--evidence test:path#name); a claim without a test is covered at best');
                    }
                    node.coverage = coverage;
                    delete node.suspect;
                    node.assessed = { at: todayISO(), gitRef: gitShortRef(root) };
                }
            });
            console.log(`updated ${id}${becameSuspect ? ' (marked suspect: intent changed, coverage needs re-assessment)' : ''}`);
            return;
        }
        case 'rm': {
            const [id] = requirePositionals(parsed, ['id']);
            updateShape(repoRoot(), (shape) => {
                const node = findNode(shape, id);
                if (!node)
                    throw new Error(`node "${id}" not found`);
                if ((node.children?.length ?? 0) > 0 && !boolFlag(parsed, 'force')) {
                    throw new Error(`"${id}" has ${node.children.length} children - pass --force to remove the subtree`);
                }
                removeNode(shape, id);
            });
            console.log(`removed ${id}`);
            return;
        }
        case 'mv': {
            const [id, newParent] = requirePositionals(parsed, ['id', 'new-parent']);
            let movedId = '';
            updateShape(repoRoot(), (shape) => {
                movedId = moveNode(shape, id, newParent).id;
            });
            console.log(`moved to ${movedId}`);
            return;
        }
        case 'audit': {
            const root = repoRoot();
            let findings = [];
            let suspects = 0;
            updateShape(root, (shape) => {
                findings = auditShape(root, shape);
                suspects = suspectNodes(shape).length;
            });
            for (const finding of findings) {
                console.log(`${finding.kind === 'drifted' ? 'SUSPECT' : 'WARN   '} ${finding.id}: ${finding.detail}`);
            }
            if (suspects > 0) {
                console.log(`${suspects} suspect node(s) - re-assess against the code, then run: shape review <id>`);
                process.exitCode = 1;
            }
            else {
                console.log(`audit clean${findings.length > 0 ? ` (${findings.length} warning(s))` : ''}`);
            }
            return;
        }
        case 'review': {
            const [id] = requirePositionals(parsed, ['id']);
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
        case 'snapshot': {
            const root = repoRoot();
            const { decorateShape } = await import('../lib/decorate.mjs');
            const { makeSnapshotHtml } = await import('../lib/server.mjs');
            const { writeFileSync } = await import('node:fs');
            const { join } = await import('node:path');
            const out = strFlag(parsed, 'out') ?? join(root, '.shape', 'snapshot.html');
            writeFileSync(out, makeSnapshotHtml(decorateShape(loadShape(root))));
            console.log(`snapshot written to ${out}`);
            return;
        }
        case 'view': {
            const { startViewer } = await import('../lib/server.mjs');
            const viewer = await startViewer(repoRoot(), intFlag(parsed, 'port'), strFlag(parsed, 'host'));
            console.log(`appshape viewer at ${viewer.url}  (ctrl-c to stop)`);
            return;
        }
        case 'prime': {
            console.log(renderPrime(loadShape(repoRoot())));
            return;
        }
        case '':
        case 'help': {
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
