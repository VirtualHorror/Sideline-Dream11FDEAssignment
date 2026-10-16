# Bug / Feature register

One row per feature (task) and per bug, with its status and where the detail lives. Feature
detail is in `docs/features/FNN-*.md`, bug detail in `docs/bugs/BUG-NNN-*.md`. Every task and every
audit updates this page.

## Features

| Id | Feature | Status | Record |
| --- | --- | --- | --- |
| F01 | Foundation: toolchain, monorepo, contracts, real data, guards, oracle, docs, shell | audited, `t01-verified` | [F01](features/F01-foundation.md) |
| F02 | Cricket core: Cricsheet timeline, reducer, fantasy scoring, engine report CLI | audited and merged, `t02-verified` | [F02](features/F02-cricket-core.md) |
| F03 | Models: T20I archive pipeline, win probability, leverage threshold, player priors | audited and merged, `t03-verified` | [F03](features/F03-models.md) |
| F04 | Moments engine: clocks, delay buffer, commentary lines, phase detectors (lineup, collapse, nudge with the match-deciding ball, room), catch-up facts, entropy gate, quest resolver, synthetic crowd; Task 3 carry-overs (step 4.0) | audited and merged, `t04-verified` | [F04](features/F04-moments-engine.md) |

## Bugs

| Id | Summary | Severity | Status |
| --- | --- | --- | --- |
| [BUG-001](bugs/BUG-001-oracle-scores-substitute-fielders.md) | The oracle gave fantasy points to substitute fielders outside the playing XI. DOMAIN §3 says they score nothing, and the engine follows DOMAIN. | minor | fixed in the oracle (D-038) |
| [BUG-002](bugs/BUG-002-engine-rejects-cricsheet-edge-cases.md) | `buildTimeline` rejects some valid Cricsheet files: 31 of 230 in the World Cup archive, and 162 of the 3,255 T20Is that pass Task 3's filters (mid-over bowler change, seven-ball over, XI not 11, nameless fielder, `retired not out`) | minor for the product, major for Task 3 if unhandled | open: Task 3 excludes and counts them (162 of 3,255, by reason in `data/models/README.md`); engine support is backlog |
| [BUG-003](bugs/BUG-003-leverage-misses-two-planned-climax-balls.md) | PLAN 3.4 expected 1298150's 18.5 six and winning single to be big balls; the specified model scores them 0.093 and 0.019 against a 0.184 threshold (the 19.6 wide before the single carries the swing) | major for Task 3 acceptance | resolved by amending the plan (D-043, Nabhanyu); nothing tuned |

Fixed while Task 2 was being implemented (logged in F02, no bug file):
- The result text used Cricsheet's team name instead of the authored display name. A regression test now covers it.
- The test fixture helper had a malformed template literal.
- A live-scoring test selected the wrong delivery.

Fixed while Task 3 was being implemented (logged in F03, no bug file):
- A winner without a margin read "X won by the match"; it now reads "X won" (F02 follow-up 7, test first).

Fixed in Task 4 step 4.0 (logged in F04, no bug file):
- `projectedPoints` took an inherited name (`toString`, `constructor`) for a priors entry and failed
  with a TypeError instead of "no priors for player" (test first).
- Two Task 3 behaviours were untested (a diagonal-only Hessian and leverage counting retired hurt as a
  wicket would both have passed); tests now pin them.
