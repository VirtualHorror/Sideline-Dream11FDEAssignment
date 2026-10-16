# BUG-002: `buildTimeline` rejects some valid Cricsheet matches

- **Found:** 2026-10-16, Claude, Task 2 audit (archive sweep, `scripts/oracle/audit/run_sweep.sh`)
- **Severity:** minor for the product (both demo matches are unaffected); major for Task 3 if unhandled
- **Status:** open. Task 3 excludes and counts these (PLAN Task 3 build-script rules); engine support
  is a backlog follow-up (F02 follow-ups).

## Symptom
31 of the 230 matches in `icc_mens_t20_world_cup_male_json.zip` (retrieved 2026-10-16) throw in
`buildTimeline`/`applyEvent`. The failure is loud (an error naming the cause), never a wrong number.

| Reason | Matches | Where it throws | Task 3 filter |
| --- | --- | --- | --- |
| not exactly two innings (no result, super over) | 4 | `CricsheetMatchSchema` (`innings` length 2) | excluded by its rules |
| `innings[1].target` missing (2014 files) | 13 | `timeline.ts`: "chasing innings is missing its Cricsheet target" | excluded (`target.overs == 20` fails) |
| fractional target overs, e.g. `14.3` (all DLS) | 4 | `target.overs * 6` is not an integer → `InningsStartEventSchema` | excluded (`outcome.method`) |
| bowler changed mid-over (injury) | 8 | `reducer.ts` `currentOver`: "over N contains more than one bowler" | **passes the filter** |
| a team lists 12 players (replacement) | 1 | `PlayingXIEventSchema` (exactly 11) | **passes the filter** |
| an over with seven legal balls (umpire miscount) | 1 | `DeliveryEventSchema` (`ballInOver` ≤ 6, label regex) | excluded (7-over chase) |

Rejected ids: 1415703 1415706 1415711 951319 · 682921 682923 682927 682929 682931 682935 682939
682941 682943 682947 682949 682951 682955 · 1298154 1415744 682911 682925 · 1273722 1273740 1298140
1298153 1298179 1415710 1512737 1512748 · 1298163 · 1298152.

**In Task 3's archive** (`t20s_male_json.zip`, 3,627 matches, 14.5 MB, sha256
`95305bc2dae8dcce7b8da7755f3992521874b14598ea5828129f37834e8b860a`, retrieved 2026-10-16): 3,255
matches pass Task 3's filters. Running the real engine on them with PLAN-style synthesized fixtures
(all `BAT`, credits 8, `notes: []`) accepts **3,093** and rejects **162**:

| Reason | Matches | Where it throws |
| --- | --- | --- |
| bowler changed mid-over | 98 | `reducer.ts`: "over N contains more than one bowler" |
| an over with more than six legal balls | 31 | `DeliveryEventSchema` (`ballInOver` ≤ 6) |
| a team lists more than 11 players | 12 | `PlayingXIEventSchema` (exactly 11) |
| a fielder entry without a `name` | 12 | `CricsheetMatchSchema` (`fielders[].name` required) |
| wicket kind `retired not out` | 5 | `WicketKindSchema` (not in the enum) |
| a team lists fewer than 11 players | 4 | `PlayersFileSchema` (≥ 22 players) for the synthesized fixture |

`retired not out` matters again when the engine supports it: the oracle's `NOT_BOWLER_WICKETS` lacks it, so
the oracle would wrongly credit the bowler and count a team wicket.

## Expected
The demo matches never hit these. For archive use the engine must either support the case or the
caller must exclude the match with a recorded reason, never silently.

## Root causes
- Task 1 contracts (Claude): `InningsNumber` is 1 | 2, `ballInOver` is 1..6, `OverSummary` has one
  `bowlerId`, a playing XI is exactly 11.
- Task 2 spec (Claude, PLAN): the target comes only from `innings[1].target`, and
  `balls = target.overs · 6` reads Cricsheet's `overs.balls` notation as a decimal (14.3 means
  14 overs and 3 balls, 87 balls; the formula gives 85.8). Codex implemented the spec as written.

## Fix
- Now (Task 3): the archive loader catches the error, excludes the match and lists it with its
  reason; `data/models/README.md` reports counts per reason; a rejected match does not count as a
  player appearance for priors.
- Later (backlog; Decisions entry and tests first): derive the target as first-innings runs + 1 when
  absent; convert `overs.balls` notation to balls; give each bowler of a split over its own
  `OverSummary` (a maiden only for one bowler's complete six-ball over, as the oracle counts it);
  accept nameless fielders (no fielding credit) and `retired not out` (not a team or bowler wicket;
  fix the oracle's list in the same change). 12-player lists and seven-ball overs stay rejected.

## Verification
`run_sweep.sh` prints the rejections by reason; the table above is the `t02-verified` baseline.
