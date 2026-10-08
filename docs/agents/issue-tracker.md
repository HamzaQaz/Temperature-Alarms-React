# Issue tracker: Local Markdown

Issues and specs (you may know a spec as a PRD) for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## This repo

- The current feature is `.scratch/rebuild/` — its spec is `spec.md` and its implementation tickets are under `issues/` (01 to 14 from the spec, later numbers for work found afterwards).
- Each ticket carries a `Blocked by:` line near the top listing the gating tickets by number. The frontier is every ticket whose blockers all have `Status: done`.

## GitHub issues

The `.scratch/` file stays the source of truth; GitHub issues mirror the tickets the owner still has to decide or that are open, so they show on GitHub and PRs can reference them.

- A ticket with an issue carries a `**GitHub:** #N` line under its `Status:` line.
- The issue carries the triage label (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) and an `area:` label (`area:notifications`, `area:reporting`, `area:firmware`, `area:operations`).
- A PR that builds the ticket says `Closes #N` in its body; close the issue by hand if the PR does not target `master`.
