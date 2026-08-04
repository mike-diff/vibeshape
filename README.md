# vibeshape

A living coverage map for agent-built apps.

When you build software with AI agents, the app's intended shape lives nowhere:
tasks get consumed, specs go stale, and neither you nor the agent can see what
the app is supposed to do versus what the code actually covers. vibeshape gives
that picture a home: a `.shape/` folder holding a tree of the app's intended
surface (features, use cases, user stories), where every leaf is scored for how
well the code covers that intent. Humans read it visually and steer; agents
maintain it through a CLI as they build; an audit catches the map drifting from
the code.

It is not a task list (nodes persist and get re-scored forever) and not a spec
(assessments are continuously re-checked against the repo). The repo is the
territory, the shape is the map, and the agent is also the cartographer.

## How it works

Each node carries an intent, a coverage verdict, and the evidence behind it:

```jsonc
{
  "id": "auth/oauth-login",
  "title": "OAuth login",
  "intent": "WHEN a user picks a social provider THE SYSTEM SHALL create a session",
  "coverage": "partial",            // missing | gap | partial | covered | linked | verified
  "gap": "refresh-token rotation not implemented",
  "importance": "core",             // core | high | normal | low
  "evidence": [{ "type": "file", "path": "src/auth/oauth.ts", "hash": "..." }],
  "assessed": { "at": "2026-07-31", "gitRef": "abc123" }
}
```

- **Leaves assert, parents derive.** A parent never claims more than its
  weakest child (deep coverage), so roll-up percentages are honest.
- **Claims carry evidence.** `covered` links to the files and tests that
  realize the intent, fingerprinted at assessment time.
- **`linked` and `verified` are different words.** `linked` means a named test
  is cited; `verified` means that test was executed and passed at the moment
  the claim was made. Without a configured verify command nothing can execute,
  so `verified` is refused outright and `linked` is the honest ceiling.
- **Drift is caught, not remembered.** `shape audit` re-hashes evidence; if the
  code moved since assessment, the claim turns *suspect* instead of silently
  lying. Audit also fails claims that were never founded: a claim tier with no
  evidence, `linked`/`verified` with no named test, evidence with no
  fingerprint, or `verified` in a repo with no runner.
- **Suspicion costs a real re-assertion.** There is no "mark it reviewed"
  command; clearing a suspect flag means running `shape set --coverage` again
  with fresh evidence, which re-runs every gate.

## Quick start

No build, no install step, no dependencies beyond Node 20.11+: the repo is the
plugin.

```sh
claude plugin marketplace add mike-diff/vibeshape
claude plugin install vibeshape@vibeshape --scope project
```

New releases arrive on their own: Claude Code refreshes git-sourced
marketplaces in the background, so installed plugins update on the next
session start with no further commands.

Or use the CLI directly without Claude Code (clone the repo and add
`vibeshape/plugin/bin` to PATH):

```sh
cd your-app
shape init
shape add / --title "Auth" --importance core
shape add auth --title "OAuth login" --intent "WHEN a user picks a social provider THE SYSTEM SHALL create a session"
shape set auth/oauth-login --coverage partial --gap "refresh rotation missing" --evidence file:src/auth/oauth.ts
shape tree
```

```
your-app 50% asserted (V 0 L 0 ?0)
  ◐ auth Auth 50% [core]
    ◐ auth/oauth-login OAuth login  gap: refresh rotation missing
```

The header says *asserted*, not *covered*, because the percentage counts claims
made, not truths proven. `V` and `L` split those claims into executed
(`verified`) and merely cited (`linked`); `?` counts nodes currently suspect.

`shape view` serves the live visual map and prints its URL for you to open:
color-coded coverage, importance weighting, a gaps-only filter, and live
updates as the shape file changes. Click any node to copy a ready-made
steering prompt for your agent.

## Claude Code integration

The `plugin/` directory is a Claude Code plugin that makes agents first-class
citizens of the map:

- the `shape` CLI ships on the agent's PATH
- direct edits to `.shape/*.json` are denied by a PreToolUse hook (the CLI owns
  validation, locking, and atomic writes)
- the compact tree is injected into context each session and re-injected when
  it changes, so the agent always knows the current map
- a `shape` skill teaches the maintenance loop (consult, update, audit) and a
  `survey` skill bootstraps a proposed map from an existing codebase, with
  human approval before anything is written

## Commands

```
shape init                 scaffold .shape/ and CLAUDE.md guidance
shape tree                 render the map (--compact, --gaps, --area <slug>)
shape show <id>            full node detail plus derived status
shape add <parent> ...     add a node (/ as parent creates a top-level area)
shape set <id> ...         update coverage, gap, intent, importance, evidence
shape rm / shape mv        remove or move a subtree
shape audit                flag drifted and unfounded claims suspect (nonzero exit for CI)
shape config               show or set the verify command that makes verified executable
shape view                 serve the live visual map (prints a URL)
shape prime                orientation block for agent context
```

Clearing a suspect flag is deliberately not a command: re-assert the claim with
`shape set <id> --coverage <level> --evidence <fresh evidence>`.

## Schema versions

Maps written before this version are `schemaVersion 1`, where `verified` meant
only that a test was named. Reading a v1 map shows those nodes as `linked`; it
is never displayed as verified. The first command that writes to the map
migrates it to v2 on disk: each legacy `verified` node gets one chance to earn
the word back by executing its cited tests right then, and settles at `linked`
otherwise. The migration prints a one-line summary and is idempotent.

Clearing the verify command (`shape config --verify-command none`) demotes
every `verified` node to `linked` in the same write, since nothing can execute
anymore.

## Limitations

Known and deliberately unaddressed, so the map does not imply guarantees it
cannot make:

- **Bash-created files are invisible to the edit ledger.** Unmapped-edit nudges
  see files touched through the agent's edit tools; a file written by a shell
  command is not tracked.
- **Evidence relevance is not judged.** The tool checks that cited evidence
  exists, is named, is fingerprinted, and (for `verified`) executes and passes.
  Whether that test actually exercises the stated intent is a human judgment.
- **Symlink containment is textual.** Evidence paths are refused when they
  point outside the repo root by their text; a symlink inside the repo pointing
  out of it is not detected.
- **Coverage is not derived from the code.** Nodes and their verdicts are
  authored; nothing infers the map from the repository.
- **The map is not a protocol.** The on-disk schema is not published for
  external tools to write against.

## Repository layout

Everything lives in `plugin/`, as plain ESM with JSDoc types; source is the
shipped artifact.

- `plugin/bin/`: the `shape` CLI entry (on the agent's PATH while enabled)
- `plugin/lib/`: model, roll-up, store, audit, render, viewer server
- `plugin/client/`: the viewer web app (assembled in memory at serve time)
- `plugin/hooks/`, `plugin/scripts/`: enforcement hooks
- `plugin/skills/`: the shape and survey skills
- `tests/`: the test suite (repo-only; not shipped with the plugin)

Development: edit and run. Tests: `node --test tests/*.test.mjs` (built-in
runner, no packages).
