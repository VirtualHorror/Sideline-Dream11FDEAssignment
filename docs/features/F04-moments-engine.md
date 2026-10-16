# F04: Moments engine (clock, delay buffer, detectors, gate, quests, crowd, commentary)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 04 in `docs/PLAN.md`
- **Branch:** `task/04-moments-engine`
- **Owner / session:** Claude, implementing in place of Codex (unavailable), then auditing, 2026-10-16
- **Status:** audited and merged (`t04-verified`)

## Scope

Everything in the pure engine that decides *when* something matters: the stadium and TV clocks and
the per-fan delay buffer, one-line commentary for a delivery, the four phase detectors (lineup,
collapse, nudge, room) plus the catch-up facts the session asks for, the entropy gate that runs
them on every event, prediction (quest) resolution from real deliveries, and a seeded synthetic
watch-along crowd with its corpus. At Nabhanyu's request the nudge detector also flags the ball
that decides the match (D-046), and step 4.0 first closes the Task 3 audit's deferred minors
(D-044). It adds no server, no AI call and no UI (Tasks 5-6), and it consumes the Task 3 models
without retraining them.

## Plan steps

- [x] 4.0 Task 3 audit carry-overs (the F03 deferred minors and the spot-check's retired-hurt survivor).
- [x] 4.1 `clock.test.ts`, `delay.test.ts`.
- [x] 4.2 `describe.test.ts`.
- [x] 4.3 lineup detector + `enumerateSwaps` (and join points, `cricket/join.ts`).
- [x] 4.4 collapse detector.
- [x] 4.5 nudge detector (+ the match-deciding delivery, owner request).
- [x] 4.6 catch-up facts.
- [x] 4.7 gate (done after 4.9 and the room detector, which it needs).
- [x] 4.8 quests.
- [x] 4.9 crowd and corpus (done before 4.7).
- [x] 4.10 `pnpm verify` green; docs.

The room detector has no PLAN step of its own (its rule is in the PLAN's detector rules); its tests
are in `detectors.test.ts`.

## Log (newest last)

- 2026-10-16: Independent spot-check of the Task 3 merge (`t03-verified`, self-audited in the
  previous session), in a fresh session on `main` (`5508a12`):
  - `pnpm install --frozen-lockfile && pnpm verify`: 18 files / 183 tests, `check-no-hardcode: OK
    (36 source files, 209 terms)`, build green. `t03-verified` is the `--no-ff` merge `af1549d`.
  - `node scripts/build-models.ts --zip <saved t20s_male_json.zip>` (sha256 `95305bc2…860a`) in a
    scratch copy without `.env`: the same counts (3,093 used, 162 rejected, 370 filtered) and all
    four files byte-identical to the committed ones.
  - `python3 -I scripts/oracle/audit/mutate.py <scratch copy>`: `18 killed, 0 survived`.
  - A stdlib-only Python re-derivation from the raw Cricsheet files and the model JSON (no engine
    code): 22 big balls in 1298150 and 24 in 1415755, every value HANDOFF5 lists (18.6 0.410, 19.1
    0.378, the 19.4 no-ball 1.000, the 19.6 wide 0.261; 18.5 0.0932, the winning single 0.0193),
    all 60 stored projections and all eight role means.
  - No `.skip`/`.only`, no `hardcode-ok`, no label or seq comparisons in engine source; the only
    oracle change since `t02-verified` is the BUG-001 fix (D-038). Deleted assertions in the diff
    are the step 3.0 rewrites, which are stronger.
  - Nine hand mutants of Task 3 code: seven killed. Survivors: dropping the Hessian's
    off-diagonal terms (known, F03 deferred minor) and **counting retired hurt as a wicket in
    leverage's spectacle** (new: D-041 says it is not one, but neither demo match has a retired
    hurt and no test builds one). Both go into step 4.0.
- 2026-10-16: Step 4.0 added to the PLAN at Nabhanyu's request (the five F03 deferred minors) plus
  the retired-hurt survivor (D-044). A scratch experiment fixed the Hessian test's data: on features
  with correlation about 0.99 the real fit converges in 6 Newton steps, and the diagonal-only
  mutant does not converge in 50.
- 2026-10-16, step 4.0: the inherited-name test failed first (`Cannot read properties of undefined
  (reading 'length')` instead of "no priors for player toString"), then passed with `Object.hasOwn`.
  The Hessian, retired-hurt and role-mean tests pass on the code as written and kill their
  mutants in a scratch copy (4 of 4, including a role mean edited by 0.06 in the committed file).
  `round2` for role means and the dead loop's removal changed no bytes: a rebuild from the recorded
  zip left the three JSON files byte-identical; only `data/models/README.md` changed (the new
  "keep the archive" recipe).
- 2026-10-16, step 4.1: clock and delay tests failed (`stadiumAt is not a function`), then passed.
  `stadiumAt` floors elapsed wall time at 0 (a browser clock behind the server's), a small addition
  to the PLAN formula (D-049).
- 2026-10-16, step 4.2: `describeDelivery` ("18.5 Rauf to Kohli, six"); 17 cases, with literal lines
  hand-derived from the raw final overs, failed on the missing export, then passed.
- 2026-10-16, step 4.3: detector contracts (`detectors/types.ts`, every facts type documented),
  join points (`cricket/join.ts`, checked against DOMAIN's 90/4, 106/4, 147/4 and the 1415755 chase's
  155/5 after 17 overs) and the lineup detector. Fakhar's swaps are exactly Pakistan's four spare
  batters, as the credit and role rules predict by hand; Pant's are the five best of twelve legal
  candidates; Jaiswal's five of eleven.
- 2026-10-16, step 4.4: collapse detector. Beyond the PLAN's personas, injected wickets pin the edges:
  a VC run out on ball 25 is inside Babar's quest (balls 8-25) and on ball 26 opens a second one; a
  captain bowled on ball 36 triggers and on ball 37 is `not_early`; Suryakumar out on exactly 10
  is cheap and on 11 is not.
- 2026-10-16, step 4.5: nudge detector with the decisive-ball rule (D-046). 23 teasers in 1298150 and 25
  in 1415755: the independently re-derived 22 and 24 big balls plus each match's last ball (0.019 and
  0.0003). Two of my test literals were wrong at first and were corrected from the raw file, not
  from engine output: 1415755's last ball is "19.6 Hardik to Nortje, 1 run" (I had guessed another
  bowler), and South Africa were 7 down before 19.3, so the all-out injection needs 19.3 and 19.4.
- 2026-10-16, step 4.6: catch-up facts. PLAN literals all held (90/4, 70 off 36, RRR 11.67, over 11's
  20 runs at z 3.04, 159/8, `catchup:1298150:2:0-14:casual`). The run-less spell (4 balls, 1.4-2.1),
  the three biggest swings (1.5, 3.2, 5.3) and the stand (59 off 47) came from an independent Python
  re-derivation. Test-side mistakes fixed from data: over 5 had one wicket, and the golden fantasy
  file is keyed by player id.
- 2026-10-16, step 4.9 (before 4.7, since the room detector and the gate read chat): `util/prng.ts`
  (reference values from an independent Python port of mulberry32 and FNV-1a), `crowd/simulate.ts`
  and `data/crowd/corpus.json` (303 lines). Seen in the output and fixed: a burst could repeat a
  line (now drawn without replacement); match-end lines needed their own stances (celebration,
  heartbreak); one line assumed a male batter.
- 2026-10-16: room detector. Measured on five crowd seeds, the first spike rule fired on the first
  ball of the match: the quiet pre-match half hour pulled the per-minute average down. The rate is
  now measured over this innings' minutes (D-047), and spikes land on the hot moments (innings 1's
  three-sixes over, the chase's 20-run over, the 19.4 no-ball). A hand-made chat pins the bar
  exactly (2/4 history: mean 3, SD 1, bar 5).
- 2026-10-16, step 4.7: the gate. The full 1298150 replay for babar-believer with the simulated crowd:
  266 events, 233 deterministic (0.876), 36 triggers (1 lineup patch, 1 bailout, 23 teasers, 11 room
  reads), 3 suppressed (Rizwan's `quest_active`, two `duplicate_key` room reads of the last over).
  A `%` in an `it.each` title garbled it, as HANDOFF5 warned; reworded.
- 2026-10-16, step 4.8: quest resolution, 32 cases whose expectations were re-derived in Python from
  the raw file (the no-ball six at position 118, Kohli's 46/57/74, Rohit out on ball 20, the 16-run
  last over with its extras).
- 2026-10-16: mutation review of the new code. Before running the mutants, a read-through found five
  edges no test pinned; tests were added (join point in collapse, the exact threshold, an innings
  won mid-over in the death overs, a leg bye as a dot with retired hurt as no wicket, no repeated
  line in a burst). Then 48 hand mutants in a scratch copy: 46 killed. One survivor was a real gap
  (a ball both big and decisive must read `match_decided`); its first test failed for an honest
  reason (a six with 2 needed off 2 scores 0.018: the model already had India at 99%, so it is not a
  big ball), and the rebuilt case (4 needed off the last ball, won with a four) kills it: 47 of 48.
  The last survivor is equivalent in practice: collapse's history replay treats a third qualifying
  dismissal in one innings, which a T20 cannot produce (captain and vice-captain bat once each).
- 2026-10-16: holdout run on two World Cup matches nobody had examined (from the saved archive, with
  `scripts/oracle/audit/gen_fixtures.py` fixtures, a synthetic pre-match persona whose captain and
  vice-captain are the two innings' first strikers, and audit-only priors): see Audit notes.

## What worked / what did not

- Writing each test before its module, and taking every hand-checked literal from the raw file or an
  independent Python re-derivation, kept engine output out of the expectations. The three literals I
  got wrong were all mine (a guessed bowler, a miscounted wicket, a key format); each failed red and
  was fixed from data.
- Injected wickets (a copy of the real timeline with one wicket added) made the rule edges testable
  on real states: the quest window's last ball, the 36th ball, 10 versus 11 runs, an all-out chase.
- The gate keeps 0.85-0.88 of a full replay deterministic on every seed and both holdouts. Late
  joiners sit lower (0.70-0.77 for late-from-work, f1-convert, proteas-late, football-fan) because
  they only see the climax; the PLAN's check is the full replay.
- Did not work first time: the room spike rule against the whole session (first-ball artifact), and
  a precedence test whose premise was false. Both were found by measuring, not by reading.
- Room reads happen only on deliveries, so the match end, the loudest chat moment, has none; and the
  crowd for a seed is computed per event, so a session can re-simulate after a seek without changes.

## Decisions made

- [D-044: Task 3's deferred minors become Task 4 step 4.0 (Nabhanyu)](../Decisions.md#d-044--task-3s-deferred-minors-become-task-4-step-40-2026-10-16-before-t4-nabhanyu)
- [D-045: Detectors are stateless; the gate keeps the session's memory](../Decisions.md#d-045--detectors-are-stateless-the-gate-keeps-the-sessions-memory-2026-10-16-t4-claude)
- [D-046: The ball that decides the match always gets a teaser (Nabhanyu)](../Decisions.md#d-046--the-ball-that-decides-the-match-always-gets-a-teaser-2026-10-16-t4-nabhanyu)
- [D-047: The synthetic crowd: authored corpus, rates as data, seeded per event](../Decisions.md#d-047--the-synthetic-crowd-authored-corpus-rates-as-data-seeded-per-event-2026-10-16-t4-claude)
- [D-048: Quest rules settle from deliveries, as early as the outcome is certain](../Decisions.md#d-048--quest-rules-settle-from-deliveries-as-early-as-the-outcome-is-certain-2026-10-16-t4-claude)
- [D-049: Smaller Task 4 choices](../Decisions.md#d-049--smaller-task-4-choices-2026-10-16-t4-claude)
- Constraints 2, 6 and 11 gained a sentence each (synthetic content is labelled, seeded randomness
  comes from `util/prng.ts`, a shared key's prompt carries only shared facts).

## Verification (paste real output)

```text
pnpm verify                     (branch head before the merge)
packages/engine typecheck: Done
apps/server typecheck: Done
apps/web typecheck: Done
Checked 113 files in 372ms. No fixes applied.
 Test Files  25 passed (25)
      Tests  337 passed (337)
check-no-hardcode: OK (51 source files, 209 terms)
verify-data: OK (2 matches)
✓ built in 641ms

pnpm test:e2e
  8 passed (18.8s)

node scripts/build-models.ts --zip <t20s_male_json.zip>     (step 4.0, sha256 95305bc2…860a)
build-models: 370 filtered, 2 demo, 162 rejected by the engine, 3,093 used (train 2,486, test 607)
build-models: nudgeThreshold 0.18437096987916934 over 134,049 test-split legal balls
(winprob-v1.json, priors-1298150.json, priors-1415755.json byte-identical; README.md regenerated)

python3 -I scripts/oracle/audit/mutate.py <scratch copy of the branch>
mutate: 18 killed, 0 survived

hand mutants of the Task 4 code (48, scratch copy): 47 killed, 1 survived (equivalent in practice)

engine-report vs oracle (compare.py)
IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 11 bowler lines, 14 wickets, 22 fantasy players   (1298150)
IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 12 bowler lines, 15 wickets, 22 fantasy players   (1415755)
```

## Follow-ups (out of scope, noted for later)

1. **Task 5, crowd seed (decision needed):** the PLAN seeds each session's crowd with the session id,
   but room keys are shared per match and over, so a cached room read would cite another session's
   message ids. Recommended: seed per match (`seedFrom(matchId)`), which also matches a real
   watch-along room (D-047).
2. **Tasks 5 and 8, shared keys:** `BailoutFacts.projection` and `CatchUpFacts.squadImpact` are
   per-session; keep them out of the shared prompts and render them beside the AI text (Constraint
   11, D-045). `NudgeFacts.why` and `outcome` are reveal-only; the spoiler linter could also reject
   phrases such as "decides it" for `match_decided` teasers.
3. **Task 5:** a detector that throws is a bug the gate does not swallow; the tick loop should catch
   per session, log, and keep the other sessions running.
4. **Task 8:** consider a post-match room read (the match end has no delivery after it).
5. `pnpm check:data` could validate `data/crowd/corpus.json` and every persona's join point; today the
   unit tests do.
6. The auditor's toolkit could gain the holdout detectors script used in this audit (described in the
   audit notes), committed in an audit commit.
7. The first-innings model's overconfidence (F03 follow-up 3) also inflates early leverage; Task 4
   consumes the model as is.

## Audit notes (filled by the auditor)

**Audit, 2026-10-16, Claude, on the branch head. Verdict: accepted; merged `--no-ff`, tagged
`t04-verified`.** Caveat first: Codex was unavailable, so the same agent implemented and audited this
task (as with Task 3). Every check below ran on real output; an independent re-audit (Codex, or a
fresh Claude session) can repeat them with the commands in TEST_CHECKLIST §2 and this file.

- **Verification (fresh runs):** `pnpm install --frozen-lockfile`; `pnpm verify` → 3× `typecheck:
  Done`, `Checked 113 files … No fixes applied.`, `Test Files  25 passed (25)`, `Tests  337 passed
  (337)`, `check-no-hardcode: OK (51 source files, 209 terms)`, `verify-data: OK (2 matches)`, built;
  `pnpm test:e2e` → `8 passed`.
- **Read-only files:** since `t03-verified`, `packages/engine/test/golden` and `scripts/oracle` are
  unchanged; in `data/models` only `README.md` changed, regenerated by `scripts/build-models.ts` from
  the recorded zip for step 4.0 (D-044), with the three JSON files byte-identical.
- **Anti-hardcoding (§2A):** scan OK; no `hardcode-ok`; no `.skip`/`.only`; no deleted lines in
  pre-existing tests. Literals in the new source are rule or format constants (10 runs, 36 balls,
  18-ball quests, the 16th over, 120 balls, 10 wickets, a five-minute window, mulberry32's own
  constants); labels such as "18.5" appear only in comments. Detectors read the persona, players,
  rules, model and priors from `DetectorContext`, and the corpus names no player, team or code.
- **Engine vs oracle (§2B):** both demo matches IDENTICAL (`compare.py`).
- **Holdout (§2C):** the World Cup archive sweep (`run_sweep.sh`, zip sha256 `df5e2fa7…`): `199
  IDENTICAL`, `31 ENGINE_REJECTS` (the BUG-002 reasons, unchanged), `check_spec.py` `TOTAL mismatches:
  0` (51 categories), the same as at `t02-verified` and `t03-verified`.
  Detectors on two World Cup matches never looked at before (fixtures from `gen_fixtures.py`, a
  synthetic pre-match persona with the innings' first strikers as captain and vice-captain,
  audit-only priors, the simulated crowd, all four detectors through `createGate`):
  - 951373 (2016 final, England v West Indies, won by four sixes in the last over): Roy (C) out on
    ball 2 and Charles (VC) on the chase's ball 7 raise bailouts; 28 teasers, the last
    `match_decided` on Brathwaite's fourth six (19.4); the eight biggest |WP swings| (19.2 0.579,
    19.3 0.251, 1.1 −0.141, 19.1 0.134, …) all have teasers; 10 over-end room reads plus spikes at
    13.4 and 19.2; gate 218 of 255 deterministic (0.855).
  - 951353 (India v Bangladesh 2016, won by one run): no bailout, correctly (Rohit made 18, Tamim
    35); 30 teasers, the last `match_decided` on the final-ball run out (19.6, −0.692, the match's
    biggest swing); the eight biggest swings all have teasers; gate 213 of 252 (0.845).
  - Catch-up after 14 overs of each chase: 86/4 needing 70 off 36 (rrr 11.67) and 99/5 needing 48 off
    36 (rrr 8), each with one anomalous over and swings from the window.
- **Test quality (§2D):** `mutate.py` on a scratch copy → `18 killed, 0 survived`. 48 hand mutants of
  the new code (`handmut.py`-style runner in a scratch copy: clocks, buffer, commentary tags, join
  points, every detector's constants and branches, gate dedupe/counters/clock, quest positions,
  dots and closures, crowd seeding, sampling and labels, PRNG): **47 killed**. The survivor flips
  `position <= questTo` to `<` inside collapse's history replay, which only matters for a third
  qualifying dismissal in one innings; a T20 captain and vice-captain bat once each, so it cannot
  occur (equivalent in practice). Expected values throughout come from the raw file, DOMAIN, the
  oracle's golden file or independent Python re-derivations, never from engine output.
- **Task 4 hooks:** detectors on the holdouts (above); triggers land on cheap captain dismissals and
  the biggest swings, not on demo labels; the corpus was read line by line (303 lines): no real
  names, nothing offensive, no gendered pronouns for players, Hindi lines checked.
- **Shortcut review:** no test weakened, skipped or deleted; no golden or oracle edit; no logic keyed
  to labels, seq numbers or ids; the gate test's two fake detectors test the gate, not themselves;
  the crowd is authored synthetic content, labelled, and not presented as AI output.
- **Security (§2F, as far as it applies):** `.env` untracked, mode 600, untouched; nothing
  secret-shaped in the diff.
- **Open for Task 5 (not a defect of Task 4):** the crowd seed (D-047, F04 follow-up 1) and keeping
  per-session facts out of shared prompts (D-045, Constraint 11).
