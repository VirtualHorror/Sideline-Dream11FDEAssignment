# Handoff: Task 4, moments engine (clock, delay buffer, detectors, gate, quests, crowd)

**Generated**: 2026-10-16 20:24 IST (by Claude Code, which implemented Task 3 in Codex's place and then audited it)
**Branch**: `main`, clean (this file is committed on top of `af1549d`). Task 3 is merged and tagged `t03-verified` (`af1549d`). Create `task/04-moments-engine` from `main`.
**Status**: Ready for implementation (Task 3 done and verified; Task 4 not started)

## Goal

Sideline is an AI second-screen companion for live cricket (Dream11 FDE intern assignment by
Nabhanyu). Implement **Task 4 only** from `docs/PLAN.md`, the pure moments engine: TV-clock maths
and the delay buffer, `describeDelivery`, the lineup, collapse, nudge and room detectors plus
catch-up facts, the entropy gate, quest resolution, and the seeded synthetic crowd with its
corpus. Everything lives in `packages/engine` (pure, isomorphic). Claude audits afterwards; you do
not merge.

## Completed

- [x] Task 1 foundation (`t01-verified`) and Task 2 cricket core (`t02-verified`).
- [x] Task 3 models (`t03-verified`; record: `docs/features/F03-models.md`):
  - `models/{logistic,winprob,leverage,priors}.ts`;
  - `scripts/lib/archive.ts` and `scripts/build-models.ts`;
  - generated `data/models/{winprob-v1.json, priors-1298150.json, priors-1415755.json, README.md}`
    from Cricsheet's men's T20I archive (2026-10-16, sha256 `95305bc2…860a`): 3,093 matches used,
    162 engine rejections (BUG-002) and 370 filter exclusions, all counted.
- [x] Model facts you will rely on: chase Brier 0.1215 (calibrated within 0.05 per bin);
  first-innings Brier 0.2099; `leverage.nudgeThreshold` 0.18437096987916934 (nearest-rank 95th
  percentile of test-split legal balls).
- [x] Big balls with the committed model: 1298150 has 22 of 251 deliveries at or above the threshold,
  1415755 has 24 of 251. Both are inside step 4.5's 5-50.
- [x] The Task 2 carry-overs (step 3.0). `python3 -I scripts/oracle/audit/mutate.py <scratch copy>`
  prints `18 killed, 0 survived`.
- [x] BUG-003 resolved by D-043 (Nabhanyu): PLAN 3.4's climax list was amended, and so were **4.5**
  ("the five labelled balls") and **5.6** (18.6 instead of 18.5). Use the amended text.

## Not Yet Done (exact tests and literals in `docs/PLAN.md` → "Task 4")

- [ ] **4.1** `clock.test.ts`, `delay.test.ts` (`stadiumAt`, `tvTimeAt`, `releaseDue`, `momentVisibility`)
- [ ] **4.2** `describe.test.ts` (`describeDelivery`: names from `players.json`, tags incl. `noball` / `freehit`)
- [ ] **4.3** lineup detector + `enumerateSwaps` (every suggestion passes `validateSquad`; ranked by projected points from the priors)
- [ ] **4.4** collapse detector (one bailout per quest window; `quest_active` suppression)
- [ ] **4.5** nudge detector (leverage ≥ `model.leverage.nudgeThreshold`; 5-50 triggers per match; the five 3.4 balls in 1298150)
- [ ] **4.6** catch-up facts (`late-from-work` after 14 overs of the chase: `90/4`, 70 off 36, RRR 11.67; population-σ z-scores; key `catchup:1298150:2:0-14:casual`)
- [ ] **4.7** gate (deterministic share ≥ 0.80 on the full `babar-believer` replay; injected `nowMicros`)
- [ ] **4.8** quests (`resolveQuestRule` cases in the PLAN)
- [ ] **4.9** crowd (`mulberry32` / `seedFrom`, `data/crowd/corpus.json` ≥ 240 lines, placeholders only, `synthetic: true`)
- [ ] **4.10** `pnpm verify` green; docs (F04, Flow §9 logic → BUILT, Architecture, Decisions, TEST_CHECKLIST, ROLLBACK, Bug_Feature, README status)
- [ ] Write `HANDOFF6.md` per `AGENTS.md` → "Finishing", then stop

## Failed Approaches (Don't Repeat These)

- **Literal inputs that make two terms equal.** Task 3's first feature test used
  `firstInningsFeatures(80, 3, 60)`, where runs/160 = balls/120 = 0.5, so a mutant swapping
  `wl·bb` for `wl·r` still passed. Only re-running the mutant table caught it. Choose literals
  where every term differs (z-scores, swing ranks, credits), and mutate each new formula once.
- **Hand-picking "dramatic" balls as nudge expectations.** PLAN 3.4 named 1298150's 18.5 six and
  winning single. The specified model scores them 0.093 and 0.019 (BUG-003): the 19.6 wide before
  the single already took P(India) to 0.99. Expectations must come from the committed model. The
  list above is that model's output.
- **Treating a narrative beat as a nudge trigger.** 18.5 does **not** trigger a nudge; Task 5.6
  now uses 18.6. If you want the match-deciding ball to always trigger (D-043 follow-up 2), that
  is a design change: write it up under Follow-ups and the HANDOFF; do not build it unasked.
- **Naming a script helper `fit`.** Biome's `lint/suspicious/noFocusedTests` flags `fit(` (Jasmine's
  focused test). Avoid `fit`, `fdescribe`, `xit`-style names.
- **`%` in `it.each` titles.** "marks between 2%% and 20%%" rendered as "2% 1298150 and 20%
  undefined". Keep `%` out of parameterised titles.
- **Holding reducer state by reference** (HANDOFF4, still true). `applyEvent` mutates.
  Detectors get `before` and `after`: take `structuredClone(state)` before `applyEvent`, or use
  `foldEvents(id, events, seq - 1)`. `leverage()` throws if the two states have different
  batting sides.
- **"Through X" with repeated labels** (HANDOFF4). "Through 13.6" means the **last** delivery
  labelled 13.6. 4.6's join point (`afterOvers: 14` → label `14.0`) is the state after the last
  legal ball of over index 13.
- **Rewording PLAN steps.** Tick only. Spec questions go in the HANDOFF. (Task 3's amendments were
  the owner's decision, recorded as D-043.)

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| The model files are data passed in `DetectorContext` (`winprob: WinProbModel; priors: PriorsFile`) | Engine purity (D-004): tests load them with `loadWinProbModel()` / `loadPriors(id)` |
| Big ball = `leverage(...).value >= model.leverage.nudgeThreshold` (D-041) | One threshold from held-out data; never tune it or the weights per ball |
| PLAN 3.4 / 4.5 / 5.6 amended (D-043) | The five 1298150 balls are 18.6, 19.1, the 19.4 no-ball, 19.5 and the 19.6 wide |
| `PriorsFile` entries carry `role` (D-042) | `projectedPoints` applies `roleMean[role]`; it throws for an id the file lacks |
| `data/models/` changes only via `scripts/build-models.ts` (Constraint 14, D-039) | Byte-reproducible; Task 4 never needs to rebuild it |
| Win probability at the innings break uses the first-innings model; chase terminal states are 1 / 0 / 0.5 (D-040) | Detectors may read WP at any event after the first `innings_start`; it is null before |
| Known model limits (D-040, D-043) | The first-innings model is overconfident at the extremes (its 0.8-1.0 bins are about 0.10 high); super-over ties are excluded from training. Detectors must not treat early-innings WP as precise |

## Current State

**Working**: `main` at `af1549d` (+ this handoff). `pnpm verify` → 3× `typecheck: Done`,
`Checked 89 files … No fixes applied.`, `Test Files  18 passed (18)`, `Tests  183 passed (183)`,
`check-no-hardcode: OK (36 source files, 209 terms)`, `verify-data: OK (2 matches)`, `✓ built in ~270ms`.
`pnpm test:e2e` → `8 passed`. `node scripts/build-models.ts --zip <that archive>` leaves `git status` clean.

**Broken**: nothing known. **Known limits**: BUG-002 (some Cricsheet files are rejected), the two
model limits above, and the deferred minors in F03's audit notes.

**Uncommitted Changes**: none. `task/03-models` still exists (merged). A local **`.env` holds a
real API key**. Task 4 does not need it: do not open, print, copy or commit it.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/PLAN.md` (Task 4) | Authoritative spec: signatures, detector rules, keys, step literals |
| `packages/engine/src/models/{winprob,leverage,priors}.ts` | What the detectors call (signatures below) |
| `data/models/README.md` | Model provenance, metrics, calibration, threshold, priors summary |
| `packages/engine/test/helpers/data.ts` | `loadMatch`, `loadWinProbModel`, `loadPriors` |
| `packages/engine/src/contracts/{moments,telemetry,chat,persona,session}.ts` | `QuestRule`, payloads, `Moment`, `GateDecision`, `ChatMessage`, `Persona`/`JoinAt`, `ClockState` (contract changes need tests, Decisions and docs, Constraint 8) |
| `packages/engine/src/fantasy/squad.ts` | `validateSquad` for lineup swaps |
| `packages/engine/src/cricket/{reducer,timeline,format}.ts` | `applyEvent`, `foldEvents`, `buildTimeline`, `requiredRate`, `runRate` |
| `data/matches/<id>/personas.json` | Squads, captains, `joinAt`: `babar-believer`/`captain-rohit` pre-match; `late-from-work` inn 2 after 14; `proteas-late` inn 2 after 15; `f1-convert` / `football-fan` no squad |
| `scripts/check-no-hardcode.ts` | The scan your detectors, describe text and corpus must pass |
| `docs/features/F03-models.md` | Task 3 record: log, follow-ups, audit notes |

## Code Context

**Task 3 exports** (`packages/engine/src/index.ts`):
```typescript
winProbability(state: MatchState, model: WinProbModel):
  { battingTeam: string; bowlingTeam: string; pBattingTeamWins: number } | null   // null before innings 1
leverage(input: { before: MatchState; after: MatchState; event: DeliveryEvent; model: WinProbModel }):
  { value: number; wpBefore: number; wpAfter: number; swing: number }   // swing in batting-side terms; throws on mixed sides
projectedPoints(playerId: string, priors: PriorsFile): number           // round2; throws for an unknown id
projectSquad(squad: FantasySquad, priors: PriorsFile, rules: FantasyRules):
  { total: number; perPlayer: { playerId: string; projected: number; multiplier: number }[] }
WinProbModelSchema / WinProbModel   // model.leverage.{weights, nudgeThreshold, percentile}
PriorsFileSchema / PriorsFile       // players[id] = { role, appearances: {matchId, date, points}[], projected }
chaseFeatures(runsNeeded, ballsLeft, wicketsLeft): number[]; firstInningsFeatures(runs, wicketsLost, ballsBowled): number[]
sigmoid(z); predictLogistic(weights, features); fitLogistic(rows, { l2, maxIter, tol })
```

**Replay loop with correct before/after** (the gate's input shape):
```typescript
const state = createMatchState(matchId);
for (const event of events) {
  const before = structuredClone(state);   // only needed when a detector reads `before`
  applyEvent(state, event);
  gate.process({ before, after: state, event, events, ctx });   // read-only use of `after`
}
```

**Big balls with the committed model** (`<innings>:<label> <kind> (<seq>) value`). This is
reference data, not something to hardcode; tests derive it:
- 1298150 (22): 1:1.1 W (0018) · 1:3.6 W (0036) · 1:10.5 6 · 1:11.1 6 · 1:11.3 6 · 1:12.2 W · 1:13.2 W ·
  1:13.6 W · 1:15.5 W · 1:16.4 W · 1:18.3 6 · 1:19.2 W · 1:19.3 6 · 2:1.5 W · 2:3.2 W · 2:5.3 W ·
  **2:18.6 6 (0254) 0.410 · 2:19.1 W (0255) 0.378 · 2:19.4 nb (0258) 1.000** · 2:19.4 wd (0259) 0.273 ·
  **2:19.5 W (0261) 0.305 · 2:19.6 wd (0262) 0.261**
- 1415755 (24), innings 2 includes **16.1 W (0236) 0.268** and **19.1 W (0254) 0.188**.

## Resume Instructions

1. `cd ~/Downloads/SidelineProd-Dream11FDEAssignment && export PATH="$HOME/.local/bin:$PATH" && node --version && pnpm --version`
   - Expected: `v24.22.0`, `10.34.7`
2. `pnpm install --frozen-lockfile && pnpm verify`
   - Expected: the "Current State" baseline (183 tests). If anything is red, stop and report.
3. `git checkout -b task/04-moments-engine`; create `docs/features/F04-moments-engine.md` from `docs/features/_TEMPLATE.md`.
4. Steps 4.1 → 4.9 test-first: `pnpm vitest run --project engine <name>` fails first for the right
   reason, then passes. Commit small (`test(engine): …`, `feat(engine): …`), each commit green.
5. For every new formula (z-scores, swaps, crowd rates, gate counters), mutate it once by hand in a
   scratch copy and confirm a test fails. Copy without `.env`:
   `tar --exclude=./.env -cf - . | tar -xf - -C <scratch>/repo`.
6. Finish: `pnpm verify` green (more than 183 tests, none skipped); `git diff --stat main -- packages/engine/test/golden scripts/oracle data/models` empty;
   `python3 -I scripts/oracle/audit/mutate.py <scratch copy>` still `18 killed, 0 survived`; docs updated;
   everything committed; then `HANDOFF6.md` (`AGENTS.md` → "Finishing"), and stop.

## Setup Required

- `~/.local/bin` on `PATH` (Node, pnpm). No sudo; no C compiler; no network needed for Task 4.
- No new dependencies expected (`mulberry32`, z-scores and the gate are plain TypeScript). Any new
  dependency needs a Decisions entry (Constraint 10).

## Edge Cases & Error Handling

- `winProbability` is null before the first `innings_start`. The lineup detector runs at the second
  `playing_xi`, before any innings, so it must not need WP.
- `leverage` only makes sense for a delivery, with `before` and `after` either side of it.
- Priors exist only for the two demo matches. For the audit's holdout run ("run detectors on the
  holdout match"), detectors that need priors (lineup swaps, collapse projections) need a
  synthetic `PriorsFile` or must report that priors are missing. Never invent numbers (Constraint 3).
- Collapse uses `projectSquad` before and after the dismissal; `projectedPoints` throws for ids
  outside the squad file.
- Ties: a level finish gives WP 0.5, so the batting side is neither winning nor losing.
- Catch-up anomalies use the **population** standard deviation of the window's complete overs (PLAN 4.6).

## Warnings

- **Do not edit** `packages/engine/test/golden/*`, `scripts/oracle/*` (including `audit/`) or
  `data/models/*` (Constraint 14), or any existing test, to get green. If the plan looks wrong,
  write `docs/bugs/BUG-004-*.md` and flag it under "Audit Requests".
- Do not tune `nudgeThreshold`, the leverage weights or the WP model. Task 4 consumes them.
- `check:hardcode` scans `packages/*/src`. Detectors, `describeDelivery` text and fallbacks must not
  name demo players, teams or labels; the corpus uses placeholders like `{batter}` (4.9 tests it).
- No `Date.now()` / `Math.random()` in the engine: the gate takes `nowMicros`, and the crowd takes a
  seed string (`seedFrom`).
- Erasable TypeScript only; `.ts` extensions on relative imports; no `node:*` in `packages/engine/src`.
- Tick PLAN checkboxes without rewording them. The TEST_CHECKLIST task-log row and F04's "Audit
  notes" belong to the auditor.
- pnpm prints "Update available 10.34.7 → 12.x": ignore it (pinned via `packageManager`).
- `.env` holds a real key: never read it into output, logs or commits. Do not merge, tag, push or
  rewrite history.
