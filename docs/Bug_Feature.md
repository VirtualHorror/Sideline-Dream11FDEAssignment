# Bug / Feature register

One row per feature (task) and per bug, with its status and where the detail lives. Feature
detail is in `docs/features/FNN-*.md`, bug detail in `docs/bugs/BUG-NNN-*.md`. Every task and every
audit updates this page.

## Features

| Id | Feature | Status | Record |
| --- | --- | --- | --- |
| F01 | Foundation: toolchain, monorepo, contracts, real data, guards, oracle, docs, shell | audited, `t01-verified` | [F01](features/F01-foundation.md) |
| F02 | Cricket core: Cricsheet timeline, reducer, fantasy scoring, engine report CLI | audited and merged, `t02-verified` | [F02](features/F02-cricket-core.md) |

## Bugs

| Id | Summary | Severity | Status |
| --- | --- | --- | --- |
| [BUG-001](bugs/BUG-001-oracle-scores-substitute-fielders.md) | The oracle gave fantasy points to substitute fielders outside the playing XI. DOMAIN §3 says they score nothing, and the engine follows DOMAIN. | minor | fixed in the oracle (D-038) |
| [BUG-002](bugs/BUG-002-engine-rejects-cricsheet-edge-cases.md) | `buildTimeline` rejects some valid Cricsheet files: 31 of 230 in the World Cup archive, and 162 of the 3,255 T20Is that pass Task 3's filters (mid-over bowler change, seven-ball over, XI not 11, nameless fielder, `retired not out`) | minor for the product, major for Task 3 if unhandled | open: Task 3 excludes and counts; engine support is backlog |

Fixed while Task 2 was being implemented (logged in F02, no bug file):
- The result text used Cricsheet's team name instead of the authored display name. A regression test now covers it.
- The test fixture helper had a malformed template literal.
- A live-scoring test selected the wrong delivery.
