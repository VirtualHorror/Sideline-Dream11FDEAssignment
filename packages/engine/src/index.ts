/**
 * @sideline/engine public API.
 *
 * Everything here is pure and isomorphic (Node + browser): no I/O, no clocks, no
 * randomness without an explicit seed. The server and the web client import the
 * same functions, so a delivery folds to the same state on both sides.
 *
 * Module map (filled in task by task, see docs/PLAN.md):
 *   contracts/  zod schemas + types shared across packages        (Task 1)
 *   fantasy/    squad validation, scoring, projections            (Task 1 squad, Task 3 rest)
 *   cricket/    Cricsheet normalizer, timeline, reducer, stats    (Task 2)
 *   models/     win probability and leverage                      (Task 3)
 *   detectors/  phase detectors and the entropy gate              (Task 3)
 *   crowd/      seeded synthetic watch-along chat                 (Task 3)
 *   buffer/     per-fan delay buffer (spoiler shield)             (Task 3)
 */
export * from "./contracts/index.ts";
export * from "./fantasy/squad.ts";
