# Test checklist: what to run before anything counts as done

> AI claiming success and code actually working are two different facts. Every command here has
> an expected output. Paste the real output lines into the HANDOFF, not a summary of them.
> Baselines are updated by the task that changes them.

## 0. Environment

| Command | Expected |
| --- | --- |
| `node --version` | `v24.22.0` (from `~/.local/bin`; see D-005) |
| `pnpm --version` | `10.34.7` |
| `pnpm install --frozen-lockfile` | ends with `Done in …`, no `ERR` lines |

## 1. Every change, every task (must all pass)

| # | Command | Expected (baseline after Task 2) |
| --- | --- | --- |
| 1 | `pnpm typecheck` | `packages/engine typecheck: Done`, `apps/server typecheck: Done`, `apps/web typecheck: Done`, then no output from root `tsc`; exit 0 |
| 2 | `pnpm lint` | `Checked N files in …ms. No fixes applied.` and no `×` or `!` diagnostics; exit 0 |
| 3 | `pnpm test` | `Test Files  13 passed (13)` and `Tests  106 passed (106)`; no failed, no skipped |
| 4 | `pnpm check:hardcode` | `check-no-hardcode: OK (32 source files, 209 terms)` (counts grow with code/data) |
| 5 | `pnpm check:data` | two `sha256 ok` lines, then `verify-data: OK (2 matches)` |
| 6 | `pnpm build` | `✓ built in …` |
| 7 | `pnpm test:e2e` (any UI-visible change) | `8 passed` (desktop + mobile) |
| 8 | `grep -rnE "\.(skip\|only)\(" --include=*.ts --include=*.tsx packages apps scripts e2e` | no output |
| 9 | `git status --short` | only files the task intended to change |
| 10 | `node scripts/engine-report.ts <raw.json> --players <players.json> --rules <rules.json> --json` | JSON scorecard, fall-of-wicket ids and fantasy report; compare with the Python oracle on both fixtures |

`pnpm verify` runs rows 1-6 in order and stops at the first failure.

## 2. Audit protocol (Claude, after every implementer task)

### A. Anti-hardcoding
1. `pnpm check:hardcode` passes.
2. `grep -rn "hardcode-ok:" apps packages` and justify every hit (expected today: none).
3. Read the diff for logic keyed to this match: comparisons with specific over numbers, labels,
   sequence numbers or ids (`over === 18`, `seq === 414`, `label === "19.4"`), lookup tables of
   outcomes, or golden numbers in source:
   `grep -rnwE "159|160|176|169|82|76|168|150" packages/*/src apps/*/src` (each hit must be explainable).
4. Prompts and fallback templates must interpolate facts; any sentence that only makes sense for
   one match is a failure.

### B. Engine vs oracle (from Task 2 on)
```
node scripts/engine-report.ts data/raw/cricsheet/<id>.json --players data/matches/<id>/players.json --rules data/rules/t20-fantasy.json --json > /tmp/engine.json
python3 -I scripts/oracle/cricsheet_oracle.py data/raw/cricsheet/<id>.json --players data/matches/<id>/players.json --rules data/rules/t20-fantasy.json --json > /tmp/oracle.json
```
Totals, extras, every batting/bowling line, fall of wickets and every player's fantasy total must
be identical. (The comparison script is the auditor's, not the implementer's.)

### C. Holdout match (from Task 2 on)
Pick a Cricsheet T20 the implementer has never seen (any other game in
`icc_mens_t20_world_cup_male_json.zip`), generate throwaway fixtures, and run B on it. From Task 4
on, also run the detectors and check that triggers land on sensible balls (cheap captain
dismissals, the biggest win-probability swings), not on the demo match's labels.

Task 2 implementation check: archive match `1273712` was run with temporary fixtures under `/tmp`;
scorecards, fielding, fall of wickets, and fantasy output matched the oracle. No holdout files were
added to the repository.

### D. Test quality
- New tests assert behaviour with hand-derived or oracle-derived literals, never values computed
  by the code under test.
- Mutation spot check: change one constant or branch in new source code; at least one test must fail.
- Both matches are covered wherever the engine is touched.

Task 2 mutation evidence: changing the free-hit carry branch to always return `false` made the
timeline test fail on the two expected free-hit deliveries. The branch was restored and the suite
passed again.

### E. Docs currency
Feature file complete (scope, what was tried, what worked, verification output), Flow.md flows
moved from PLANNED to BUILT, Architecture status updated, Decisions added for new choices,
this checklist's baselines updated, ROLLBACK row added.

### F. Security (from Task 5 on)
- `curl -sI http://127.0.0.1:8787/` shows the CSP, `x-frame-options: DENY`, `nosniff`.
- `grep -rE "sk-ant|sk-proj|sk-[A-Za-z0-9]{20}" apps/web/dist` finds nothing.
- `git ls-files .env` prints nothing and `stat -c %a .env` prints `600` (the real key lives only there
  and, after Task 7, in `/etc/sideline/sideline.env`).
- The key value never appears in logs: grep server output for the first 8 characters of the key
  (read from `.env` in a subshell, never echoed) → no matches.
- Rate limit and budget behaviour exercised by tests; oversized input rejected with 400.
- NL→SQL: write statements, `ATTACH`, `PRAGMA`, recursive CTEs and multi-statements are refused (Task 8).

### G. UI review (UI tasks)
- `pnpm test:e2e`, then look at `test-results/**/*.png` (desktop + 390 px, light + dark).
- In Chrome: no console errors; keyboard-only pass (Tab order, visible focus); emulate
  `prefers-reduced-motion: reduce` and confirm effects stop or simplify; attribution visible.

## 3. Task log (actual results at merge)

| Task | Verified on | Typecheck | Lint | Unit tests | Hardcode | Data | Build | E2E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 Foundation | 2026-10-16 | pass | pass (64 files) | 9 files / 65 tests | OK (25 files, 209 terms) | OK (2 matches) | 297 ms | 8 passed |
| T2 Cricket core | 2026-10-16 | pass | pass (77 files) | 13 files / 106 tests | OK (32 files, 209 terms) | OK (2 matches) | 317 ms | 8 passed |
