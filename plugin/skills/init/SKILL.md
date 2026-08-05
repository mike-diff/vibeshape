---
name: init
description: Set up vibeshape in a repo that has no .shape/ yet, sketching the map from conversation with the user. Use when asked to set up vibeshape, adopt vibeshape, start or create a shape map, or add a coverage map to a new or greenfield repo. For a repo that already has substantial code, use the survey skill instead (it derives the map from the code); for a repo that already has .shape/, use the shape skill.
---

# Shape init: start the map from the plan, not from the code

Here the map is the *plan*: the intended surface is sketched from conversation
with the user, before the code exists. Everything starts at `missing`, and the
map fills in as the app gets built. That honesty is the point.

## Step 0: route before you build (do this first)

Only one of these three is right for the repo you are in:

- `.shape/` already exists: do not re-init (`shape init` will refuse anyway).
  The **shape** skill owns the ongoing loop. To add newly intended surface, use
  `shape add`; to re-derive from code that moved on, use **survey**'s diff mode.
- The repo has substantial code to map: STOP and use the **survey** skill. It
  derives the tree from what is actually there, with real evidence. Never hand
  sketch what survey can read off the code.
- The repo is empty, a fresh scaffold, or the app is still mostly intent:
  continue here.

## Step 1: scaffold

```sh
shape init                 # or: shape init --name <app-name>
```

This creates `.shape/` and upserts the guidance block into `CLAUDE.md` (and
`AGENTS.md` when one already exists). From then on the compact tree is injected
into every session.

## Step 2: interview the user

Ask, do not infer. An empty repo tells you nothing, and a directory name is not
a product. Cover:

- what the app is for, and who uses it
- its major areas (these become top-level nodes; aim for 3 to 8)
- what each area must actually do, in observable behavior
- which areas are make-or-break versus nice-to-have (this becomes `importance`)

Keep leaves at the level of user-observable behavior. Files, functions, and
"build the database layer" are not nodes.

## Step 3: propose the tree, then STOP

Present the whole tree as an indented markdown outline **before writing any
node**. For each: title, `importance` (`core` for make-or-break flows, then
`high`, `normal`, `low`), and for leaves an EARS intent:
`WHEN <condition> THE SYSTEM SHALL <behavior>`.

Ask the user to approve, trim, or reshape it. Do not write until they answer.
Honest `importance` matters more than a big tree: if everything is `core`, the
gaps view can no longer sort by what matters.

## Step 4: apply

After approval only, depth-first:

```sh
shape add / --title "Recipes" --importance core
shape add recipes --title "Save a recipe" --intent "WHEN a signed-in user submits a recipe form THE SYSTEM SHALL persist it to their collection"
```

Leave every node at `missing`. Nothing is covered at init time: no code has been
written, so there is nothing to cite. Do not set `--coverage` here, and never
edit `.shape/*.json` directly (a hook denies it; the CLI is the only write gate).

## Step 5: configure the verify command (do not skip this)

Detect the repo's real test runner first (look for `package.json` scripts, a
test config, or the language's convention), then set a template that would
actually run one named test:

```sh
shape config --verify-command "npx vitest run {path} -t {name}"
```

`{path}` and `{name}` are substituted per test-type evidence entry and
shell-quoted, so the template should be one that runs a single named test.
Include `{name}`: a template with only `{path}` runs the whole file and lets a
node claim `verified` on a test that never touched the intent.

Explain plainly to the user why this step exists: without a configured runner
the CLI **refuses `verified` outright** and `linked` (a named test that nobody
executed) becomes the permanent ceiling. Nothing else in vibeshape prompts for
this, which is why maps sit at zero verified.

If the app has no test runner yet, say so rather than inventing a template, and
flag it as the thing to revisit once one exists.

## Step 6: show it and hand off

Finish with `shape tree`. Report the areas created and confirm the map is
honest: 0% asserted, everything `missing`, which is correct for a plan.

Then hand off explicitly: the **shape** skill owns the loop from here (consult
before building, update nodes in the same session as the change, audit when
things drift), and the map is now injected into every session automatically.
