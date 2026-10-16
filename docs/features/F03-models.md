# F03: Models (win probability, leverage, player priors)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 03 in `docs/PLAN.md`
- **Branch:** `task/03-models`
- **Owner / session:** Claude, implementing in place of Codex (unavailable), then auditing, 2026-10-16
- **Status:** audited and merged (`t03-verified`)

## Scope

Step 3.0 closes the Task 2 audit carry-overs: tests that pin structural times, innings-end
reasons and the maiden and fantasy rules, the "won" result text, and intent comments. Then a
logistic-regression win-probability model trained on the real men's T20I archive, a leverage
score whose 95th percentile marks the "big balls", and pre-match fantasy projections for both
demo squads, all produced by one reproducible script into `data/models/`. It does not touch the
detectors or the gate (Task 4), the server (Task 5) or any UI.

## Plan steps

- [x] 3.0 Task 2 audit carry-overs (F02 follow-ups 1-7), proven by `mutate.py` → `18 killed, 0 survived`.
- [x] 3.1 `logistic.ts` (sigmoid, predictLogistic, fitLogistic by Newton/IRLS) + tests.
- [x] 3.2 `winprob.test.ts` (model file checks, terminal states, monotonicity, demo sanity).
- [x] 3.3 `scripts/lib/archive.ts`, `scripts/build-models.ts`, `winprob.ts`; Biome exclusion; build; commit `data/models/*`.
- [x] 3.4 `leverage.ts` + tests (no per-ball tuning). Two listed balls missed: reported (BUG-003),
  then the list was amended by Nabhanyu's decision (D-043).
- [x] 3.5 `priors.ts` + tests.
- [x] 3.6 `pnpm verify` green; docs.

## Log (newest last)

- 2026-10-16: Baseline on `main` (`50e15ea`): `pnpm verify` green, 13 files / 106 tests,
  `check-no-hardcode: OK (32 source files, 209 terms)`. Downloaded `t20s_male_json.zip`
  (14,479,929 bytes, 3,627 match files plus README and LICENSE): sha256 `95305bc2…860a`, the same
  archive HANDOFF4 surveyed.
- 2026-10-16, step 3.0: the PLAN literals for structural times all matched a fresh build, so the
  new timing, innings-end and determinism tests passed at once (as the plan predicted); their bite
  came from the mutants. The "won" test failed first (`"Authored display label won by the match"`)
  and passed after the fix. The maiden table now separates team runs from runs charged; the
  penalty-only case also kills a hand mutant that charges penalties to the bowler, which no golden
  test can (neither demo match has a penalty). `mutate.py` on a scratch copy (made with `tar`
  excluding `.env`): **18 killed, 0 survived**, no SKIP.
- 2026-10-16, step 3.1: `logistic.test.ts` failed on the missing exports, then passed. The seeded
  synthetic fit recovers `[-1.023, 1.991, -3.029]` for `[-1, 2, -3]`. Hand mutants (wrong step
  sign, ridge dropped from the gradient) are both killed.
- 2026-10-16, step 3.3: `scripts/test/archive.test.ts` (16 cases: filters, synthesized fixtures,
  six BUG-002 classes, an unclassified failure) failed on the missing module, then passed. A
  scratch run over the real archive reproduced HANDOFF4 exactly: 3,255 candidates, 3,093
  accepted, 162 rejected (98 mid-over bowler change, 31 seven-ball over, 12 XI over 11, 12 nameless
  fielder, 5 `retired not out`, 4 XI under 11), 607 in the test split.
- 2026-10-16: `winprob.test.ts`, `leverage.test.ts` and `priors.test.ts` were written before their
  modules. Function-level cases went green against hand-made models and priors files; data-level
  cases stayed red (no `data/models/winprob-v1.json`) until the first build. Leverage and priors
  were implemented before the first committed build because the build computes the threshold and
  the projections with them (ledgered ruling).
- 2026-10-16: first build (download path) in 72 s: 370 filtered, 2 demo, 162 rejected, 3,093 used
  (2,486 train / 607 test); chase Brier 0.1215, first-innings Brier 0.2099; nudgeThreshold
  0.18437 over 134,049 test-split legal balls. A rebuild with `--zip` on the same archive gave
  byte-identical files, and so did two more after a README wording fix and a helper rename.
- 2026-10-16, step 3.4: the trap fired. Every check passed except two listed 1298150 balls: 18.5
  scores 0.0932 and the final 19.6 0.0193 against 0.18437. Nothing was tuned. An independent
  Python re-derivation gave the same probabilities, and empirical win rates explain both: the
  filters drop super-over ties, so a chase needing 1 off the last ball almost always wins in the
  data (26 of 27) and the 19.6 wide carries that swing; and a six from 2% to 6% cannot reach 0.18
  under these weights. Written up as BUG-003, with the failing test committed as written
  (`dbb0722`). The options went to Nabhanyu, who chose to amend the list (D-043): drop 18.5 and
  the final 19.6, add the 19.6 wide. Steps 4.5 and 5.6, which inherited the old list, were
  amended with it.
- 2026-10-16: priors reproduce the pre-Task-3 survey (29 of 30 and 27 of 30 players with 10
  appearances; Naseem 8, Baartman 6, Coetzee 6, Rickelton 3). Neither demo match is an
  appearance in the other's priors.
- 2026-10-16: Biome flagged two warnings because the build's helper was called `fit` (Jasmine's
  focused-test alias); renamed `fitModel`. `pnpm verify` green: 18 files, 180 tests.
- 2026-10-16, final review: two Important findings, fixed test-first. (1) `WinProbModelSchema`
  accepted a model file whose feature names or order differ from the code's, which would give
  wrong probabilities silently; it now requires the exact names in order. (2) No test pinned the
  feature formulas, so a first-innings `wl·bb → wl·r` mutant survived. The first literal cases I
  wrote had runs/160 equal to balls/120 and the mutant *still* survived; re-running the mutant
  table caught it, and inputs that separate every term kill it. 183 tests.

## What worked / what did not

- The pipeline accounts for every archive match and the build throws if the four buckets (used,
  filtered, demo, rejected) do not add up. Rejections carry the BUG-002 class or the raw stage and
  message, so a new failure mode would show up in the README table instead of disappearing.
- Byte-identical rebuilds came for free from numeric id order, fixed key order and keeping the
  clock out (`retrievedAt` is reused for the same sha256).
- The chase model is well calibrated (every bin within 0.05) and passes the fast-check shape tests
  over 1-300 runs, 1-120 balls and 1-10 wickets. The first-innings model beats a coin flip (Brier
  0.2099 against 0.25) but is overconfident at the extremes: its 0.8-1.0 bins are about 0.10 too
  high. The PLAN does not test first-innings calibration; recorded as a limit and a follow-up.
- Did not work as planned: step 3.4's climax list (BUG-003, resolved by D-043).
- The executing session wrote the tests first for every new module and recorded each red run here,
  but committed tests together with the data they read, so most commits are green; the leverage
  test commit (`dbb0722`) is deliberately red with the PLAN's original list.

## Decisions made

- [D-039: Archive pipeline: every match accounted for, generated files reproducible](../Decisions.md#d-039--archive-pipeline-every-match-accounted-for-generated-files-reproducible-2026-10-16-t3-claude)
- [D-040: Win-probability model as built](../Decisions.md#d-040--win-probability-model-as-built-2026-10-16-t3-claude-refines-d-024)
- [D-041: The leverage threshold comes from the test split](../Decisions.md#d-041--the-leverage-threshold-comes-from-the-test-split-2026-10-16-t3-claude)
- [D-042: Player priors as built; each entry carries the player's role](../Decisions.md#d-042--player-priors-as-built-each-entry-carries-the-players-role-2026-10-16-t3-claude)
- [D-043: PLAN 3.4's climax list amended to the balls the model can see (Nabhanyu)](../Decisions.md#d-043--plan-34s-climax-list-amended-to-the-balls-the-model-can-see-2026-10-16-after-t3-implementation-nabhanyu)

## Verification (paste real output)

```text
pnpm verify
packages/engine typecheck: Done
apps/server typecheck: Done
apps/web typecheck: Done
Checked 89 files in 218ms. No fixes applied.
 Test Files  18 passed (18)
      Tests  183 passed (183)
check-no-hardcode: OK (36 source files, 209 terms)
verify-data: OK (2 matches)
✓ built in 270ms

pnpm test:e2e
  8 passed (13.2s)

node scripts/build-models.ts --zip <t20s_male_json.zip>
build-models: 3,627 match files, sha256 95305bc2dae8dcce7b8da7755f3992521874b14598ea5828129f37834e8b860a, retrieved 2026-10-16
build-models: 370 filtered, 2 demo, 162 rejected by the engine, 3,093 used (train 2,486, test 607)
build-models: chase Brier 0.121465, first-innings Brier 0.209919
build-models: nudgeThreshold 0.18437096987916934 over 134,049 test-split legal balls
build-models: wrote winprob-v1.json, priors-1298150.json, priors-1415755.json, README.md
(download run and three --zip runs: identical sha256 for all four files)

python3 -I scripts/oracle/audit/mutate.py <scratch copy>
mutate: 18 killed, 0 survived
```

## Follow-ups (out of scope, noted for later)

1. Training data bias: the filters drop ties that went to a super over (more than two innings), so a
   chase needing 1 off the last ball almost always wins in training (26 of 27). Revisit when the
   engine supports super overs; label them as ties (D-043).
2. Task 4: the match-deciding delivery is the biggest spoiler of all, but the winning single scores
   0.019 here because the wide before it already made the win near-certain. Consider a decisive-ball
   trigger in the nudge detector (a Task 4 design decision, D-043).
3. The first-innings model is overconfident at the extremes (0.8-1.0 bins about 0.10 high). Options:
   a calibration layer fitted on the training split, or features that see the chasing side's
   strength. Not needed by any PLAN check today.
4. The leverage climax list is now what the model sees. If the model is retrained (follow-up 1),
   re-run step 3.4's checks and update D-043's list with a new decision if it changes.
5. BUG-002 engine support (F02 follow-up 8) would bring back 162 archive matches; the build counts
   them automatically.

## Audit notes (filled by the auditor)

**Audit, 2026-10-16, Claude, on `20a1cb7`. Verdict: accepted; merged `--no-ff`, tagged
`t03-verified`.** Caveat first: Codex was unavailable, so the same agent implemented and audited
this task. Every check below ran on real output, but a self-audit is weaker than an independent
one; an independent re-audit (Codex, or a fresh Claude session) is cheap with the commands below.

- **Verification (fresh runs):** `pnpm install --frozen-lockfile`; `pnpm verify` → 3× `typecheck:
  Done`, `Checked 89 files … No fixes applied.`, `Test Files  18 passed (18)`, `Tests  183 passed
  (183)`, `check-no-hardcode: OK (36 source files, 209 terms)`, `verify-data: OK (2 matches)`,
  `✓ built in 270ms`; `pnpm test:e2e` → `8 passed (13.2s)`.
- **Read-only files:** `git diff --stat main -- packages/engine/test/golden scripts/oracle` is empty.
- **Anti-hardcoding (§2A):** scan OK; no `hardcode-ok`; no `.skip`/`.only`; no label, seq or id
  comparisons in the new source; the only golden-number hit is the PLAN's `runs / 160` feature
  scaling; demo ids come from the manifest; `packages/engine/src` uses no clock, randomness or Node.
- **Engine vs oracle (§2B):** both demo matches IDENTICAL (`compare.py`).
- **Holdout (§2C):** the whole World Cup archive again (sha256 `df5e2fa7…`): `199 IDENTICAL`,
  `31 ENGINE_REJECTS`, `check_spec.py` `TOTAL mismatches: 0` (51 categories), the Task 2 baseline.
  Win-probability trajectories of three test-split matches (1415735, 1415742, 1512770) start at
  the first-innings base rate (0.49), move with runs and wickets, start the chase lower for bigger
  targets, end at 1 for the winner, and flag wickets and boundaries in tight phases. 40 priors
  appearances re-scored by the oracle with the same synthesized fixtures: 0 mismatches.
- **Task 3 hooks:** the download run and the next `--zip` run of the 2026-10-16 archive wrote
  identical files; after a README template fix, three more `--zip` runs (the last on the audited
  head) were identical too, and the JSON files never changed. The calibration tables are in
  `data/models/README.md` (chase within 0.05 in every bin; first innings overconfident at the
  extremes, a recorded limit); both demo matches are in `excludedMatchIds`; the counts reproduce
  HANDOFF4 and BUG-002 exactly (3,255 candidates, 3,093 used, 162 rejected by class, 607 test).
- **Mutation (§2D):** `mutate.py` → `18 killed, 0 survived` (was 12/6 at `t02-verified`). Twenty
  hand mutants of the new code: 19 killed after the fix pass; the survivor (dropping the Hessian's
  off-diagonal terms) still converges to the same optimum on the synthetic data, and would fail
  loudly at build time otherwise (deferred minor).
- **Shortcut review:** no test weakened except the one the owner amended (D-043, BUG-003): PLAN
  3.4's climax list, after the specified model missed two balls and nothing was tuned. Steps 4.5
  and 5.6 inherited the old list and were amended with it.
- **Security (§2F, as far as it applies):** `.env` untracked, mode 600, untouched; nothing
  secret-shaped in the diff.
- **Deferred minors:** the Hessian survivor above; `projectedPoints` could use `Object.hasOwn`;
  `roleMean` rounds with `Math.round` where `projectedPoints` uses `round2`; a dead symmetrisation
  loop in `fitLogistic`; the generated README could show how to save the zip for an exact rebuild.
