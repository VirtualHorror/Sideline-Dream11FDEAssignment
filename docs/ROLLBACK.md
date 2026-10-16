# Rollback: how to undo a change safely

> Confidence to let an agent make big changes comes from knowing exactly how to reverse them.

## The model

- `main` contains only audited work. Each audited task is merged with `--no-ff` and tagged
  `tNN-verified` (e.g. `t01-verified`). Tags are never moved or deleted.
- Implementers work on `task/NN-<slug>` branches; nothing reaches `main` without an audit.
- There is no remote. Nothing is pushed unless Nabhanyu asks.

## Common rollbacks

| Situation | Commands | Then re-check |
| --- | --- | --- |
| An unaudited task branch is bad | `git checkout main && git branch -D task/NN-<slug>` | nothing to re-check; `main` was never touched |
| Keep the branch but discard uncommitted edits | `git restore --staged . && git restore .` (look at `git status` first) | `pnpm verify` |
| A merged task must be undone, keep later history | `git revert -m 1 <merge-commit-sha>` | `pnpm install --frozen-lockfile && pnpm verify && pnpm test:e2e` |
| Return the whole repo to a known good task | `git reset --hard tNN-verified` (local only; destroys later commits, so check `git log` first) | same as above |
| A dependency upgrade broke things | `git checkout tNN-verified -- package.json pnpm-lock.yaml apps/*/package.json packages/*/package.json && pnpm install --frozen-lockfile` | `pnpm verify` |
| Raw Cricsheet data drifted or got edited | `node scripts/fetch-cricsheet.ts --check` to see drift; `git checkout tNN-verified -- data/raw` to restore | `pnpm check:data` |
| Model files edited or rebuilt from a different archive (Task 3+) | `git checkout tNN-verified -- data/models`, or rebuild from the recorded zip: `node scripts/build-models.ts --zip <zip whose sha256 matches data/models/README.md>` | `git status --short data/models` empty, then `pnpm test` |
| Authored fixtures broke | `git checkout tNN-verified -- data/matches data/rules` | `pnpm check:data && pnpm test` |
| TypeScript 7 incompatibility in some tool | set `"typescript": "6.0.3"` in every package.json, `pnpm install` | `pnpm typecheck` |
| `.env` lost, or the AI key rotated | recreate from `.env.example`; the key comes from `proxy_API_KEY` in `~/.bashrc` (written without echoing, mode 600, see D-033); after Task 7 re-run `sudo deploy/install.sh` | `pnpm ai:smoke` (Task 5+) |
| AI replay cache is wrong (Task 7+) | `git checkout tNN-verified -- data/ai-replay` or delete it and re-run `pnpm ai:record` | `pnpm test` |
| A deploy is broken (Task 7+) | `deploy/update.sh tNN-verified` (checks out the tag, installs, builds, restarts) | `curl -fsS https://<host>/api/health` |

## Per-task notes

| Task | Tag | What it adds | Risk | Rollback specifics |
| --- | --- | --- | --- | --- |
| T1 Foundation | `t01-verified` | toolchain, monorepo, contracts, data, guards, docs, shell | low (no runtime state) | to start over: delete the repo folder; Node/pnpm/ffmpeg live in `~/.local` (remove `~/.local/share/node`, `~/.local/bin/{node,npm,npx,corepack,pnpm,pnpx,ffmpeg,ffprobe}`) |
| T2 Cricket core | `t02-verified` | Cricsheet timeline, match reducer, fantasy scoring, engine report CLI; auditor toolkit `scripts/oracle/audit/` | medium (the pure engine API every later task builds on) | `git revert -m 1 t02-verified` (the tag is the merge commit), then `pnpm install --frozen-lockfile && pnpm verify`. No dependencies, data or migrations to restore. Timeline, reducer, scoring and CLI go together, so revert any later task that uses them first |
| T3 Models | `t03-verified` | logistic regression, win probability, leverage, player priors (engine `models/`); archive pipeline `scripts/lib/archive.ts` and `scripts/build-models.ts`; generated `data/models/`; Biome excludes `data/models`; Task 2 audit carry-overs (tests, the "won" result text, comments) | medium (Task 4's detectors and Task 5's teasers read the model files and these functions) | `git revert -m 1 t03-verified`, then `pnpm install --frozen-lockfile && pnpm verify`. No dependencies were added and no contracts changed. The model files are generated: to restore them alone, see the row above. Revert later tasks that read `winprob-v1.json` or the priors first |
| T4 Moments engine | `t04-verified` | TV clock and delay buffer, commentary lines, join points, lineup/collapse/nudge/room detectors, catch-up facts, entropy gate, quest resolver, seeded synthetic crowd (engine); `data/crowd/` corpus; step 4.0 Task 3 carry-overs (a priors lookup fix, tests, `round2` role means, the regenerated `data/models/README.md`); Constraints 2, 6 and 11 clarified | medium (Task 5's session, gate and orchestrator are built on these functions and the trigger facts) | `git revert -m 1 t04-verified`, then `pnpm install --frozen-lockfile && pnpm verify`. No dependencies, contracts or migrations to undo (the detector types are new files). The model JSON files did not change; `data/models/README.md` returns to its Task 3 text. Revert later tasks that call the detectors, gate or crowd first |
| T5 … T10 | — | filled in at each merge | — | — |
