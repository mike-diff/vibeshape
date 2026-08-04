#!/usr/bin/env node
import { basename } from 'node:path';
import { COVERAGE_LEVELS, IMPORTANCE_LEVELS } from '../lib/types.mjs';
import { cleanText } from '../lib/schema.mjs';
import { addNode, findNode, moveNode, removeNode, walk } from '../lib/tree.mjs';
import { auditShape, suspectNodes } from '../lib/audit.mjs';
import { coverageScore, derivedCoverage } from '../lib/rollup.mjs';
import { initShape, loadShape, updateShape } from '../lib/store.mjs';
import { migrateOnWrite } from '../lib/migrate.mjs';
import { boolFlag, enumFlag, intFlag, listFlag, parseArgs, requireFlag, requirePositionals, strFlag, } from '../lib/args.mjs';
import { upsertGuidanceBlock } from '../lib/claudemd.mjs';
import { fingerprintEvidence, hasNamedTestEvidence, parseEvidenceSpec } from '../lib/evidence.mjs';
import { runTestEvidence } from '../lib/verify.mjs';
import { renderPrime, renderShape } from '../lib/render.mjs';
import { findRepoRoot, findShapeRootOrNull, gitShortRef, todayISO } from '../lib/repo.mjs';
/** Levels that assert the intent is realized, so they owe evidence. */
const CLAIM_LEVELS = new Set(['covered', 'linked', 'verified']);
/**
 * linked and verified both mean "a named test stands behind this"; only
 * verified adds that it was executed and passed.
 */
function requireNamedTest(coverage, evidence) {
    if (!hasNamedTestEvidence(evidence)) {
        throw new Error(`${coverage} requires named test evidence (--evidence test:path#name); a claim without a named test is covered at best`);
    }
}
const FLAG_SPEC = {
    value: ['name', 'area', 'budget', 'title', 'id', 'intent', 'importance', 'coverage', 'gap', 'evidence', 'port', 'host', 'out', 'verify-command'],
    boolean: ['compact', 'gaps', 'clear-gap', 'clear-evidence', 'force', 'help', 'run'],
};
const USAGE = `vibeshape: a living coverage map for agent-built apps

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
                                          levels: missing gap partial covered linked verified
                                          linked = a named test is cited; verified = it was executed and passed
  rm <id> [--force]                       remove a node or subtree
  mv <id> <new-parent>                    move a subtree (ids rewritten)
  audit [--run]                           flag drifted and unfounded claims suspect (--run also executes verified tests); nonzero exit if any remain
  config [--verify-command <tpl>]         show or set repo config; tpl runs tests with {path} and {name} placeholders
                                          --verify-command none clears it and demotes verified to linked
  snapshot [--out <file>]                 write a self-contained HTML snapshot of the map
  view [--port <port>] [--host <host>]    live visual map in the browser
  prime                                   orientation block for agent context`;
async function run(argv) {
    const parsed = parseArgs(argv, FLAG_SPEC);
    const dir = strFlag(parsed, 'dir') ?? process.cwd();
    const repoRoot = () => findRepoRoot(dir);
    // Every command that writes migrates first, so a v1 map is brought to v2
    // exactly once, by a caller that was going to take the lock anyway.
    // Read-only commands and hooks never migrate: they demote in memory.
    const writableRoot = () => {
        const root = findRepoRoot(dir);
        migrateOnWrite(root);
        return root;
    };
    switch (parsed.command) {
        case 'init': {
            const ancestor = findShapeRootOrNull(dir);
            if (ancestor !== null) {
                throw new Error(`already inside the vibeshape map at ${ancestor} - run shape there, or init a directory outside it`);
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
            const title = cleanText(requireFlag(parsed, 'title'), 'title');
            const addIntent = strFlag(parsed, 'intent');
            let createdId = '';
            updateShape(writableRoot(), (shape) => {
                createdId = addNode(shape, parent, {
                    title,
                    slug: strFlag(parsed, 'id'),
                    intent: addIntent === undefined ? undefined : cleanText(addIntent, 'intent'),
                    importance: enumFlag(parsed, 'importance', IMPORTANCE_LEVELS),
                }).id;
            });
            console.log(`added ${createdId}`);
            return;
        }
        case 'set': {
            const [id] = requirePositionals(parsed, ['id']);
            const root = writableRoot();
            const coverage = enumFlag(parsed, 'coverage', COVERAGE_LEVELS);
            const importance = enumFlag(parsed, 'importance', IMPORTANCE_LEVELS);
            const rawIntent = strFlag(parsed, 'intent');
            const intent = rawIntent === undefined ? undefined : cleanText(rawIntent, 'intent');
            const evidence = listFlag(parsed, 'evidence');
            // Verified means the cited tests pass NOW. Run them before taking
            // the write lock: test runs can be slow and must not hold it.
            if (coverage === 'verified') {
                const pre = loadShape(root);
                const preNode = findNode(pre, id);
                if (!preNode) throw new Error(`node "${id}" not found`);
                const finalEvidence = evidence.length > 0 ? evidence.map(parseEvidenceSpec) : preNode.evidence ?? [];
                const template = pre.manifest.verifyCommand;
                // Without a runner nothing can execute, so verified would be a
                // word with no fact behind it. Refuse rather than warn.
                if (!template) {
                    throw new Error('verified refused - no verify command configured, so nothing can be executed; use --coverage linked for a named test, or set one with: shape config --verify-command "<cmd with {path} and {name}>"');
                }
                // Checked here as well as in the write below, so the caller
                // sees the specific gate rather than the runner's "nothing to
                // execute" symptom of it.
                requireNamedTest('verified', finalEvidence);
                const run = runTestEvidence(root, template, finalEvidence);
                if (!run.ok) throw new Error(`verified refused - ${run.detail}`);
            }
            let becameSuspect = false;
            updateShape(root, (shape) => {
                const node = findNode(shape, id);
                if (!node)
                    throw new Error(`node "${id}" not found`);
                if ((node.children?.length ?? 0) > 0 && coverage) {
                    throw new Error(`"${id}" has children - coverage is derived; set it on leaves`);
                }
                // Restating the intent and the verdict in one call, while
                // silently reusing evidence gathered against the OLD intent,
                // launders a stale assessment into a fresh-looking one.
                if (intent && coverage && node.coverage && node.coverage !== 'missing' && evidence.length === 0) {
                    throw new Error(`changing --intent and --coverage together requires fresh --evidence: the stored evidence was assessed against the previous intent of "${id}"`);
                }
                const title = strFlag(parsed, 'title');
                if (title)
                    node.title = cleanText(title, 'title');
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
                    node.gap = cleanText(gap, 'gap');
                if (boolFlag(parsed, 'clear-gap'))
                    delete node.gap;
                if (boolFlag(parsed, 'clear-evidence'))
                    delete node.evidence;
                if (evidence.length > 0) {
                    node.evidence = fingerprintEvidence(root, evidence.map(parseEvidenceSpec));
                }
                if (coverage) {
                    const finalEvidence = evidence.length > 0 ? node.evidence : boolFlag(parsed, 'clear-evidence') ? [] : node.evidence ?? [];
                    if (CLAIM_LEVELS.has(coverage) && (finalEvidence?.length ?? 0) === 0) {
                        throw new Error(`"${coverage}" requires --evidence linking the code that realizes the intent; without evidence use partial`);
                    }
                    if (coverage === 'linked' || coverage === 'verified')
                        requireNamedTest(coverage, finalEvidence);
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
            updateShape(writableRoot(), (shape) => {
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
            updateShape(writableRoot(), (shape) => {
                movedId = moveNode(shape, id, newParent).id;
            });
            console.log(`moved to ${movedId}`);
            return;
        }
        case 'config': {
            const template = strFlag(parsed, 'verify-command');
            if (template === undefined) {
                const shape = loadShape(repoRoot());
                console.log(JSON.stringify({ name: shape.manifest.name, verifyCommand: shape.manifest.verifyCommand ?? null }, null, 2));
                return;
            }
            let demoted = 0;
            updateShape(writableRoot(), (shape) => {
                if (template !== 'none') {
                    shape.manifest.verifyCommand = template;
                    return;
                }
                // Removing the runner removes the only thing that made verified
                // mean "executed". Every such claim falls back to linked in the
                // same write, so the map is never briefly lying.
                delete shape.manifest.verifyCommand;
                for (const area of shape.areas) {
                    walk(area, (node) => {
                        if (node.coverage === 'verified') {
                            node.coverage = 'linked';
                            demoted++;
                        }
                    });
                }
            });
            console.log(template === 'none'
                ? `verify command cleared${demoted > 0 ? ` (${demoted} verified node(s) demoted to linked)` : ''}`
                : `verify command set: ${template}`);
            return;
        }
        case 'audit': {
            const root = writableRoot();
            let findings = [];
            let suspects = 0;
            updateShape(root, (shape) => {
                findings = auditShape(root, shape);
                suspects = suspectNodes(shape).length;
            });
            if (boolFlag(parsed, 'run')) {
                // Execute the cited tests behind every verified claim; a claim
                // whose test fails right now is suspect no matter how fresh
                // its hashes are.
                const shape = loadShape(root);
                const template = shape.manifest.verifyCommand;
                if (!template) {
                    console.log('WARN    --run skipped: no verify command configured (shape config --verify-command)');
                }
                else {
                    const failed = [];
                    for (const area of shape.areas) {
                        walk(area, (node) => {
                            if (node.coverage !== 'verified' || node.suspect) return;
                            const run = runTestEvidence(root, template, node.evidence ?? []);
                            if (!run.ok) failed.push({ id: node.id, detail: run.detail.split('\n')[0] });
                        });
                    }
                    if (failed.length > 0) {
                        updateShape(root, (shape2) => {
                            for (const f of failed) {
                                const node = findNode(shape2, f.id);
                                if (node) node.suspect = true;
                            }
                        });
                        for (const f of failed) {
                            findings.push({ id: f.id, detail: `test run failed: ${f.detail}` });
                        }
                        suspects += failed.length;
                    }
                }
            }
            for (const finding of findings) {
                console.log(`SUSPECT ${finding.id}: ${finding.detail}`);
            }
            if (suspects > 0) {
                console.log(`${suspects} suspect node(s) - re-assess against the code, then re-assert: shape set <id> --coverage <level> --evidence <fresh evidence>`);
                process.exitCode = 1;
            }
            else {
                console.log('audit clean');
            }
            return;
        }
        case 'review':
            // review cleared suspicion by re-stamping the same claim, which is
            // how an unexamined claim survived an audit. Clearing it now costs
            // a real re-assertion.
            throw new Error('review was removed: clearing suspect requires re-asserting the claim, so run shape set <id> --coverage <level> --evidence <fresh evidence> instead');
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
            console.log(`vibeshape viewer at ${viewer.url}  (ctrl-c to stop)`);
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
