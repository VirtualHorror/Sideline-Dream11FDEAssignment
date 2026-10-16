# BUG-001: the oracle awards fantasy points to substitute fielders outside the playing XI

- **Found:** 2026-10-16, Claude, Task 2 audit (archive sweep, `scripts/oracle/audit/run_sweep.sh`)
- **Severity:** minor (no effect on the committed matches or the golden files)
- **Status:** open. Needs Nabhanyu's decision: fix the oracle (proposed below) or change DOMAIN.md.

## Symptom
In 22 of the 199 T20 World Cup archive matches the engine accepts, the oracle's `fantasy` output has
an extra entry for a player who is in neither `info.players` list: a substitute fielder credited with
a catch or a run out. Examples: `1298157` → `73ad96ed` `{ total: 16, breakdown: { catch: 16 } }`;
`1273748` → `752f7486` `{ total: 12, breakdown: { runOutDirect: 12 } }`. The engine has no entry for
them. Every other number (scorecards, fall of wickets, fielding, every XI player's points) matches.

## Expected
`docs/DOMAIN.md` §3: "A player who is not in the announced playing XI scores nothing." The engine
follows it: `packages/engine/src/fantasy/scoring.ts` creates entries only for `state.playingXI` and
`add` ignores any other id. The oracle's `fantasy()` creates entries on demand
(`score.setdefault(...)`) for anyone credited with an action, so substitutes score.

## Reproduction
`scripts/oracle/audit/run_sweep.sh <raw-dir> <work-dir>` on `icc_mens_t20_world_cup_male_json.zip`;
`compare.py` lists them as "oracle-only non-XI fantasy entries (BUG-001)". Neither committed match has
a substitute with a fielding credit, which is why the golden tests never saw it.

## Investigation log (newest last)
- 2026-10-16: checked all 22 entries. Each id is absent from both XIs and appears in the Cricsheet
  file only as a `fielders[]` entry with `"substitute": true`. No other engine/oracle difference.

## Fix (proposed, not applied)
In the oracle's `fantasy()`, make `add()` skip ids that are not in the XI. That aligns it with
DOMAIN.md, and re-running it on both committed matches leaves the golden output byte-identical.
CLAUDE.md allows oracle changes only when the rules change, with an explicit note, so the fix
waits for the owner's decision. If DOMAIN.md is changed instead (substitutes score), the engine
changes and the golden files stay as they are.

## Verification
After either fix: `run_sweep.sh` reports no BUG-001 entries; `pnpm verify` unchanged.
