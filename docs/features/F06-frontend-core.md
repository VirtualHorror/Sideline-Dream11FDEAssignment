# F06: Frontend I (effects, landing, match room, phases 3-4 UI, control plane, `/architecture`)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 06 in `docs/PLAN.md`
- **Branch:** `task/06-frontend-core`
- **Owner / session:** Claude, implementing in place of Codex at Nabhanyu's request, then auditing, 2026-10-17
- **Status:** in progress

## Scope

The first screen people see. A landing page with the floodlight hero, the ghost-text wordmark and a
persona picker; a match room where the fan's TV pane (folded on their own delayed TV clock), the
companion (held spoilers, catch-up reels, the explainer, the simulated watch-along chat) and the
control plane drawer run against the real Task 5 server; the four reference effects with their
fallbacks; and the shareable `/architecture` page rendered from the repository's docs. Before any of
it, an independent spot-check of `t05-verified` (Nabhanyu's request). Not in scope: phases 1-2 cards,
room read, the inspector, story mode and the `/architecture` diagram (Task 9), deployment (Task 7).

## Plan steps

- [x] 6.0 Spot-check of `t05-verified` (Nabhanyu, before 6.1) and its four test gaps pinned.
- [ ] 6.1 Store and TV clock.
- [ ] 6.2 `SpoilerCard`.
- [ ] 6.3 Effects and their fallbacks; `GlowInput` `data-state`.
- [ ] 6.4 `InningsDotMatrix`, tabular `Scorebug`.
- [ ] 6.5 Control plane.
- [ ] 6.6 E2E `e2e/match-room.spec.ts`.
- [ ] 6.6b `/architecture`.
- [ ] 6.7 `pnpm verify` + `pnpm test:e2e` green; docs.

## Log (newest last)

- 2026-10-17: Independent spot-check of the Task 5 merge (`t05-verified`, implemented and audited by
  the same agent in the previous session), in a fresh session on `main` (`d217b96`):
  - `pnpm install --frozen-lockfile && pnpm verify`: 37 files / 492 tests, `check-no-hardcode: OK
    (86 source files, 209 terms)`, `verify-data: OK (2 matches)`, built; `pnpm test:e2e` 8 passed.
    `t05-verified` is the `--no-ff` merge `a4b71cd` (parents `703b892`, `a2d30d5`).
  - Since `t04-verified`, `packages/engine/test/golden`, `scripts/oracle`, `data/models` and `data/raw`
    are unchanged; the engine changed only by the two `AICallTrace` fields (D-053) and the
    `situationOf` export. No `.skip`/`.only`, no `hardcode-ok`, no label, seq or id comparison in
    server source; the only golden-number hits are the teaser's 160-character schema cap.
  - `engine-report` vs the oracle (`compare.py`): IDENTICAL on both matches.
    `python3 -I scripts/oracle/audit/mutate.py <scratch copy>`: `18 killed, 0 survived`.
  - The server run keyless on a spare port and watched with `curl -N`: health (`aiProvider: 'none'`),
    `/api/matches` (two matches, personas' public fields), a late-from-work session with a 25 s delay
    jumped to 18 overs of the chase at 16x: `hello` (replay mode, the persona with its squad), a
    `snapshot` of 249 events with the join point's catch-up reel, the 14-18 reel as a `moment`, then
    18.1-18.5 as deterministic events and the 18.6 teaser as a labelled fallback with `nudgeAt` =
    ball − 6 s and `budgetMs` 1177 (in time), the 19.1 teaser likewise, telemetry every 5 s. Every
    shape matched HANDOFF7's "Code Context".
  - 21 fresh hand mutants of the Task 5 server code (scratch copy; the parts Task 6 builds on:
    snapshot contents, chat and event release, sent marks across jumps, teaser budget and timing,
    catch-up and answer timing, the end-of-match clock, telemetry counters, SSE ids, the ask limits and
    the 409, the matches route, the control route's 400): **17 killed, 4 survived**, all test gaps
    rather than defects: (1) a jump back then playing forward must stream the held teasers again
    (`sent.clear()` removed passes every test: the only jump test jumps forward again, and a snapshot
    re-sends regardless); (2) chat sent one second ahead of the clock passes (no test bounds a tick's
    chat by the clock); (3) stopping the clock at the last event, before the crowd's last 17 reactions,
    passes (the end test jumps 120 s past both); (4) `/ask` on a stopped session answering normally
    passes (the 409 was untested).
  - Verdict: `t05-verified` stands. The four gaps are pinned by tests in `sessions.test.ts` and
    `routes.test.ts` (D-059), each failing on its mutant and passing on the code as merged.

## What worked / what did not

## Decisions made

- [D-059: Spot-check of `t05-verified`](../Decisions.md#d-059--spot-check-of-t05-verified-accepted-four-test-gaps-pinned-in-task-6-2026-10-17-before-t6-claude)

## Verification (paste real output)

```text
```

## Follow-ups (out of scope, noted for later)

## Audit notes (filled by the auditor)
