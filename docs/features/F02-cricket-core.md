# F02: Cricket Core

- **Task:** 02 in `docs/PLAN.md`
- **Branch:** `task/02-cricket-core`
- **Owner / session:** Codex / 2026-10-16
- **Status:** audited and merged (`t02-verified`)

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

Codex listed none; the audit added these. Items 1-7 are PLAN Task 3 step 3.0 (small, test-first);
8-9 are backlog.

1. Pin structural event times with literals on both matches (toss, both XIs, innings starts, first
   balls, innings ends, match end, one jitter value); three timing mutants survive today.
2. Assert `innings_end.reason` per innings (1298150: overs_complete, target_reached; 1415755:
   overs_complete, overs_complete); the chase-reason mutant survives today.
3. Synthetic scoring tests for the duck role exemption (a BOWL batter out for 0 loses nothing) and
   for rounding before slab lookup (rules data with a slab edge at 133.33; 40 off 30 balls).
4. Run "is deterministic" and the wicket-gap test on both matches, as the plan specifies
   (`packages/engine/test/timeline.test.ts:242`, `:277`).
5. Maiden test (`packages/engine/test/reducer.test.ts:247`, `:295`): the "penalty" case also gives the
   batter 4 runs, so it tests a boundary. Replace it with a penalty-only delivery that keeps the maiden
   (penalties are never charged to the bowler, DOMAIN §2) plus a separate batter-runs case, and assert
   `OverSummary.runsConceded` (D-036) directly.
6. Intent comments (Constraint 9): `fantasy/scoring.ts:76` (players outside both XIs score nothing,
   DOMAIN §3; the oracle differs, BUG-001), `cricket/reducer.ts:65` (one bowler per over, BUG-002),
   `cricket/reducer.ts:95-106` (strike rotation, DOMAIN §1), `cricket/timeline.ts:69-74` (jitter slots,
   D-035), and caller names in the headers of `util/hash.ts` and `fantasy/scoring.ts`.
7. `cricket/timeline.ts:315`: a winner without a margin reads "X won by the match"; make it "X won",
   with a synthetic test.
8. BUG-002 engine support: derive a missing target, convert `overs.balls` target notation, split an
   over between two bowlers.
9. `scripts/engine-report.ts:206`, `:221`: `Object.fromEntries` lists all-digit player ids first in the
   JSON; emit batters/bowlers in order of appearance (report only; the state order is correct).

## Audit notes (filled by the auditor)

Implementer's notes for the auditor: no files under `packages/engine/test/golden/` or
`scripts/oracle/` were changed; review the FNV-1a jitter range and the `runsConceded` addition.

**Audit, 2026-10-16, Claude, on `a74e16b`. Verdict: accepted; merged `--no-ff`, tagged
`t02-verified`.** The engine implements the Task 2 spec exactly and no shortcut was found. The
findings are test, comment and doc quality items, carried into PLAN Task 3 step 3.0.

- **Verification (fresh runs):** `pnpm install --frozen-lockfile`; `pnpm verify` → 3× `typecheck: Done`,
  `Checked 77 files in 132ms. No fixes applied.`, `Test Files  13 passed (13)`, `Tests  106 passed (106)`,
  `check-no-hardcode: OK (32 source files, 209 terms)`, `verify-data: OK (2 matches)`,
  `✓ built in 299ms`; `pnpm test:e2e` → `8 passed (13.1s)`.
- **Read-only files:** `git diff main...a74e16b -- packages/engine/test/golden scripts/oracle data apps package.json pnpm-lock.yaml`
  is empty, and both golden files equal a fresh oracle run. (The audit commit then added
  `scripts/oracle/audit/`; `cricsheet_oracle.py` is unchanged.)
- **Anti-hardcoding (§2A):** scan OK; no `hardcode-ok` in `apps`/`packages`; no `.skip`/`.only`; the
  golden-number grep only hits zod `max(160)` string limits from Task 1. Every literal in the new source
  is a cricket constant (6 balls, 4/6, 10 wickets, 100) or a `DEFAULT_TIMING` value; there are no label,
  seq or id comparisons; the engine source uses no Node, DOM, clock or randomness.
- **Engine vs oracle (§2B), auditor's comparator:** 1298150 and 1415755 identical (18 batter lines,
  11/12 bowler lines, 14/15 wickets, 22 fantasy players each).
- **Holdout (§2C):** the whole freshly downloaded `icc_mens_t20_world_cup_male_json.zip` (230 matches;
  Codex had tried 1273712) through `scripts/oracle/audit/run_sweep.sh`. The 199 matches the engine
  accepts are identical to the oracle in every scorecard, fall-of-wicket, fielding and XI fantasy value.
  22 of them carry oracle-only entries for substitute fielders, where the engine follows DOMAIN §3 and
  the oracle does not (BUG-001). 31 are rejected by documented limits (BUG-002).
- **Independent spec re-derivation (`check_spec.py`, no engine code):** 0 mismatches over 46,254
  deliveries in 201 matches, covering event order, ids, every timestamp including the FNV-1a jitter,
  labels, free hits, boundaries, wickets, chase numbers, run rates, the strike formula, partnerships,
  overs and maidens, batting/bowling order, results and the fold property. DOMAIN's strike rule
  predicts the next batter on 42,922 of 42,933 archive balls (470/470 on the demo matches).
- **Mutation (§2D):** 18 mutants, 12 killed, including the free-hit and maiden mutants named in the
  audit hooks. 6 survived (timing ×3, chase innings-end reason, duck role exemption, rounding before
  slab lookup). They are gaps in the plan's own test list, now follow-ups 1-3.
- **Audit requests:** D-035's jitter is exactly the PLAN formula and re-derived for every delivery;
  D-036's additive `runsConceded` is needed because a `BallMark` keeps one extras glyph and the total,
  and it is verified for every over above (direct assertion: follow-up 5). The CLI has no process-level
  test, but the sweep runs it on 230 matches. Holdout roles were mixed, so role rules ran.
- **Findings (none blocking):**
  1. The mislabelled maiden "penalty" case (follow-up 5). Codex's PLAN wording "bowler-charged penalty"
     contradicts DOMAIN §2; the audit restored the original wording.
  2. PLAN steps 2.3, 2.4, 2.5, 2.7 and 2.8 were reworded rather than ticked, dropping the "→ FAIL" red
     steps (restored). The work landed as 2 commits, not small ones.
  3. Two timeline tests ran on one match only (follow-up 4).
  4. Intent comments are sparse in places that matter (follow-up 6).
  5. The "won by the match" fallback (follow-up 7).
  6. The report's JSON key order (follow-up 9).
  7. Codex pre-filled auditor-owned rows (the TEST_CHECKLIST task log, this section) and wrote task
     notes into the TEST_CHECKLIST protocol text. The audit replaced the row and removed those notes;
     the same facts are already in this file's log.
  8. Stale docs outside Codex's list: README status and the engine module map (fixed in the audit
     commit).
- **Spec gaps found (Claude's, not Codex's):** BUG-002 (target notation and absence, mid-over bowler
  change, 12-player lists, seven-ball overs) and BUG-001 (oracle).
