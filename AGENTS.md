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
- Production runs on this host (Task 7, `deploy/README.md`): Caddy on 80/443, the `sideline` systemd unit
  on `127.0.0.1:8780` from `/srv/sideline`. Never edit those by hand; `pnpm dev` keeps using 8787.
- The AI proxy behind the `.env` key is never named in a tracked file or a commit message (Constraint
  27): call it "the proxy". `pnpm check:hardcode` fails on its name, and on anything shaped like an AI
  key (Groq, Google, OpenAI, Anthropic) or holding the start of one of this project's keys in a tracked file
  (Constraint 13, D-079, D-081): keys live in `.env` only.
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
| `pnpm ai:smoke` | one real teaser call through the gateway with the `.env` provider, never answered from the recorded replay rows (D-081); `--each-link` then asks every link of the AI chain once (spends tokens or a free tier's quota: ask Nabhanyu first; `SIDELINE_AI_PROVIDER=none` skips) |
| `pnpm ai:record` | the replay recorder's plan (sends nothing); `--yes` records with the `.env` provider (spends money: ask Nabhanyu first) |
| `deploy/update.sh [ref]` | redeploy production on this host (`/srv/sideline`, no password); audited refs only (Constraints §F) |
| `PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e` | the browser tests against the live site |

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
`docs/Bug_Feature.md` (your feature's row; a row per bug you file in `docs/bugs/`), the README
status line, and tick your task's checkboxes in `docs/PLAN.md` (tick them; don't reword them). The
TEST_CHECKLIST task-log row and your feature file's "Audit notes" belong to the auditor.

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
