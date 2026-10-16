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
| Authored fixtures broke | `git checkout tNN-verified -- data/matches data/rules` | `pnpm check:data && pnpm test` |
| TypeScript 7 incompatibility in some tool | set `"typescript": "6.0.3"` in every package.json, `pnpm install` | `pnpm typecheck` |
| AI replay cache is wrong (Task 7+) | `git checkout tNN-verified -- data/ai-replay` or delete it and re-run `pnpm ai:record` | `pnpm test` |
| A deploy is broken (Task 7+) | `deploy/update.sh tNN-verified` (checks out the tag, installs, builds, restarts) | `curl -fsS https://<host>/api/health` |

## Per-task notes

| Task | Tag | What it adds | Risk | Rollback specifics |
| --- | --- | --- | --- | --- |
| T1 Foundation | `t01-verified` | toolchain, monorepo, contracts, data, guards, docs, shell | low (no runtime state) | to start over: delete the repo folder; Node/pnpm/ffmpeg live in `~/.local` (remove `~/.local/share/node`, `~/.local/bin/{node,npm,npx,corepack,pnpm,pnpx,ffmpeg,ffprobe}`) |
| T2 … T10 | — | filled in at each merge | — | — |
