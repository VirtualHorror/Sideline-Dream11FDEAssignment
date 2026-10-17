# Handoff: Task 02 Cricket core

**Generated**: 2026-10-16 14:33 IST (Codex)
**Branch**: `task/02-cricket-core`
**Status**: Ready for Review

## Goal

Complete Task 2 from raw Cricsheet JSON through the deterministic event timeline, reducer state,
fantasy scoring, and oracle-compatible report CLI. No merge, tag, or push was performed.

## Completed

- [x] Added the permissive Cricsheet schema, FNV-1a hash, deterministic timing model, timeline builder, and match summary.
- [x] Added scorecard reducer, live chase state, partnership/fall-of-wicket tracking, and maiden accounting.
- [x] Formats result text with authored team display names while retaining Cricsheet winner codes.
- [x] Added fantasy scoring from `MatchState`, captain/vice-captain multipliers, and the report CLI.
- [x] Added timeline, reducer, fold-property, and scoring tests for both committed fixtures.
- [x] Matched both committed fixtures and unseen archive match `1273712` against the Python oracle.
- [x] Updated Task 2 feature, bug/feature register, flow, architecture, decisions, checklist, rollback, and plan docs.
- [x] `pnpm install --frozen-lockfile`, `pnpm verify`, and `pnpm test:e2e` pass; Task 2 changes are committed on this branch.

## Not Yet Done

- Claude audit, merge, and `t02-verified` tag.
- Task 3 has not started.

## Failed Approaches (Don't Repeat These)

- The first timeline test run stopped on malformed template literals in the fixture helper. After correcting them, the focused suite passed.
- The first live scoring assertion selected the opening recorded delivery instead of the plan's `1.1` ball; select by the specified event label.
- The initial oracle comparison included display-name fields on one side and registry ids on the other; normalize identity fields before comparing.
- Over display runs alone cannot determine maidens when extras are involved. Use the explicit `runsConceded` accumulator.
- Mapping the synthetic context teams widened the fixed two-team tuple and failed typecheck; clone the context and replace the indexed team instead.

## Key Decisions

| Decision | Reason |
| --- | --- |
| [D-035](docs/Decisions.md#d-035--deterministic-stadium-timing-by-stable-event-id-2026-10-16-t2-codex) | Event-id hashing keeps timing deterministic across replay and seek. |
| [D-036](docs/Decisions.md#d-036--retain-bowler-conceded-runs-in-over-state-2026-10-16-t2-codex) | Retain exact bowler-conceded runs for maiden classification. |
| D-032 | Existing owner approvals were retained unchanged. |

## Current State

`task/02-cricket-core` contains the complete Task 2 implementation and documentation. The final
verification run passed 13 test files / 106 tests. The implementation and its final display-name
regression test are committed on this branch and the worktree is clean.
Golden fixtures, raw match data, the oracle, and dependencies are unchanged.

## Files to Know

| File | Purpose |
| --- | --- |
| `docs/PLAN.md` | Task 2 acceptance checklist, all checked. |
| `packages/engine/src/cricket/timeline.ts` | Cricsheet normalization and deterministic event timeline. |
| `packages/engine/src/cricket/reducer.ts` | Incremental state reducer and replay fold. |
| `packages/engine/src/fantasy/scoring.ts` | Player and squad points. |
| `scripts/engine-report.ts` | Oracle-compatible JSON and human-readable report. |
| `docs/features/F02-cricket-core.md` | Feature log and verification record. |

## Code Context

```typescript
fnv1a32(input: string): number
CricsheetMatchSchema
type CricsheetMatch
interface TimingModel {
  noteSpacingMs: number; tossAtMs: number; xiAfterTossMs: number; firstBallAtMs: number;
  deliveryGapMs: number; extraGapMs: number; boundaryExtraMs: number; wicketExtraMs: number;
  overEndExtraMs: number; inningsEndAfterMs: number; inningsBreakMs: number;
  firstBallAfterInningsStartMs: number; matchEndAfterMs: number; jitterMs: number;
}
DEFAULT_TIMING: TimingModel
buildTimeline(input: { raw: unknown; players: PlayersFile; context: MatchContextFile; timing?: TimingModel }): MatchEvent[]
buildMatchSummary(raw: unknown, context: MatchContextFile): MatchSummary
oversText(legalBalls: number): string
round2(x: number): number
runRate(runs: number, legalBalls: number): number
requiredRate(runsNeeded: number, ballsLeft: number): number | null
createMatchState(matchId: string): MatchState
applyEvent(state: MatchState, event: MatchEvent): void
foldEvents(matchId: string, events: readonly MatchEvent[], uptoSeq?: number): MatchState
interface PlayerPoints { playerId: string; total: number; breakdown: Record<string, number> }
fantasyPoints(state: MatchState, players: readonly Player[], rules: FantasyRules): Map<string, PlayerPoints>
interface SquadPoints { total: number; perPlayer: { playerId: string; base: number; multiplier: number; points: number }[] }
squadPoints(points: Map<string, PlayerPoints>, squad: FantasySquad, rules: FantasyRules): SquadPoints
```

`OverSummary` now includes `runsConceded: number` alongside team `runs`.

## Verification Output

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

Oracle comparisons
1298150: normalized engine report equals oracle
1415755: normalized engine report equals oracle
1273712 holdout: scorecard, fielding, fall of wickets, and fantasy match oracle
```

## Audit Requests

- Review D-035's integer-second jitter formula and D-036's `OverSummary.runsConceded` contract addition.
- The CLI's `--json` output was compared with the oracle manually on both committed matches and the holdout; option parsing does not have a separate process-level automated test.
- Both demo reports and a holdout report matched the oracle. The temporary holdout fixture assigned a valid `BAT` role to each XI player; an auditor can rerun the archive match with richer authored roles.
- The free-hit mutation check made the literal timeline assertion fail as expected; the implementation was restored before final verification.

## Resume Instructions

```bash
cd ~/Downloads/SidelineProd-Dream11FDEAssignment
export PATH="$HOME/.local/bin:$PATH"
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
node scripts/engine-report.ts data/raw/cricsheet/1298150.json --players data/matches/1298150/players.json --rules data/rules/t20-fantasy.json --json
python3 -I scripts/oracle/cricsheet_oracle.py data/raw/cricsheet/1298150.json --players data/matches/1298150/players.json --rules data/rules/t20-fantasy.json --json
```

Expected: verify passes with 106 tests, E2E reports 8 passed, and the normalized report matches the
oracle. Repeat the final two commands for `1415755`.

## Warnings

No open Task 2 bugs are known. The archive and generated holdout fixtures remain under `/tmp`; no
temporary or secret files were added to the repository.
