# BUG-001: the oracle awards fantasy points to substitute fielders outside the playing XI

- **Found:** 2026-10-16, Claude, Task 2 audit (archive sweep, `scripts/oracle/audit/run_sweep.sh`)
- **Severity:** minor (no effect on the committed matches or the golden files)
- **Status:** fixed in the oracle on 2026-10-16, after `t02-verified`, with Nabhanyu's approval (D-038)

## Symptom
In 22 of the 199 T20 World Cup archive matches the engine accepts, the oracle's `fantasy` output had
an extra entry for a player who is in neither `info.players` list: a substitute fielder credited with
a catch or a run out. Examples: `1298157` → `73ad96ed` `{ total: 16, breakdown: { catch: 16 } }`;
`1273748` → `752f7486` `{ total: 12, breakdown: { runOutDirect: 12 } }`. The engine had no entry for
them. Every other number (scorecards, fall of wickets, fielding, every XI player's points) matched.

## Expected
`docs/DOMAIN.md` §3: "A player who is not in the announced playing XI scores nothing." The engine
follows it: `packages/engine/src/fantasy/scoring.ts` creates entries only for `state.playingXI` and
`add` ignores any other id. The oracle's `fantasy()` created entries on demand
(`score.setdefault(...)`) for anyone credited with an action, so substitutes scored. Dream11's
published guidance agrees with DOMAIN: substitute fielders get no points for catches or run-outs
(concussion substitutes are a separate rule that neither side models).

## Reproduction
Before the fix: `scripts/oracle/audit/run_sweep.sh <raw-dir> <work-dir>` on
`icc_mens_t20_world_cup_male_json.zip` listed the 22 oracle-only entries. Neither committed match has
a substitute with a fielding credit, which is why the golden tests never saw it.

## Investigation log (newest last)
- 2026-10-16: checked all 22 entries. Each id is absent from both XIs and appears in the Cricsheet
  file only as a `fielders[]` entry with `"substitute": true`. No other engine/oracle difference.
- 2026-10-16: Nabhanyu chose to fix the oracle rather than change DOMAIN.md (option A).
- 2026-10-16: while verifying the fix, found that the oracle's output is not byte-stable even
  before the change. `fantasy` keys follow iteration over a Python `set`, and string hashing is
  randomised per process, so the key order changes between runs. The data is the same, so outputs
  and golden files are compared as data (`json.load` equality); engine tests already do that.

## Fix
`scripts/oracle/cricsheet_oracle.py`, `fantasy()` → `add()`: return early when the player is not in
either announced XI (`if value == 0 or pid not in xi`), and look the entry up directly instead of
creating it. The docstring's definitions gained the matching line. The oracle is the layer to fix
because DOMAIN.md is the source of truth and the engine already follows it. The auditor's
comparator (`scripts/oracle/audit/compare.py`) no longer excuses these entries.

## Verification
- Fixed oracle vs the golden files, compared as data: equal for 1298150 and 1415755. The golden files
  are unchanged.
- `1298157` / `73ad96ed`: before `{'total': 16, 'breakdown': {'catch': 16}}`, after: no entry.
- Strict sweep (`run_sweep.sh`, no allowance): `199 IDENTICAL`, `31 ENGINE_REJECTS` (BUG-002),
  `check_spec.py` `TOTAL mismatches: 0`.
- `pnpm verify` green (106 tests).
