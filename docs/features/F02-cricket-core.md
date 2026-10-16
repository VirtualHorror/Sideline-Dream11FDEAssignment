# F02: Cricket Core

- **Task:** 02 in `docs/PLAN.md`
- **Branch:** `task/02-cricket-core`
- **Owner / session:** Codex / 2026-10-16
- **Status:** ready for audit

## Scope

This task turns raw Cricsheet data and authored fixtures into a deterministic, schema-validated
event timeline, reduces events into scorecard and live state, scores fantasy points from state, and
adds an oracle-compatible report CLI. It does not add matches, change raw data or golden fixtures,
or add dependencies.

## Plan steps

- [x] 2.1 Add the shared `loadMatch` fixture helper.
- [x] 2.2-2.3 Add timeline tests and implement FNV-1a hashing, Cricsheet parsing, timing, timeline construction, and match summaries.
- [x] 2.4-2.5 Add reducer tests and implement formatting, reducer state, strike rotation, partnerships, fall of wickets, and maidens.
- [x] 2.6 Prove `foldEvents` equals explicit replay with fast-check on both fixtures.
- [x] 2.7-2.8 Add oracle scoring tests and implement fantasy scoring and squad multipliers.
- [x] 2.9 Add `scripts/engine-report.ts` with JSON and human-readable output.
- [x] 2.10 Pass verification and update the task documentation and handoff.

## Log (newest last)

- 2026-10-16: Confirmed clean Task 1 baseline with Node `v24.22.0`, pnpm `10.34.7`, frozen install,
  and `pnpm verify` (9 files / 65 tests).
- 2026-10-16: Implemented the timeline and added its fixture helper and literal cases. The first
  focused run stopped at a malformed template literal in the helper; corrected it and reran
  `pnpm vitest run --project engine timeline` successfully.
- 2026-10-16: Implemented the reducer, scorecard formatting, fantasy points, squad multipliers, and
  CLI. A live-points test initially selected the opening
  recorded delivery instead of the planned `1.1` ball; selected the specified label and verified the
  expected live points.
- 2026-10-16: Added `OverSummary.runsConceded` so maiden checks use the exact bowler-conceded formula
  even when a penalty and batter runs occur on the same delivery (D-036).
- 2026-10-16: Compared scorecards, fielding, fall of wickets, and fantasy breakdowns with the Python
  oracle for both committed fixtures; all matched. Repeated the comparison on unseen archive match
  `1273712` using temporary fixtures under `/tmp`; it also matched.
- 2026-10-16: Mutation check set the free-hit carry branch to `false`; the literal free-hit timeline
  test failed on the two expected free-hit deliveries. Restored the implementation and reran the suite.
- 2026-10-16: A final review found that result text used Cricsheet's source team label instead of the
  authored context display name. Updated the lookup and added an alias-name regression test.
- 2026-10-16: The first synthetic alias fixture widened the fixed two-team tuple with `.map`; cloning
  the context and replacing the indexed team preserves the contract type.

## What worked / what did not

- Both match timelines validate against `MatchEventSchema`; IDs, order, timing, boundaries, free hits,
  scorecards, strike rotation, live chase values, and fantasy breakdowns match their literals or oracle.
- The report CLI loads context beside `players.json`, keeping its required arguments aligned with the
  task interface while supporting temporary holdout fixtures.
- No engine/oracle discrepancies remain. The first test run exposed a fixture syntax error, and the
  first live scoring assertion targeted the wrong event; both were corrected before final verification.

## Decisions made

- [D-035: Deterministic stadium timing by stable event id](../Decisions.md#d-035--deterministic-stadium-timing-by-stable-event-id-2026-10-16-t2-codex)
- [D-036: Retain bowler-conceded runs in over state](../Decisions.md#d-036--retain-bowler-conceded-runs-in-over-state-2026-10-16-t2-codex)

## Verification (paste real output)

```text
pnpm verify
packages/engine typecheck: Done
apps/server typecheck: Done
apps/web typecheck: Done
Checked 77 files in 187ms. No fixes applied.
Test Files  13 passed (13)
Tests  106 passed (106)
check-no-hardcode: OK (32 source files, 209 terms)
verify-data: OK (2 matches)
✓ built in 398ms

pnpm test:e2e
8 passed (14.4s)

Oracle comparisons:
1298150: normalized engine report equals oracle
1415755: normalized engine report equals oracle
1273712 holdout: scorecard, fielding, fall of wickets, and fantasy match oracle
```

## Follow-ups (out of scope, noted for later)

- None identified during Task 2.

## Audit notes

- No files under `packages/engine/test/golden/` or `scripts/oracle/` were changed.
- Review the FNV-1a timing jitter range and the `runsConceded` over-state addition; both are covered
  by focused tests and documented in D-035/D-036.
