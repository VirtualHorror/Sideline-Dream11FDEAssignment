# Handoff: Task 2, cricket core (timeline, reducer, fantasy scoring)

**Generated**: 2026-10-16 13:44 IST (by Claude Code, architect/auditor)
**Branch**: `main`, clean (this file is committed on top of `f008b53`). Task 1 is tagged `t01-verified` (`bf56822`). Create `task/02-cricket-core` from `main`.
**Status**: Ready for implementation (Task 1 done and verified; Task 2 not started)

## Goal

Sideline is an AI second-screen companion for live cricket (Dream11 FDE intern assignment by
Nabhanyu). Implement **Task 2 only** from `docs/PLAN.md`: raw Cricsheet file → canonical
`MatchEvent[]` timeline → `MatchState` reducer → Dream11-style fantasy points that match the
independent oracle exactly, for both matches, plus the `scripts/engine-report.ts` CLI. Claude
audits afterwards; you do not merge.

## Completed

- [x] Task 1 foundation (see `docs/features/F01-foundation.md`): user-space Node 24.22 + pnpm 10.34,
  monorepo (`packages/engine`, `apps/server`, `apps/web`), TS 7 checks, Biome, Vitest projects,
  Playwright on system Chrome
- [x] Engine contracts with invariant tests (`packages/engine/src/contracts/*`) and `validateSquad`
- [x] Real data: Cricsheet `1298150` (PAK v IND, 2022) and `1415755` (IND v SA, 2024 final) with sha256
  manifest; authored squads, credits, notes, personas; rules file
- [x] Guards: `scripts/check-no-hardcode.ts`, `scripts/verify-data.ts` (both tested)
- [x] Audit oracle `scripts/oracle/cricsheet_oracle.py` + golden fixtures `packages/engine/test/golden/*.oracle.json`
  (scorecards match the public records of both matches)
- [x] Full docs suite; `AGENTS.md` (your standing instructions)
- [x] After Task 1: Nabhanyu approved D-002/D-011/D-012/D-015 (D-032); AI layer will support Anthropic
  and an OpenAI-compatible endpoint via `.env` (D-033, Task 5); shareable `/architecture` page (D-034, Tasks 6 and 9)

## Not Yet Done (Task 2; exact tests and literals in `docs/PLAN.md` → "Task 2")

- [ ] 2.1 `packages/engine/test/helpers/data.ts`: `loadMatch(id)` → `{ raw, players, context, personas, rules, golden }`
- [ ] 2.2-2.3 failing `timeline.test.ts` → implement `util/hash.ts`, `cricket/{cricsheet,timing,timeline}.ts`
- [ ] 2.4-2.5 failing `reducer.test.ts` (golden scorecards, situations, strike rotation, partnership, maidens) → `cricket/{format,reducer}.ts`
- [ ] 2.6 fast-check property `fold.test.ts`: `foldEvents(id, events, k)` equals step-by-step `applyEvent`
- [ ] 2.7-2.8 failing `scoring.test.ts` (all 22 players vs golden, spot checks, live points, squad totals) → `fantasy/scoring.ts`
- [ ] 2.9 `scripts/engine-report.ts` (same numeric fields as the oracle's `--json`)
- [ ] 2.10 `pnpm verify` green; docs (F02 feature file, Flow §6 → BUILT, Architecture status, Decisions entry for the timing model, TEST_CHECKLIST baseline, ROLLBACK row, tick PLAN checkboxes)
- [ ] Write `HANDOFF3.md` per `AGENTS.md` → "Finishing", then stop

## Failed Approaches (Don't Repeat These)

- **Resizing Chrome for mobile checks** (browser extension): the RDP window stays maximised
  (`outerWidth` = screen width). Use the Playwright `mobile` project (390 px) instead.
- **Faking a phone viewport with an iframe**: blocked by our own CSP `frame-ancestors 'none'`
  (`contentDocument` is null). Intended; don't relax the header.
- **`pkill -f "node apps/server/src/index.ts"`** killed its own shell (the pattern was in its own
  command line → exit 144). Start servers with `cmd & echo $! > pidfile` and `kill $(cat pidfile)`.
- **Biome config**: `"recommended": true` is deprecated in 2.5 (use `"preset": "recommended"`, already
  done); Tailwind 4 CSS needs `css.parser.tailwindDirectives: true` (done).
- **Plan self-review corrections already applied** (don't revert them): "exactly one bailout" was wrong
  because the persona's vice-captain also falls cheaply at 3.6, so Task 4 uses `quest_active`
  suppression; catch-up z-scores use the *population* standard deviation (3.04, not sample 2.92).
- **Naive spoiler lint** on the word "six" rejects a real spoiler-free model output ("Six balls, 16
  to find…"); Task 5 lints outcome statements, not words.
- **proxy model tiers**: `gpt-6.1-sol` and `gpt-6-luna` returned identical answers; don't rely on
  fast/smart tiers on that endpoint (Task 5, not relevant to Task 2).

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Engine is pure and isomorphic (`types: []` in `packages/engine/tsconfig.json`) | Same reducer runs on server and in the browser at the fan's TV time; impurity is a compile error (D-004) |
| Server/scripts run `.ts` directly on Node 24 | No build step; erasable syntax only, `.ts` extensions, `import type` (D-006) |
| Every cricket definition comes from `docs/DOMAIN.md` §1-2 | The engine and the oracle implement the same definitions; disagreement is a bug in one of them |
| Event ids are `${matchId}:${seq padded to 4}` | AI cache keys and catch-up citations depend on stable ids (contracts/events.ts) |
| Timing model = `DEFAULT_TIMING` in PLAN Task 2 | Deterministic, realistic gaps; jitter from `fnv1a32(id)`, never `Math.random` |
| `applyEvent` mutates; `foldEvents` returns a fresh state | Cheap incremental updates for live play, cheap refold for seek |
| Golden files and the oracle are read-only | They are the auditor's independent truth (Constraints 4-5) |
| Git: work on `task/02-cricket-core`, never merge/tag/push | Claude audits, merges `--no-ff`, tags `t02-verified` (D-023) |

## Current State

**Working**: `pnpm verify` green on `main`: 3× `typecheck: Done`, `Checked 64 files … No fixes applied.`,
`Test Files 9 passed (9)`, `Tests 65 passed (65)`, `check-no-hardcode: OK (25 source files, 209 terms)`,
`verify-data: OK (2 matches)`, `✓ built in ~290ms`. `pnpm test:e2e`: 8 passed.

**Broken**: nothing known.

**Uncommitted Changes**: none. A local **`.env` exists (git-ignored, mode 600) holding a real API key**
for Task 5. Task 2 does not need it: do not open, print, copy or commit it.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/PLAN.md` (Task 2) | Authoritative spec: files, signatures, timeline rules, test names and literal expectations |
| `docs/DOMAIN.md` | Legal ball, ball faced, dots, runs conceded, maidens, wickets, strike rotation, fantasy table, match story beats |
| `docs/Constraints.md` / `AGENTS.md` | Hard rules and your workflow |
| `packages/engine/src/contracts/events.ts` | `MatchEventSchema` + `DeliveryEventSchema` invariants every emitted event must pass |
| `packages/engine/src/contracts/state.ts` | `MatchState` and friends: the reducer's output contract (field meanings documented inline) |
| `packages/engine/src/contracts/{match,persona,rules}.ts` | Fixture schemas (`PlayersFile`, `MatchContextFile`, `FantasySquad`, `FantasyRules`) |
| `packages/engine/src/fantasy/squad.ts` | Existing `validateSquad` (style reference; reuse, don't duplicate) |
| `packages/engine/test/golden/README.md` + `*.oracle.json` | Expected scorecards and fantasy points; shape and name→id mapping explained |
| `packages/engine/test/fixtures.test.ts` | How tests read `data/` (path via `import.meta.dirname`) |
| `scripts/oracle/cricsheet_oracle.py` | Reference implementation (read, run, never edit) |
| `scripts/verify-data.ts` | How a root script imports the engine relatively (`../packages/engine/src/index.ts`) |
| `data/raw/cricsheet/*.json`, `data/matches/*/`, `data/rules/t20-fantasy.json` | Inputs |

## Code Context

**Existing exports you build on** (`packages/engine/src/index.ts` re-exports these):
```typescript
MatchEventSchema, DeliveryEventSchema /* + other event schemas */, type MatchEvent, type DeliveryEvent
type MatchState, type InningsState, type BatterLine, type BowlerLine, type LiveSituation, type BallMark
PlayersFileSchema, MatchContextFileSchema, PersonasFileSchema, FantasyRulesSchema, MatchSummarySchema
validateSquad(squad: { playerIds: readonly string[]; captainId: string; viceCaptainId: string },
              pool: readonly Player[], team: FantasyRules["team"]): SquadValidation
```

**Signatures Task 2 must produce** (PLAN.md wins if anything here differs):
```typescript
fnv1a32(input: string): number
CricsheetMatchSchema; type CricsheetMatch                // permissive zod; unknown keys allowed
interface TimingModel { noteSpacingMs; tossAtMs; xiAfterTossMs; firstBallAtMs; deliveryGapMs; extraGapMs;
  boundaryExtraMs; wicketExtraMs; overEndExtraMs; inningsEndAfterMs; inningsBreakMs;
  firstBallAfterInningsStartMs; matchEndAfterMs; jitterMs }   // all numbers (ms)
DEFAULT_TIMING: TimingModel                               // values in PLAN Task 2
buildTimeline(input: { raw: unknown; players: PlayersFile; context: MatchContextFile; timing?: TimingModel }): MatchEvent[]
buildMatchSummary(raw: unknown, context: MatchContextFile): MatchSummary
oversText(legalBalls: number): string; round2(x: number): number
runRate(runs: number, legalBalls: number): number; requiredRate(runsNeeded: number, ballsLeft: number): number | null
createMatchState(matchId: string): MatchState
applyEvent(state: MatchState, event: MatchEvent): void    // throws if event.seq !== state.lastSeq + 1
foldEvents(matchId: string, events: readonly MatchEvent[], uptoSeq?: number): MatchState
interface PlayerPoints { playerId: string; total: number; breakdown: Record<string, number> }
fantasyPoints(state: MatchState, players: readonly Player[], rules: FantasyRules): Map<string, PlayerPoints>
interface SquadPoints { total: number; perPlayer: { playerId: string; base: number; multiplier: number; points: number }[] }
squadPoints(points: Map<string, PlayerPoints>, squad: FantasySquad, rules: FantasyRules): SquadPoints
```

**Raw Cricsheet shapes** (real examples from `1298150.json`):
```json
{"batter":"V Kohli","bowler":"Mohammad Nawaz","non_striker":"KD Karthik","runs":{"batter":6,"extras":1,"total":7},"extras":{"noballs":1}}
{"batter":"HH Pandya","bowler":"Mohammad Nawaz","non_striker":"V Kohli","runs":{"batter":0,"extras":0,"total":0},
 "wickets":[{"player_out":"HH Pandya","kind":"caught","fielders":[{"name":"Babar Azam"}]}]}
{"batter":"AR Patel", "...": "...", "wickets":[{"player_out":"AR Patel","kind":"run out","fielders":[{"name":"Mohammad Rizwan"},{"name":"Babar Azam"}]}]}
```
`extras` and `wickets` are absent when empty; `runs.non_boundary` is optional; `actual_delivery` may
appear (ignore). `raw.innings[i] = { team, overs: [{ over, deliveries }], target?: { runs, overs } }`.
`raw.info`: `teams`, `players[teamName]` (XI, in order), `registry.people[name] → id`,
`toss {winner, decision}`, `outcome {winner, by: {runs|wickets}}`, `dates[0]`, `venue`, `city`, `player_of_match`.

**Non-obvious logic** (all defined in DOMAIN.md / PLAN; summarised):
- Label = `${over}.${ballInOver}`; a wide/no-ball carries the number of the legal ball still to come.
  1298150 innings 2, over 19 labels: `19.1 19.2 19.3 19.4 19.4 19.4 19.5 19.6 19.6`.
- Free hit: previous delivery had a no-ball, OR previous was a free hit and was a wide/no-ball.
  Same nine deliveries: `F F F F T T F F F`.
- Strike rotation: swap if `runs.batter + byes + legbyes + max(wides − 1, 0)` is odd, swap again at
  over end; `strikerId = null` after a wicket. Verified 470/470 against the data.
- Bowler conceded = `total − byes − legbyes − penalty`; bowler dot = legal ball with `runs.batter == 0`.
- Team wickets exclude retired hurt; bowler wickets exclude run outs and other non-bowler dismissals.
- Fantasy: highest milestone only, highest haul only, rates rounded to 2 dp before slab lookup,
  3-catch bonus once per match, `caught and bowled` gives the bowler the catch, run-out with two or
  more fielders credits the last two (+6 each). Zero components are omitted from `breakdown`.

## Resume Instructions

1. `cd ~/Downloads/Dream11FDEAssignment && export PATH="$HOME/.local/bin:$PATH" && node --version`
   - Expected: `v24.22.0` (and `pnpm --version` → `10.34.7`)
2. `pnpm install --frozen-lockfile && pnpm verify`
   - Expected: the baseline in "Current State" (65 tests). If anything is red, stop and report; don't fix Task 1 silently.
3. `git checkout -b task/02-cricket-core` and create `docs/features/F02-cricket-core.md` from `docs/features/_TEMPLATE.md`.
4. Work PLAN Task 2 steps 2.1 → 2.10 test-first. Single test file: `pnpm vitest run --project engine timeline`
   - Expected: red first (missing exports), then green.
5. Cross-check against the oracle for both matches:
   `python3 -I scripts/oracle/cricsheet_oracle.py data/raw/cricsheet/1298150.json --players data/matches/1298150/players.json --rules data/rules/t20-fantasy.json`
   vs `node scripts/engine-report.ts data/raw/cricsheet/1298150.json --players data/matches/1298150/players.json --rules data/rules/t20-fantasy.json`
   - Expected: identical totals, cards, fall of wickets and fantasy totals (e.g. Hardik 168, Kohli 150, Arshdeep 116).
6. Finish: `pnpm verify` green (more than 65 tests, none skipped), `git diff --stat main -- packages/engine/test/golden scripts/oracle` empty,
   docs updated, everything committed on the branch, then write `HANDOFF3.md` (structure in `AGENTS.md` → "Finishing") and stop.

## Setup Required

- `~/.local/bin` on `PATH` (Node, pnpm). No sudo exists; no C compiler (no native addons).
- Task 2 adds **no dependencies** (`zod`, `fast-check`, `vitest` are installed) and needs **no network**
  and **no API key**. If the Codex sandbox blocks pnpm writes, launch Codex with
  `-s workspace-write -c sandbox_workspace_write.network_access=true --add-dir ~/.local/share/pnpm`.

## Edge Cases & Error Handling

- Extras repeat labels → "through X" in tests means the **last** delivery labelled X.
- Free hit carries over wides/no-balls; a wide itself can be a free-hit delivery.
- `non_boundary: true` four → `boundary: 0`.
- Unknown Cricsheet name (not in `registry.people`) → throw an `Error` mentioning "registry".
- A note that would land at or after `tossAtMs` → throw (data error).
- Missing `extras`/`wickets` keys → zeros / empty array.
- Results: ties → `"Match tied"`, no result → `"No result"`, `outcome.method` → append `" (DLS method)"`; singular "1 run"/"1 wicket".
- `applyEvent` with a non-consecutive `seq` → throw.

## Warnings

- **Do not edit** `packages/engine/test/golden/*`, `scripts/oracle/*`, or any existing test to get green.
  If engine and oracle disagree, `docs/DOMAIN.md` decides; write `docs/bugs/BUG-NNN-*.md` and flag it
  under "Audit Requests" in HANDOFF3.
- **No match-specific literals in `packages/engine/src`** (names, ids, teams, venues, labels):
  `pnpm check:hardcode` scans it. Tests may name players.
- **Engine `src/` cannot import `node:*`** or use `Date`, `Math.random`, `process` (typecheck enforces
  the Node part). Tests can use Node.
- Erasable TS only: no `enum`/`namespace`/parameter properties; `.ts` extensions on relative imports.
- pnpm prints "Update available 10.34.7 → 12.x": ignore (pinned via `packageManager`).
- `.env` holds a real key: never read it into output, logs or commits.
- Do not merge into `main`, tag, push, or rewrite history.
