# F05: Server runtime, AI gateway, first skills (sessions, SSE, gateway, teaser, catch-up, explainer)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 05 in `docs/PLAN.md`
- **Branch:** `task/05-server-ai`
- **Owner / session:** Claude, implementing in place of Codex at Nabhanyu's request, then auditing, 2026-10-16
- **Status:** in progress

## Scope

The first real backend: per-browser match sessions with their own clocks, streamed over SSE by one
global ticker; the provider-agnostic AI gateway (in-flight dedupe, moment-keyed cache, budget,
timeout, zod validation, guards, labelled fallbacks, one trace per attempt); the orchestrator that
turns the engine's triggers into moments; the first three skills (spoiler teaser, catch-up,
explainer); telemetry with the scale projection; SQLite for the AI cache, the traces and the
analytics tables; `scripts/ai-smoke.ts`. Everything is testable without a key (scripted provider,
injected clock). No UI (Task 6), no lineup/bailout/room skills (Task 8), no replay recording
(Task 7). Before any of it, an independent spot-check of `t04-verified` (Nabhanyu's request).

## Plan steps

- [ ] Spot-check of `t04-verified` (Nabhanyu, before 5.0) and its two test gaps pinned.
- [ ] 5.0 `config.test.ts` (extend).
- [ ] 5.1 `bundle.test.ts`.
- [ ] 5.2 `sessions.test.ts`.
- [ ] 5.3 `stream.test.ts`.
- [ ] 5.4 `gateway.test.ts`.
- [ ] 5.5 `skills.test.ts`.
- [ ] 5.6 `orchestrator.test.ts`.
- [ ] 5.7 `routes.test.ts`.
- [ ] 5.8 `telemetry.test.ts`.
- [ ] 5.9 `scripts/ai-smoke.ts`.
- [ ] 5.10 `pnpm verify` green; docs.

## Log (newest last)

- 2026-10-16: Independent spot-check of the Task 4 merge (`t04-verified`, implemented and audited
  by the same agent in the previous session), in a fresh session on `main` (`703b892`):
  - `pnpm install --frozen-lockfile && pnpm verify`: 25 files / 337 tests, `check-no-hardcode: OK
    (51 source files, 209 terms)`, `verify-data: OK (2 matches)`, built; `pnpm test:e2e` 8 passed.
    `t04-verified` is the `--no-ff` merge `557ff2b` (parents `5508a12`, `6e7e592`).
  - Since `t03-verified`, `packages/engine/test/golden`, `scripts/oracle` and `data/raw` are
    unchanged; in `data/models` only `README.md` changed (D-044). No `.skip`/`.only`, no
    `hardcode-ok`, no label or seq comparisons in engine source.
  - `engine-report` vs the oracle (`compare.py`): IDENTICAL on both matches.
    `python3 -I scripts/oracle/audit/mutate.py <scratch copy at t04-verified>`: `18 killed, 0 survived`.
  - A stdlib-only Python re-derivation from the PLAN's formulas, the raw Cricsheet files and the
    model JSON (no engine code): 22 big balls + the deciding ball (19.6, 0.0193) = **23 teasers** in
    1298150; 24 + the deciding ball (19.6, 0.0003) = **25** in 1415755; late-from-work's catch-up
    **90/4, 70 off 36, rrr 11.67**, over 11 the only anomaly (20 runs, **z 3.04**), first innings 159/8.
    Every Task 4 claim checked holds.
  - Holdouts nobody had run the detectors on (World Cup archive, sha256 `df5e2fa7…`), with
    `gen_fixtures.py` fixtures, a synthetic pre-match persona (C = innings 1's first striker, VC =
    innings 2's), audit-only priors and the simulated crowd, every event through `createGate` with all
    four detectors:
    - 1298158 (Zimbabwe v Pakistan 2022, won by 1 run): the engine's teaser set equals the Python
      re-derivation exactly (23 big balls, the deciding 19.6 among them, `match_decided`); all 8
      biggest |WP swings| have teasers; no bailout, correctly (the C made 17, the VC 14); gate 230 of
      261 deterministic (0.881).
    - 1512763 (Pakistan v England 2026, won by 2 wickets): teaser sets equal (19 big balls + the
      deciding 19.1 at 0.0627, `match_decided`); all 8 biggest swings have teasers; one bailout, for
      the VC out for 0 off 1 at 0.1 of the chase (the C made 63); gate 224 of 252 (0.889).
  - 18 fresh hand mutants of Task 4 code (scratch copy: clocks, buffer, nudge threshold, room
    constants and filter, collapse, catch-up SD and missed balls, join point, gate counters and dedupe,
    PRNG, quest settling, free-hit tag): **16 killed, 2 survived**, both test gaps rather than bugs:
    the room detector's ten-minute history minimum (`MIN_HISTORY_MINUTES` 10 → 5 passes every test:
    the only spike test has exactly ten minutes of history) and the early settling of an at-most dots
    quest when `dots + remaining` equals the value exactly (`<=` → `<` passes).
  - Verdict: `t04-verified` stands. The two gaps are pinned here by tests (D-051), each of which fails
    on its mutant (`MIN_HISTORY_MINUTES = 9`, `<`) and passes on the code as merged.
- 2026-10-16: Nabhanyu approved the crowd-seed recommendation from D-047/F04 follow-up 1: one crowd
  per match, seeded with the match id, so every fan shares the watch-along room and a cached room read
  cites messages every fan has (D-050; the PLAN's sessions rule carries the amendment note).

## What worked / what did not

## Decisions made

## Verification (paste real output)

## Follow-ups (out of scope, noted for later)

## Audit notes (filled by the auditor)
