---
name: survey
description: Bootstrap or refresh the app shape for an existing codebase. Use when a repo has no .shape/ yet and the user wants a coverage map, or when the user asks to survey, re-survey, or rebuild the app shape from the code.
---

# Shape survey: bootstrap the coverage map from an existing repo

Derive a proposed shape tree from the codebase, get human approval, then apply
it via the CLI. Never apply without approval — the human curates the map.

## Phase 1: explore

Understand the app's *user-facing surface*, not its file layout. Read the
README, routes/pages/commands, API surface, main flows, and the test suite
(tests reveal both intent and verification). For large repos, launch Explore
subagents per surface area. You are cataloguing behaviors a user or caller can
observe: features, flows, use cases.

## Phase 2: propose (report before write)

Present the proposed tree as an indented markdown outline before touching
`.shape/`. For every node include:

- title, and for leaves an EARS intent (`WHEN ... THE SYSTEM SHALL ...`)
- proposed importance (`core` for make-or-break flows, `high`, `normal`, `low`)
- honest initial coverage with evidence paths, based on what you actually
  found in the code — including `partial`/`gap` where you see holes, and
  `missing` nodes for surface the app clearly intends but lacks

Aim for 3 to 8 top-level areas, roughly 30 to 150 nodes total; leaves are
user-observable behaviors, not files. STOP and ask the user to approve, trim,
or reshape the proposal.

## Phase 3: apply

After approval only:

1. `shape init` (if `.shape/` does not exist)
2. `shape add / --title <area>` per area, then `shape add` per node,
   depth-first
3. `shape set` each leaf's coverage, gap notes, and `--evidence` links
4. Finish with `shape tree` and report the overall coverage number and the
   top 5 gaps by importance

## Constraints

- Do not invent aspirational features beyond what the app or user signals;
  the map's honesty is its value.
- Do not edit `.shape/*.json` directly; CLI only.
- Coverage claims need evidence you actually read, not guesses from filenames.
