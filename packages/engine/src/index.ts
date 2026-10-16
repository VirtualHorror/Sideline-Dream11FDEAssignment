/**
 * @sideline/engine public API.
 *
 * Everything here is pure and isomorphic (Node + browser): no I/O, no clocks, no
 * randomness without an explicit seed. The server and the web client import the
 * same functions, so a delivery folds to the same state on both sides.
 *
 * Module map (filled in task by task, see docs/PLAN.md):
 *   contracts/  zod schemas + types shared across packages              (Task 1)
 *   cricket/    Cricsheet schema, timing model, timeline, reducer, format (Task 2; describe Task 4)
 *   fantasy/    squad validation (Task 1), points scoring (Task 2)
 *   util/       FNV-1a hash (Task 2), seeded PRNG (Task 4)
 *   models/     win probability, leverage, player priors and projections (Task 3)
 *   detectors/, gate/, quests/  phase detectors and the entropy gate     (Task 4)
 *   crowd/      seeded synthetic watch-along chat                       (Task 4)
 *   buffer/, clock.ts  TV clock and per-fan delay buffer (spoiler shield) (Task 4)
 */
export * from "./contracts/index.ts";
export * from "./cricket/cricsheet.ts";
export * from "./cricket/format.ts";
export * from "./cricket/reducer.ts";
export * from "./cricket/timeline.ts";
export * from "./cricket/timing.ts";
export * from "./fantasy/scoring.ts";
export * from "./fantasy/squad.ts";
export * from "./models/leverage.ts";
export * from "./models/logistic.ts";
export * from "./models/priors.ts";
export * from "./models/winprob.ts";
export * from "./util/hash.ts";
