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
   nodes whose evidence drifted or was never sound. Re-assess each flagged node
   against the code, then clear it by re-asserting the claim:
   `shape set <id> --coverage <level> --evidence <fresh evidence>`. There is no
   command that just marks a node reviewed; clearing suspicion costs a real
   re-assertion, which re-runs every gate.

## Coverage levels (leaves assert, parents derive)

- `missing` - nothing in the repo addresses the intent.
- `gap` - something specific is known absent; the gap note names it.
- `partial` - some evidence, incomplete against the intent.
- `covered` - the code embodies the intent; the CLI refuses this without
  `--evidence`. No evidence means partial, not covered.
- `linked` - covered AND a named test is cited, but nothing executed it. The
  CLI refuses this without at least one `--evidence test:path#name` link.
- `verified` - `linked` AND the cited tests were executed and passed at the
  moment of the claim. This requires a configured verify command
  (`shape config --verify-command`); without one the CLI refuses verified
  outright and tells you to use `linked`. Prefer reaching verified over
  accumulating covered: covered is judgment, linked is a citation, verified is
  an executed fact.

Never set coverage on a node with children; parents roll up automatically. A
parent never claims more than its weakest child, so one `linked` sibling pulls
a `verified` parent down to `linked`.

Changing a node's `--intent` and its `--coverage` in the same call requires
fresh `--evidence`: evidence gathered against the old intent may not silently
vouch for a new one.

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

## Unmapped-edit nudges

Injected context may list files you edited that no shape node references.
Treat each one deliberately: if user-facing behavior changed, add or update
the covering node with that file as evidence; if the edit was internal
(refactor, config, tests for an existing node), you may ignore the nudge.
Never leave a nudge unconsidered - silent omissions are how the map lies.

## What the map is not

The map tracks the product surface, not code health. Performance, security,
refactoring debt, and developer experience have no nodes unless someone adds
them. Map-green is not done: do not decline necessary engineering work just
because no node names it, and do not chase easy leaves to raise the coverage
number - the gaps view sorts by importance for a reason.

## Rules

- Never edit `.shape/*.json` directly. The CLI owns validation, locking, and
  atomic writes. A hook will deny direct edits.
- A `covered`/`linked`/`verified` claim without `--evidence` is a guess - always
  link the files and tests that realize the intent.
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
shape audit [--run]                                flag drifted and unfounded claims; --run also executes verified tests (nonzero exit if any)
shape config [--verify-command <tpl>]              show or set the test-run template ({path}, {name}); "none" clears it and demotes verified to linked
shape prime                                        this orientation + current tree
```

## What the tool does not check

Say so plainly rather than implying a guarantee the map cannot make:

- **Evidence relevance.** The CLI checks that cited evidence exists, is named,
  is fingerprinted, and (for verified) passes. Whether the test actually
  exercises the stated intent is your judgment, and the human's.
- **Files written by shell commands.** Unmapped-edit nudges only see files
  touched through edit tools; a file created with `bash` is not tracked.
- **Symlinks out of the repo.** Evidence paths are contained textually, not by
  resolving the filesystem.
- **Anything not authored.** Nothing infers nodes or verdicts from the code.
