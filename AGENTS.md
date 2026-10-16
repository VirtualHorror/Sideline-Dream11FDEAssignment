# AGENTS.md: instructions for coding agents (Codex and others)

You are the **implementer** on Sideline, a Dream11 FDE intern assignment by Nabhanyu. Claude Code
is the **architect and auditor**: it wrote the plan and checks every task before it reaches `main`.
You implement **exactly one task** from `docs/PLAN.md` per session.

## Start of every session (in this order)

1. Read the newest `HANDOFF*.md` at the repo root. It names your task and anything in flight.
2. Read your task in `docs/PLAN.md`, then `docs/Constraints.md` (hard rules), `docs/DOMAIN.md`
   (cricket and fantasy truth), `docs/Architecture.md`, and the files your task touches.
3. Confirm the baseline is green before changing anything:
   `pnpm install --frozen-lockfile && pnpm verify`. If it is not green, stop and report.
4. `git checkout main && git checkout -b task/NN-<slug>` (branch name is in the plan's checklist).
5. Create `docs/features/FNN-<slug>.md` from `docs/features/_TEMPLATE.md`.

## Environment facts

- Ubuntu 24.04, **no sudo**. Node v24.22.0 and pnpm 10.34.7 live in `~/.local/bin` (make sure it
  is on `PATH`). There is no C compiler: no native addons.
- The server runs TypeScript directly: `node apps/server/src/index.ts`. Erasable syntax only
  (no `enum`, `namespace`, constructor parameter properties); `.ts` extensions on relative imports.
- Google Chrome is installed; Playwright uses it via `channel: "chrome"`.
- `python3 -I scripts/oracle/cricsheet_oracle.py` is the auditor's reference. Read it, run it,
  never edit it.

## Commands

| Command | What |
| --- | --- |
| `pnpm verify` | typecheck, lint, unit tests, hardcode scan, data gate, build (must be green) |
| `pnpm test` / `pnpm vitest run --project engine <file>` | unit tests (all / one) |
| `pnpm test:e2e` | Playwright smoke + flows (UI tasks) |
| `pnpm dev` | Vite on :5173 + server on :8787 |
| `pnpm lint:fix` | apply Biome formatting and safe fixes |
| `node scripts/verify-data.ts`, `node scripts/check-no-hardcode.ts` | data gate, anti-hardcoding scan |

## How to work

- **Test first, always.** Write the failing test from the plan's step (literal expected values are
  given; they come from the raw data and the oracle), run it, see it fail for the right reason,
  implement, see it pass, run the whole suite. Commit small and often on your branch.
- **Never** weaken, skip or delete a test, edit a golden file, or special-case the demo matches to
  get green. Every engine test runs on both matches for a reason. If something in the plan looks
  wrong, prove it against the raw data and the oracle, write it up in `docs/bugs/`, and flag it in
  the HANDOFF instead of working around it.
- **No hardcoded match facts** in application code (names, ids, teams, venues, labels, scores).
  Read them from `data/`. `pnpm check:hardcode` enforces this.
- **No fake AI and no fake numbers.** Fallback text is a labelled template built from facts.
- **Comment intent**: file headers say what the module is for and who calls it; non-obvious blocks
  say why. Do not restate code.
- **No new dependencies** without a `docs/Decisions.md` entry (version published ≥ 14 days ago).
- Stay inside your task. Note ideas under "Follow-ups" in your feature file.

## Documentation is part of done (every task)

Update in the same branch: your `docs/features/FNN-*.md` (log, what worked and what didn't, real
verification output), `docs/Flow.md` (move flows from PLANNED to BUILT, add new ones),
`docs/Architecture.md` (status column), `docs/Decisions.md` (every meaningful choice, with
rationale), `docs/TEST_CHECKLIST.md` (new commands, new baselines), `docs/ROLLBACK.md` (task row),
and tick your task's checkboxes in `docs/PLAN.md`.

## Finishing: write the next HANDOFF file

When the task is complete and `pnpm verify` (plus `pnpm test:e2e` for UI tasks) is green:

1. Commit everything on your branch; `git status` must be clean. Do not merge, tag or push.
2. Write `HANDOFF<N+1>.md` at the repo root (N = the number of the handoff you started from) with
   these sections, in this order:
   `# Handoff: Task NN <title>` · **Generated** · **Branch** · **Status** (Ready for Review / Blocked)
   · `## Goal` · `## Completed` (checklist) · `## Not Yet Done` · `## Failed Approaches (Don't Repeat These)`
   (mandatory; "None" if truly none) · `## Key Decisions` (table, link Decisions ids) ·
   `## Current State` · `## Files to Know` · `## Code Context` (new public signatures, exactly) ·
   `## Verification Output` (paste the real last lines of `pnpm verify`, `pnpm test:e2e`, and the
   oracle diff if relevant) · `## Audit Requests` (what you want the auditor to look at, anything
   you are unsure about) · `## Resume Instructions` (for the auditor: exact commands and expected
   outcomes) · `## Warnings`.
3. Stop. The auditor reviews, merges and tags.
