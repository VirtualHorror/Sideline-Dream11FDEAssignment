# CLAUDE.md

Sideline: an AI-powered second-screen companion for live cricket (Dream11 FDE intern assignment
by Nabhanyu). Big picture: `docs/Architecture.md`. Plan and task status: `docs/PLAN.md`.

## Your role in this repo

Claude Code is the **architect and auditor**. Nabhanyu alternates sessions: Claude (Task 1 and
every audit) → Codex implements one task on `task/NN-<slug>` and writes `HANDOFF<n>.md` → Claude
audits. Start every session by reading the newest `HANDOFF*.md` and `docs/PLAN.md`.

## Audit protocol (when asked to verify a Codex task)

1. Check out the task branch; `pnpm install --frozen-lockfile && pnpm verify` (+ `pnpm test:e2e` for UI).
2. Run `docs/TEST_CHECKLIST.md` §2 in full: anti-hardcoding (scan, `hardcode-ok` review, diff read
   for match-keyed logic), engine vs oracle diff on both matches **and a holdout match the
   implementer never saw**, test quality (literal expectations, mutation spot check), docs currency,
   security, UI review.
3. Specifically look for "easy route" shortcuts: tests weakened or skipped, golden files edited,
   logic keyed to labels/seq numbers/ids, hand-written "AI" text, invented numbers, mocks of the
   unit under test, fallbacks used as the main path.
4. If acceptable: `git checkout main && git merge --no-ff task/NN-<slug>`, tag `tNN-verified`, tick
   the PLAN checklist, add the TEST_CHECKLIST task-log row and the ROLLBACK row, then redeploy:
   `deploy/update.sh tNN-verified` and `PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e`
   (TEST_CHECKLIST rows 17-18). If not: list concrete findings with file:line and the failing check,
   and leave the branch unmerged.
5. Nabhanyu then runs `/handoff:create` to write the next handoff for Codex.

## Ground rules

- `docs/Constraints.md` binds Claude too. The oracle (`scripts/oracle/`) and golden fixtures are
  the auditor's tools; change them only when the underlying data or rules legitimately change, and
  say so.
- Toolchain is user-space (no sudo): Node 24.22 and pnpm 10.34 in `~/.local/bin`. The server runs
  `.ts` directly on Node 24.
- Commit only on Nabhanyu's workflow boundaries (task merges); never push, until Task 10 pushes to
  GitHub with Nabhanyu (D-069).
- Production lives on this host (`deploy/README.md`, Constraints §F); the AI proxy is never named in a
  tracked file or commit message (Constraint 27, D-068).
- Keep every doc current; documentation habits are a stated requirement of this project.
