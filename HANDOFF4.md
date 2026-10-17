# Handoff: Task 3, models (win probability, leverage, player priors)

**Generated**: 2026-10-16 18:40 IST (by Claude Code, architect/auditor)
**Branch**: `main`, clean (this file is committed on top of `c76396f`). Task 2 is merged and tagged `t02-verified` (`be5eb6b`). Create `task/03-models` from `main`.
**Status**: Ready for implementation (Task 2 done and verified; Task 3 not started)

## Goal

Sideline is an AI second-screen companion for live cricket (Dream11 FDE intern assignment by
Nabhanyu). Implement **Task 3 only** from `docs/PLAN.md`:
- a calibrated win-probability model trained on real men's T20Is;
- a leverage score whose 95th percentile marks the "big balls";
- pre-match fantasy projections (priors) for both demo squads.

All of it must be built by one reproducible script and committed under `data/models/`. Step 3.0, the
Task 2 audit carry-overs, comes first. Claude audits afterwards; you do not merge.

## Completed

- [x] Task 1 foundation (`t01-verified`): toolchain, contracts, real data, guards, oracle, docs.
- [x] Task 2 cricket core (`t02-verified`): `buildTimeline`, the reducer, `fantasyPoints` and the
  `engine-report` CLI. The audit found it identical to the oracle on both demo matches and on all 199
  World Cup archive matches the engine accepts. An independent re-derivation of the rules found 0
  mismatches over 46,254 deliveries (detail: `docs/features/F02-cricket-core.md`, audit notes).
- [x] The auditor's toolkit `scripts/oracle/audit/` (archive sweep, comparator, spec checker,
  mutant table). It is read-only for you, but you **run** `mutate.py` in step 3.0.
- [x] BUG-001 fixed: substitute fielders outside the announced XI score nothing (D-038; DOMAIN §3
  now says so explicitly). The oracle was aligned to it; the engine already behaved this way.
- [x] Pre-Task-3 survey of the real archive, `t20s_male_json.zip` (retrieved 2026-10-16, 14.5 MB,
  sha256 `95305bc2dae8dcce7b8da7755f3992521874b14598ea5828129f37834e8b860a`):
  - 3,627 matches, of which 3,255 pass the PLAN filters.
  - The real engine, with PLAN-style synthesized fixtures, **accepts 3,093** and rejects 162
    (classes in BUG-002).
  - The test split (`fnv1a32(id) % 5 === 0`) is 607 matches.
  - Priors: 29 of 30 1298150 squad players and 27 of 30 1415755 squad players have 10 usable prior
    appearances. The rest have fewer (Naseem 8; Baartman 6, Coetzee 6, Rickelton 3). None has zero.

## Not Yet Done (exact tests, literals and rules in `docs/PLAN.md` → "Task 3")

- [ ] **3.0** Carry-overs, all test-first or comment-only (F02 follow-ups 1-7):
  - literal structural timestamps on both matches;
  - `innings_end.reason`;
  - determinism and the wicket-gap test on both matches;
  - fix the mislabelled maiden "penalty" case and assert `runsConceded`;
  - synthetic duck-role and slab-rounding tests;
  - `"<team> won"` when a winner has no margin;
  - intent comments.

  Done when `python3 -I scripts/oracle/audit/mutate.py <scratch copy>` prints `18 killed, 0 survived`.
- [ ] **3.1** `logistic.ts` (sigmoid, predictLogistic, fitLogistic by Newton/IRLS) + `logistic.test.ts`
- [ ] **3.2** `winprob.test.ts` (model file checks, terminal states, fast-check monotonicity, demo sanity)
- [ ] **3.3** `scripts/lib/archive.ts`, `scripts/build-models.ts`, `winprob.ts`; add `"!data/models"` to
  `biome.json`; run the build; commit `data/models/*`
- [ ] **3.4** `leverage.ts` + `leverage.test.ts`. **Do not tune weights per ball.** If a listed ball misses,
  stop and report it in F03.
- [ ] **3.5** `priors.ts` + `priors.test.ts` (the zero-appearance case needs a synthetic `PriorsFile` entry)
- [ ] **3.6** `pnpm verify` green; docs: F03, Flow, Architecture (incl. model metrics), Decisions
  (features, split, threshold, Biome exclusion), TEST_CHECKLIST baselines, ROLLBACK row,
  `data/models/README.md`, the `docs/Bug_Feature.md` row, and the README status line
- [ ] Write `HANDOFF5.md` per `AGENTS.md` → "Finishing", then stop

## Failed Approaches (Don't Repeat These)

- **Holding a reducer state by reference.** `applyEvent` mutates in place (partnership objects,
  innings arrays). An audit dump that kept `innings.partnership` by reference reported 40,548 false
  mismatches. `leverage({ before, after })` needs a real copy: take `structuredClone(state)` before
  `applyEvent`, or use `foldEvents(id, events, seq - 1)`.
- **Comparing JSON output as bytes when key order isn't controlled.** JS objects list all-digit keys
  first, in ascending order, whatever the insertion order. Match ids and some player ids are all
  digits. `engine-report` reorders them, and the oracle's `fantasy` order changes per run (Python set
  order). For byte-stable model files: build objects in a fixed order, keep that hoisting in mind,
  and use sorted arrays where order matters. Compare foreign outputs as data.
- **Writing `JSON.stringify(x, null, 2)` into a path Biome checks.** Verified: Biome collapses short
  arrays (`"weights": [...]` onto one line), so `pnpm lint` fails. Formatting after writing breaks the
  byte-identical rebuild hook. Hence `"!data/models"` in `biome.json`, like `data/raw` and the golden
  files.
- **Testing one holdout match.** Task 2's single holdout (1273712) passed cleanly and exercised no
  edge case. The full sweep found 31 rejections and a fantasy discrepancy. Run the pipeline over the
  whole archive and count every exclusion.
- **"Through X" with repeated labels.** Extras repeat labels, so "after innings-2 `13.6`" means the
  **last** delivery labelled `13.6`. This was Codex's own Task 2 lesson; 3.2's demo checks
  (`13.6`, `18.4`, `18.6`, `14.6`) use the same convention.
- **Widening `context.teams` with `.map`.** It loses the fixed two-team tuple type and fails typecheck.
  Build the synthesized `teams` as an explicit `[teamA, teamB]` tuple.
- **Rewording PLAN steps.** Task 2's audit found steps rewritten instead of ticked. Tick only, and put
  spec questions in the HANDOFF.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| PLAN Task 3 build rules, features, split, `l2`, thresholds are decided | Implement them exactly; the audit rebuilds and inspects calibration |
| Engine-rejected archive matches are excluded explicitly (D-037, BUG-002) | 162 of 3,255 in the current zip; never silent; counts per reason in `data/models/README.md` |
| A priors appearance = in the announced XI of a match the engine accepts | Substitutes score nothing (D-038); a rejected match is replaced by the next most recent |
| `build-models.ts [--zip <path>]`, sha256 recorded | Cricsheet republishes the zip; the audit rebuilds from the same zip and expects identical bytes |
| `data/models` excluded from Biome | Generated, byte-reproducible files (verified that Biome would reflow them) |
| Demo match ids come from `data/raw/cricsheet/manifest.json` | Facts live in data; `excludedMatchIds` must contain both |
| Engine stays pure (D-004) | `models/*.ts` take parsed data as arguments; only scripts and tests touch `node:fs` |
| Commit small and often | Task 2 landed as two large commits; the audit noted it |

## Current State

**Working**: `main` at `c76396f` (+ this handoff). `pnpm verify` → 3× `typecheck: Done`,
`Checked 78 files … No fixes applied.`, `Test Files  13 passed (13)`, `Tests  106 passed (106)`,
`check-no-hardcode: OK (32 source files, 209 terms)`, `verify-data: OK (2 matches)`, `✓ built in ~250ms`.
`pnpm test:e2e`: `8 passed`.

**Broken**: nothing known. **Known limits**: BUG-002 (the engine rejects some Cricsheet files; you
exclude them).

**Uncommitted Changes**: none. `task/02-cricket-core` still exists (merged). A local **`.env` holds a
real API key**. Task 3 does not need it: do not open, print, copy or commit it.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/PLAN.md` (Task 3) | Authoritative spec: signatures, feature formulas, build rules, step 3.0 literals, test thresholds |
| `docs/bugs/BUG-002-engine-rejects-cricsheet-edge-cases.md` | Rejection classes and the 2026-10-16 counts you should reproduce |
| `docs/DOMAIN.md` §1-3 | Cricket and fantasy definitions (substitutes: §3, D-038) |
| `packages/engine/src/cricket/{timeline,reducer}.ts` | What you fold; `applyEvent` mutates; `foldEvents` refolds |
| `packages/engine/src/contracts/state.ts` | `MatchState`, `InningsState`, `LiveSituation` (field semantics) |
| `packages/engine/src/fantasy/scoring.ts` | `fantasyPoints` (playing XI only), `squadPoints` (multipliers) |
| `packages/engine/test/helpers/data.ts` | `loadMatch(id)` for tests |
| `scripts/fetch-cricsheet.ts` | Download pattern: `mkdtempSync`, `fetch`, `unzip -p`, sha256, `rmSync` in `finally` |
| `scripts/verify-data.ts` | How a root script imports the engine (`../packages/engine/src/index.ts`) |
| `scripts/oracle/audit/README.md`, `mutate.py` | Step 3.0's acceptance check; how to make the scratch copy |
| `data/matches/<id>/{players,personas}.json` | Squads with roles (priors), persona squads (`babar-believer` etc. for `projectSquad`) |
| `data/raw/cricsheet/manifest.json` | The demo match ids to exclude from training |
| `biome.json` | Add `"!data/models"` to `files.includes` |

## Code Context

**Task 2 exports you build on** (`packages/engine/src/index.ts`):
```typescript
buildTimeline(input: { raw: unknown; players: PlayersFile; context: MatchContextFile; timing?: TimingModel }): MatchEvent[]
createMatchState(matchId: string): MatchState
applyEvent(state: MatchState, event: MatchEvent): void            // mutates; throws if seq !== lastSeq + 1
foldEvents(matchId: string, events: readonly MatchEvent[], uptoSeq?: number): MatchState  // fresh state
fantasyPoints(state: MatchState, players: readonly Player[], rules: FantasyRules): Map<string, PlayerPoints> // XI only
squadPoints(points: Map<string, PlayerPoints>, squad: FantasySquad, rules: FantasyRules): SquadPoints
fnv1a32(input: string): number;  round2(x: number): number
PlayersFileSchema, MatchContextFileSchema, FantasyRulesSchema, PersonasFileSchema   // zod
```

**State you read** (`contracts/state.ts`):
```typescript
state.phase: "pre_match" | "toss_done" | "innings_1" | "innings_break" | "innings_2" | "complete"
state.innings[i]: { innings: 1 | 2; battingTeam; bowlingTeam; runs; wickets /* excl. retired hurt */;
                    legalBalls; target: { runs; balls } | null; status; endReason }
state.live: null /* before the first innings_start */ | {
  innings; runsRequired: number | null;  // innings 2 only: max(0, target.runs - runs)
  ballsRemaining: number;                // innings 2: max(0, target.balls - legalBalls); innings 1: always 0
  requiredRunRate: number | null; currentRunRate: number; strikerId; label; freeHitNext; ... }
state.result: { winner: TeamCode | null /* null for a tie or no result */; text; playerOfMatch } | null
```
Chase row "before the first ball" = the state right after the innings-2 `innings_start`, where
`live.runsRequired = target.runs` and `live.ballsRemaining = target.balls`. `wicketsLeft = 10 −
innings.wickets`. Label "chasing team won" = `result.winner === innings[1].battingTeam`.

**Synthesized fixtures that the engine accepted for 3,093 archive matches** (PLAN: role `BAT` except
the priors player's own role from our fixtures, credits 8, `notes: []`):
```typescript
const codes = ["TA", "TB"] as const; // placeholder team codes: only distinctness matters (^[A-Z]{2,4}$)
const players = PlayersFileSchema.parse({
  matchId: id, creditsNote: "synthesized from Cricsheet",
  players: info.teams.flatMap((team: string, t: number) => info.players[team].map((name: string) => ({
    id: info.registry.people[name], cricsheetName: name, displayName: name, shortName: name,
    team: codes[t], role: "BAT", credits: 8 }))),
});
const context = MatchContextFileSchema.parse({ matchId: id, title: "synthesized", competition: "synthesized",
  stage: "synthesized", notes: [], teams: [teamFixture(0), teamFixture(1)] }); // explicit 2-tuple
// teamFixture(t) = { code: codes[t], name: info.teams[t], cricsheetName: info.teams[t], color: "#000000", colorAlt: "#ffffff" }
```

## Resume Instructions

1. `cd ~/Downloads/SidelineProd-Dream11FDEAssignment && export PATH="$HOME/.local/bin:$PATH" && node --version && pnpm --version`
   - Expected: `v24.22.0`, `10.34.7`
2. `pnpm install --frozen-lockfile && pnpm verify`
   - Expected: the "Current State" baseline (106 tests). If anything is red, stop and report.
3. `git checkout -b task/03-models`; create `docs/features/F03-models.md` from `docs/features/_TEMPLATE.md`.
4. Step 3.0: add the tests and comments, then `pnpm vitest run --project engine` (all green). Make a
   scratch copy as `scripts/oracle/audit/README.md` shows and run
   `python3 -I scripts/oracle/audit/mutate.py <copy>`.
   - Expected: `mutate: 18 killed, 0 survived`. A `SKIP` means a snippet drifted: report it, don't edit the tool.
5. Steps 3.1 → 3.5 test-first (`pnpm vitest run --project engine <name>`: red first, then green).
6. `node scripts/build-models.ts` (downloads about 14.5 MB), then rebuild with `--zip <that zip>` and
   `git status`. For the 2026-10-16 zip, expect 3,255 matches through the filters, 3,093 accepted
   (162 rejections, BUG-002 classes) and a 607-match test split; a newer zip differs slightly, so
   record what you got.
   - Expected: the rebuild leaves `data/models/*` byte-identical (no `git status` change).
   - If not: look for clock-derived values, unsorted iteration, or object key order.
7. Finish: `pnpm verify` green (more than 106 tests, none skipped); `git diff --stat main -- packages/engine/test/golden scripts/oracle`
   empty; docs updated; everything committed; then `HANDOFF5.md` (AGENTS.md → "Finishing"), and stop.

## Setup Required

- `~/.local/bin` on `PATH` (Node, pnpm). No sudo; no C compiler (no native addons); `unzip` CLI exists.
- **Network** for `cricsheet.org` (the build script). If the Codex sandbox blocks it or pnpm writes,
  launch with `-s workspace-write -c sandbox_workspace_write.network_access=true --add-dir ~/.local/share/pnpm`.
- No new dependencies expected: the 6×6 Newton/IRLS solve is plain TypeScript (zod, fast-check and
  vitest are installed). Any new dependency needs a Decisions entry (Constraint 10). No API key needed.

## Edge Cases & Error Handling

- `buildTimeline` (schemas) or `foldEvents` (the reducer's one-bowler-per-over check) throws on a
  BUG-002 class → catch, exclude, record id and reason.
  A filter exclusion (DLS, no target, not 20 overs, super over, no result) is counted separately
  from an engine rejection.
- Ties: three pass the filters (`1142504`, plus two bowl-outs, `237242` and `287862`). `result.winner`
  is null, so both labels are 0. A bowl-out is not a win; note the count in the README.
- `winProbability`: null before the first `innings_start`. Chase terminal states: target reached → 1;
  all out or balls exhausted short → 0; exact tie at the end → 0.5.
- `retrievedAt` must not come from the clock on a rebuild. If the zip's sha256 equals the committed
  `trainedOn.sha256`, keep the committed `retrievedAt`; otherwise use the download date.
- Priors with fewer than 10 appearances use what exists (the formula handles any `n`). Guard
  `roleMean` against a role with no appearances (none in our squads today).
- `check:hardcode` scans `packages/*/src`. `models/*.ts` must never name a demo match, player or team;
  tests may.

## Warnings

- **Do not edit** `packages/engine/test/golden/*`, `scripts/oracle/*` (including `audit/`), or any
  existing test to get green. If the oracle or the plan looks wrong, write `docs/bugs/BUG-003-*.md` and
  flag it under "Audit Requests".
- 3.4 is a deliberate trap for tuning: if a listed ball misses the threshold with the specified
  features and weights, **stop and report**. Don't change weights, features or the percentile to pass.
- Tick PLAN checkboxes without rewording them. The TEST_CHECKLIST task-log row and F03's "Audit notes"
  belong to the auditor.
- Erasable TypeScript only; `.ts` extensions on relative imports; no `node:*` in `packages/engine/src`.
- pnpm prints "Update available 10.34.7 → 12.x": ignore it (pinned via `packageManager`).
- `.env` holds a real key: never read it into output, logs or commits. Do not merge, tag, push or
  rewrite history.
