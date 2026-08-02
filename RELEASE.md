# appshape 1.0 release checklist

Target: a public GitHub repo anyone can use with two commands, and a plugin
declared complete. Items marked (impl) are code work tracked in `.shape/`;
the rest are release operations.

## Hardening (impl)

- [ ] `shape init` refuses to create a nested map when an ancestor directory
      already has `.shape/` (today it silently creates a second map)
- [ ] `shape init` writes `.shape/.gitignore` covering `snapshot.html` and
      `.lock/` so generated files never land in version control
- [ ] Edit ledger becomes append-only (JSONL) so parallel PostToolUse hooks
      cannot lose entries in the read-modify-write race
- [ ] Hook scripts get automated tests (guard deny/allow, injection gating,
      nudge once-per-file, resume dedupe, delegation reminder, ledger append);
      today they are only manually verified
- [ ] Windows pass: verify the bash shim under git-bash, path handling in the
      guard and ledger, or document macOS/Linux/WSL support explicitly

## Documentation

- [ ] README for strangers: expand the brief How it works into a full concepts section (map vs tasks vs specs, coverage
      semantics, honesty machinery), a 60-second quickstart, FAQ (why a CLI
      gate, why read-only viewer, what suspect means), limitations stated
      plainly (coverage judgments are assessments against intents; only
      verified touches tests)
- [ ] Uninstall section: plugin removal, deleting `.shape/`, stripping the
      CLAUDE.md/AGENTS.md blocks
- [ ] Agent-agnostic usage: the CLI and AGENTS.md block for non-Claude agents
- [ ] `examples/`: a small realistic demo map plus viewer screenshot for the
      README (light and dark)
- [ ] Privacy note: no network calls, no telemetry, everything stays in-repo

## Release operations

- [ ] LICENSE (MIT) and copyright line
- [ ] CI: GitHub Actions running `node --test tests/*.test.mjs` on push,
      Node 20.11+/22/24 matrix (no install step needed; import.meta.dirname sets the 20.11 floor)
- [ ] Name check: search for collisions on "appshape" and `.shape/` before
      the name is public
- [ ] Public repo `mike-diff/appshape`, topics, description, social preview
- [ ] Verify the GitHub install path end to end from a clean machine:
      `claude plugin marketplace add mike-diff/appshape` then
      `claude plugin install appshape@appshape`
- [ ] Version 1.0.0 in plugin.json, tagged release with notes
- [ ] Self-host: this repo carries its own `.shape/` map and runs the plugin
      on itself; the map is the living roadmap after 1.0

## Declared complete (deliberately not in 1.0)

These were evaluated and cut, not forgotten:

- Stop-hook auditor: the 8-block cap and runaway risk outweigh what per-turn
  injection, nudges, and `shape audit` already cover
- Background re-survey subagent: manual survey diff mode is sufficient
- Graphical editing, drag-to-reparent, three-way merge UI: removed by design;
  humans steer in prose, the CLI is the escape hatch
- VS Code custom editor, JSON Canvas export, File System Access viewer,
  npm publishing: post-1.0 candidates if demand appears
- Test execution in `shape audit` (running linked tests): verified means
  named tests existed and passed at link time; running them belongs to CI
