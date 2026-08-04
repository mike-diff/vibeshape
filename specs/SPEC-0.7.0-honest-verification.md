# SPEC 0.7.0 - honest verification and audit hardening

Status: approved (requirement contract v2, amendments 1-7 incorporated)
Target version: 0.7.0, schemaVersion 2
Dependencies: none (Node >= 20.11 only; enforced repo property)
Source findings: adversarial audits fable-audit.md, fable-audit-2.md, appshape-adversarial-audit.md (Sol)

## Requirements (contract v2, binding)

- R1 lattice: missing | gap | partial | covered | linked | verified. linked = named test evidence fingerprinted, never executed. verified = cited tests executed passing via configured verify command at assertion time, refused otherwise. Derived: all V -> V; all in {L,V} -> L; all in {C,L,V} -> C; all M -> M; all in {M,G} -> G; else P. Scores C=L=V=1.0. Compact [L].
- R2 migration: schemaVersion 2. v1 read demotes verified -> linked in memory (v1 never displays verified). First mutating command migrates on disk: legacy verified retains verified only if its cited tests execute and pass right then; otherwise linked; prints summary; idempotent (second run zero diff). `config --verify-command none` demotes all verified atomically in the same write.
- R3 same-call: set --intent on an assessed node with --coverage in the same call requires --evidence. Prevents implicit evidence reuse only; semantic relevance is a stated non-goal.
- R4 slugs: segments capped at 64 chars (live maxima 19/24; no migration risk).
- R5 hook input: stdin must be an object with correctly typed fields; null/primitives/arrays/wrong-typed fields exit 0 silently; wrong types never degrade to cwd fallback (only absent cwd may).
- R6 evidence paths: one repo-root-aware canonicalization (backslashes, normalize, strip ./); reject POSIX absolute, Windows drive/UNC, upward escape. Legacy out-of-root evidence fails audit; legacy ./x compares correctly and canonicalizes on next write. Symlinks: non-goal.
- R7 structural audit failures (suspect + exit 1): claim-tier without evidence; linked/verified without named test evidence; claim-tier evidence lacking fingerprint; verified without configured runner. Demo-store's demoted testless nodes going suspect is intended.
- R8 review removed: suspect clears only via fresh `set --coverage` under R3/R7 (verified executes).
- R9 injection: session-scoped wx lock around the whole marker/ledger transaction (steal if >5s stale); change detector hashes the full serialized map, not the rendered digest. Scenarios: concurrent first (exactly one), concurrent stale (exactly one), changed tree, unchanged <10min silence, pending omission survives resume race.
- R10 digest bound: deterministic ranking (open weight desc, id asc), top-20 areas + top-40 open items, exact hidden counts, hard BUDGET_MAX_BYTES=8192 post-render line-boundary truncation with marker. Suite enforces bytes on 5,000-area and max-length-text fixtures.
- R11 nudge marking: mapped files handled immediately/silently; displayed unmapped handled; hidden unmapped pending. Sequence test: 6 names, then 2, then silence.
- R12 presentation: header reads `<name> N% asserted (V x L y ?z)`; viewer shows the same split; [L] color/legend.
- R13 docs: README viewer wording; RELEASE stale test-execution line; client/main.js header; cli.test re-init name; plus linked/migration/review-removal/byte-budget docs.

Parked with reasons (documented in skill/README limitations): Bash-created files absent from edit ledger; semantic relevance of evidence (C1); symlink containment; Codex adapter; derived discovery; delta injection; schema/protocol publication.

## Architecture plan

Module impact (all plain ESM, no new dependencies; one new lib file, one removed command):

| File | Change |
|---|---|
| lib/types.mjs | COVERAGE_LEVELS gains 'linked' (position 5); typedef text |
| lib/rollup.mjs | score linked=1.0; derivedCoverage implements the full R1 lattice |
| lib/schema.mjs | manifestErrors accepts schemaVersion 1 or 2; slug segment length <= 64 in node/manifest/add checks |
| lib/store.mjs | loadShape: v1 in-memory demotion verified->linked, marks shape.legacyVersion=1 (not serialized); saveShape always writes schemaVersion 2 |
| lib/migrate.mjs (new) | migrateOnWrite(root): no-op on v2; on v1, pre-lock executes cited tests per legacy-verified node (verify.mjs) to build a promotion set, then one updateShape applying promotions + version bump + printed summary |
| lib/evidence.mjs | canonicalizeEvidencePath(raw) (rejects per R6) applied at parse; fingerprint comparisons canonicalize |
| lib/audit.mjs | R7 structural findings set suspect; out-of-root legacy paths fail; needs manifest (already passed via shape) |
| lib/render.mjs | header asserted + V/L/? counts; [L] code/glyph/color; digest: ranking, BUDGET_TOP_AREAS=20, BUDGET_MAX_BYTES=8192 truncation |
| lib/decorate.mjs | counts include linked; suspect count surfaced |
| lib/hook-input.mjs (new) | readHookInput(): parses stdin, returns null unless object with correctly typed known fields |
| bin/shape.mjs | linked gate (test evidence), verified gate (runner + execution, no warning path), R3 evidence requirement, review command removed, config none demotion, migrateOnWrite before mutating commands, usage text |
| scripts/inject-tree.mjs | hook-input; wx transaction lock; full-map hash; R11 marking split |
| scripts/{guard,track,remind}*.mjs | hook-input adoption |
| client/main.js, style.css | linked color/legend; asserted header with V/L/? |
| skills/shape, skills/survey | vocabulary, review removal, ritual, parked limitations |
| README.md, RELEASE.md, tests | R13 corrections; full test coverage per task list |

Key decisions:
1. Migration lives in bin-called lib (migrate.mjs), not store: execution must run pre-lock (set's proven pattern) and store must stay side-effect-free for read-only consumers (viewer/hooks read v1 safely via in-memory demotion, never write).
2. Every mutating CLI command routes through migrateOnWrite first; read-only commands and hooks never migrate on disk. This preserves "v1 never displays verified" and R2 idempotence.
3. The injection lock is tmp-scoped and separate from the .shape lock; no ordering between them (no deadlock surface).
4. Full-map hash = sha256 of serialized manifest+areas (serialize.mjs output), computed from the loaded shape; rendering stays budget-filtered.
5. review removal is a hard removal (usage, skill, tests); the error for `shape review` names the replacement.

### Architecture validation (3.5)

- No import cycles: migrate -> {store, verify, tree}; bin -> migrate; hooks -> lib only. PASS
- All writers migrate; all readers demote in memory: enumerated writers are bin mutating commands (add/set/rm/mv/config/audit); enumerated readers (tree/show/prime/snapshot/view, hooks, viewer) display-demote only. PASS
- R2 idempotence mechanism: version gate + writeIfChanged; test asserts byte equality on second run. PASS
- R7 vs migration ordering: audit after migration sees v2 truths; audit on v1 map performs in-memory demotion first (audit is a writer, so it migrates). PASS
- Lock scenarios map to R9 acceptance five cases; steal path bounded. PASS
- Zero new dependencies; two new lib files justified (4+ consumers each). PASS

## Task breakdown (Phase 4) - each self-contained

T1 lattice + presentation core. Prereq: none. types/rollup/render/decorate/client for R1+R12 (no gates yet). Tests: lattice unit tests (every rule), header format, [L] rendering. Done when: suite green with linked representable end to end.

T2 schema v2 + migration. Prereq: T1. schema/store/migrate/bin wiring, config-none demotion, summary printing. Tests: v1 read never shows verified; migration promotes only on passing execution; idempotence byte-diff; config none demotes atomically. Done when: both live-map copies (fixtures cloned from real maps) migrate coherently.

T3 CLI gates. Prereq: T1 (T2 for migration interplay tests). linked/verified/R3 gates, review removal, R4 slug cap, usage. Tests: Sol spacecraft repro refused; README-test repro refused at verified (no runner) and allowed only as linked; review exits with guidance; 65-char slug refused.

T4 evidence + audit honesty. Prereq: T1. canonicalization (R6) + structural audit failures (R7). Tests: traversal/absolute/UNC refused at parse; legacy out-of-root fixture fails audit; each R7 class sets suspect and exits 1; ./x legacy comparison.

T5 hook hardening. Prereq: none (parallel-safe). hook-input.mjs + adoption (R5), injection wx transaction + full-map hash (R9), nudge marking (R11). Tests: type matrix exits silently; five R9 scenarios (concurrent via spawned processes); 6-then-2-then-silence sequence; hidden-rename triggers reinjection.

T6 digest bounds. Prereq: T1. Ranking, area cap, byte ceiling (R10). Tests: 5,000-area fixture under 8,192 bytes with exact counts; max-length gap/title fixture; determinism (two renders byte-identical).

T7 docs + skills (R13) and parked-limitations documentation. Prereq: T1-T6 for accuracy.

T8 release: migrate both live maps for real, re-run the full Sol reproduction set, unit-test-quality + lean-build self-review, version 0.7.0, plugin updates, sync bundle refresh.

Acceptance for the release = contract v2 acceptance section, verbatim.

Errata (approved during build): R2 settle target refined - a legacy verified
node without named test evidence settles at covered, not linked, because
blanket-linked would create the structurally-suspect states R7 forbids.
QA boundary ruling: linked citing prose-as-test stays audit-clean by design
(C1 non-goal); the runner backstop applies to verified only.
