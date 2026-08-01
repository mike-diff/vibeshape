---
name: shape
description: Maintain the app's living coverage map in .shape/. Use when building, changing, or removing features, when planning what to work on next, or when asked about app completeness, gaps, or coverage. Also use when the user mentions the app shape, shape tree, or steering.
---

# The app shape

`.shape/` holds a living coverage map: a tree of the app's intended surface
(features, use cases, user stories) where each leaf is scored for how well the
code actually covers that intent. It is not a task list (nodes persist forever)
and not a spec (assessments are continuously re-checked against the repo). You
are the cartographer: the map must reflect the territory after every change.

## The loop

1. **Consult** - before choosing or starting feature work:
   `shape tree --compact` (or `shape tree --gaps` for open work). Steer toward
   gaps on `core`/`high` importance nodes unless the user directs otherwise.
2. **Update** - in the same session as any feature change:
   - Implemented or improved something: `shape set <id> --coverage <level> --evidence file:<path> --evidence test:<path>#<name>`
   - Found something specifically missing: `shape set <id> --coverage gap --gap "<what exactly is missing>"`
   - Built something with no node: `shape add <parent> --title "..." --intent "..."` then set its coverage.
   - Removed a feature: `shape rm <id>`.
3. **Audit** - when asked, or when the map looks stale: `shape audit` flags
   nodes whose evidence drifted; re-assess each flagged node against the code,
   then `shape review <id>` once its status is honest again.

## Coverage levels (leaves assert, parents derive)

- `missing` - nothing in the repo addresses the intent.
- `gap` - something specific is known absent; the gap note names it.
- `partial` - some evidence, incomplete against the intent.
- `covered` - the code embodies the intent; evidence links required.
- `verified` - covered AND linked tests exist and pass.

Never set coverage on a node with children; parents roll up automatically
(a parent is covered only when every child is).

## Teammates and subagents

Context injection reaches only the main session loop; spawned teammates never
see the map. When you delegate feature work to a teammate:

- include the relevant node ids and their intents in the brief
- require the teammate to report what it built and against which nodes
- apply the shape updates yourself via the CLI (or have the teammate run
  `shape set` directly; the CLI is on PATH for the whole session)

## When the human challenges a claim

If the user questions a node ("is X really covered?") or changes what a node
should mean, re-read the evidence against the current intent and answer
honestly: confirm with evidence, or demote the coverage and write a specific
gap note. Changing a node's intent automatically marks it suspect until
coverage is re-asserted; that flag is the map telling you to re-judge.

Humans may also edit the map directly with the same CLI from a terminal; the
map's history does not distinguish authors. Never assume a node you did not
write is wrong; challenge it with evidence like any other claim.

## Rules

- Never edit `.shape/*.json` directly. The CLI owns validation, locking, and
  atomic writes. A hook will deny direct edits.
- A `covered`/`verified` claim without `--evidence` is a guess - always link
  the files and tests that realize the intent.
- Gap notes must be specific enough to steer by: "refresh-token rotation not
  implemented", not "needs work".
- Write intents in EARS form so coverage is judgeable:
  `WHEN <condition> THE SYSTEM SHALL <behavior>`.
- Keep nodes at the level of user-observable behavior, not code structure.
  Files and functions are evidence, never nodes.
- New user request that the shape does not represent? Add the node first,
  then build.

## Command reference

```
shape tree [--compact] [--gaps] [--area <slug>]   render the map
shape show <id>                                    full node detail + derived status
shape add <parent> --title <t> [--intent <ears>] [--importance core|high|normal|low] [--id <slug>]
shape add / --title <t>                            new top-level area
shape set <id> [--coverage <level>] [--gap <text>] [--clear-gap] [--evidence type:path[#name]]...
shape rm <id> [--force]                            remove node/subtree
shape mv <id> <new-parent>                         move subtree (ids rewritten)
shape audit                                        flag drifted assessments (nonzero exit if any)
shape review <id>                                  clear a suspect flag after re-assessment
shape prime                                        this orientation + current tree
```
