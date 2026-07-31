# appshape

A living coverage map for agent-built apps.

When you build software with AI agents, the app's intended shape lives nowhere:
tasks get consumed, specs go stale, and neither you nor the agent can see what
the app is supposed to do versus what the code actually covers. appshape gives
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
  "coverage": "partial",            // missing | gap | partial | covered | verified
  "gap": "refresh-token rotation not implemented",
  "importance": "core",             // core | high | normal | low
  "evidence": [{ "type": "file", "path": "src/auth/oauth.ts", "hash": "..." }],
  "assessed": { "at": "2026-07-31", "gitRef": "abc123" }
}
```

- **Leaves assert, parents derive.** A parent is covered only when every child
  is (deep coverage), so roll-up percentages are honest.
- **Claims carry evidence.** `covered` links to the files and tests that
  realize the intent, fingerprinted at assessment time.
- **Drift is caught, not remembered.** `shape audit` re-hashes evidence; if the
  code moved since assessment, the claim turns *suspect* instead of silently
  lying. `shape review` re-blesses it after re-assessment.

## Quick start

```sh
pnpm add -g appshape

cd your-app
shape init
shape add / --title "Auth" --importance core
shape add auth --title "OAuth login" --intent "WHEN a user picks a social provider THE SYSTEM SHALL create a session"
shape set auth/oauth-login --coverage partial --gap "refresh rotation missing" --evidence file:src/auth/oauth.ts
shape tree
```

```
your-app - 50% covered
  ◐ auth Auth 50% [core]
    ◐ auth/oauth-login OAuth login  gap: refresh rotation missing
```

`shape view` opens the live visual map in your browser: color-coded coverage,
importance weighting, a gaps-only filter, and live updates as the shape file
changes. Click any node to copy a ready-made steering prompt for your agent.

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
shape audit                flag drifted claims as suspect (nonzero exit for CI)
shape review <id>          clear a suspect flag after re-assessment
shape view                 live visual map in the browser
shape prime                orientation block for agent context
```

## Repository layout

- `packages/core`: schema, tree model, coverage roll-up, atomic `.shape/` store
- `packages/cli`: the `shape` command
- `packages/viewer`: the local web viewer
- `plugin/`: the Claude Code plugin (hooks, skills, bin shim)
