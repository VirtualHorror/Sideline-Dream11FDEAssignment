# Handoff: Task 5, server runtime, AI gateway and first skills (sessions, SSE, gateway, teaser, catch-up, explainer)

**Generated**: 2026-10-16 23:15 IST (by Claude Code, which implemented Task 4 in Codex's place and then audited it)
**Branch**: `main`, clean (this file is committed on top of `557ff2b`). Task 4 is merged and tagged `t04-verified` (`557ff2b`). Create `task/05-server-ai` from `main`.
**Status**: Ready for implementation (Task 4 done and verified; Task 5 not started)

## Goal

Sideline is an AI second-screen companion for live cricket (Dream11 FDE intern assignment by
Nabhanyu). Implement **Task 5 only** from `docs/PLAN.md`: per-browser sessions streamed over SSE with
one global ticker, the provider-agnostic AI gateway (dedupe, cache, budget, timeout, zod, guard,
fallback, one trace per call), the orchestrator that turns the engine's triggers into moments, and the
first three skills (spoiler teaser, catch-up, explainer), all testable without a key. Everything lives
in `apps/server` (plus `data/glossary.json` and `scripts/ai-smoke.ts`). Claude audits afterwards; you
do not merge.

## Completed

- [x] Tasks 1-3 (`t01`/`t02`/`t03-verified`). A fresh-session spot-check of `t03-verified` found it
  sound (byte-identical model rebuild, `mutate.py` 18/18, independent Python re-derivation).
- [x] Task 4, the pure moments engine (`t04-verified`; record `docs/features/F04-moments-engine.md`):
  - step 4.0 (D-044): Task 3's deferred minors (a priors lookup fix, tests for a diagonal-only Hessian
    and for retired hurt in leverage, `round2` role means, a regenerated `data/models/README.md`);
  - `clock.ts` (`stadiumAt`, `tvTimeAt`), `buffer/delay.ts` (`releaseDue`, `momentVisibility`);
  - `cricket/describe.ts` (commentary lines), `cricket/join.ts` (join points);
  - detectors: lineup, collapse, nudge (leverage ≥ threshold **or the ball that decides the match**,
    D-046), room; catch-up facts; `gate/gate.ts`; `quests/resolve.ts`; `util/prng.ts`;
    `crowd/simulate.ts` + `data/crowd/corpus.json` (303 synthetic lines).
- [x] Numbers you inherit: the full 1298150 replay for `babar-believer` handles 233 of 266 events
  deterministically (0.876) with 36 triggers (1 lineup patch, 1 bailout, 23 teasers, 11 room reads);
  23 teasers in 1298150 and 25 in 1415755, each ending on the match's last ball.

## Not Yet Done (exact rules and literals in `docs/PLAN.md` → "Task 5")

- [ ] **5.0** `config.test.ts` (extend): `OPENAI_BASE_URL`, model vars, provider precedence, `aiEndpointHost`
- [ ] **5.1** `bundle.test.ts`: `loadMatchBundles` validates both matches; events equal `buildTimeline`
- [ ] **5.2** `sessions.test.ts`: late-from-work starts at its join point; 8x releases in order; jump back/forward equals a fresh fold; TTL eviction
- [ ] **5.3** `stream.test.ts`: SSE parses as `StreamMessage`s in order; no secret in the stream
- [ ] **5.4** `gateway.test.ts`: cache hit, in-flight dedupe, each failure path → fallback + trace + counters
- [ ] **5.5** `skills.test.ts`: catch-up prompt contains `90/4`, `70`, `36`; `spoilerLint` table; glossary answer with zero provider calls; injection wrapped in `<fan_question>`
- [ ] **5.6** `orchestrator.test.ts`: two sessions at innings-2 **18.6** (D-043) → one provider call; slow call at 32x → `nudgeAt: null`, `usedMs > budgetMs`
- [ ] **5.7** `routes.test.ts`: validation 400s, 281 characters → 400, 13 asks/min → 429, unknown session → 404
- [ ] **5.8** `telemetry.test.ts`: counters = gate's + gateway's; formula with numbers; `savedPct > 99` at 10M
- [ ] **5.9** `scripts/ai-smoke.ts` (`pnpm ai:smoke`, not in `pnpm test`)
- [ ] **5.10** `pnpm verify` green; docs (F05, Flow §7-8 → BUILT, Architecture, Decisions incl. SDK versions, `.env.example`, TEST_CHECKLIST, ROLLBACK, Bug_Feature, README status)
- [ ] Write `HANDOFF7.md` per `AGENTS.md` → "Finishing", then stop

## Failed Approaches (Don't Repeat These)

- **Guessing literals.** Three Task 4 test expectations were written from memory and were wrong
  (1415755's last ball is "19.6 Hardik to Nortje, 1 run"; over 5 of the 2022 chase had one wicket; the
  golden fantasy file is keyed by player id, not name). Read every literal from the raw file, DOMAIN,
  the golden file or the PLAN, never from engine output.
- **Assuming a dramatic ball is a big ball.** A winning six with 2 needed off 2 scores leverage 0.018
  (the model already had India at 99%). Same lesson as BUG-003: expectations come from the model.
- **Measuring the room's chat rate from the session start.** The quiet pre-match half hour made the
  first ball of the match look like a spike. The rate is measured over the current innings (D-047).
  Keep feeding the room detector the session's chat as is; don't add "warm-up" logic around it.
- **Chained shell steps with side effects.** `git merge --no-ff … -F -` does not read stdin ("error:
  could not read file '-'") and the chained `git tag` still ran, tagging the wrong commit for a few
  seconds (the auditor's slip; the tag was re-created on the merge `557ff2b` before anything used it).
  Write messages to a file and check each exit code. `git rev-parse --short` takes one revision only.
- **`%` in `it.each` titles** garbles them ("80%% … %s" printed the wrong value). Keep `%` out.
- **Holding reducer state by reference** (still true): `applyEvent` mutates. Take
  `structuredClone(state)` before it when something reads `before`; trigger facts are already copies.
- **Rewording PLAN steps.** Tick only. Spec questions go in the HANDOFF (owner decisions become
  Decisions entries, as D-044 and D-046 did).

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Detectors are stateless objects; the **gate is per session** (D-045) | One `lineupDetector` etc. serves every session; history is recomputed from `events` and the persona's join point. Create one `createGate(...)` per session. |
| `DetectorInput.chat` is the session's chat (D-045) | The room detector reads `t <= event.t` and `fromYou: false` only. Pass the session's crowd. |
| The ball that decides the match always triggers a teaser (D-046, Nabhanyu) | `why: "match_decided"`; the teaser prompt must not say the next ball decides it. |
| Shared keys carry shared facts only (Constraint 11, D-045) | The catch-up prompt must leave out `CatchUpFacts.squadImpact`; the bailout prompt (Task 8) `projection`. Render them beside the AI text. The teaser prompt uses `NudgeFacts.before` only, never `outcome` or `why`. |
| Model files and priors are data in `DetectorContext` | The bundle loads `winprob-v1.json` and `priors-<id>.json`; nothing in the engine reads files. |
| Join points from events (`joinSeq`, `seqAfterOvers`, D-049) | Session start for a persona and the `jump` control's `{ kind: "over" }` target. |
| **Open: crowd seed (D-047)** | PLAN Task 5 seeds each session's crowd with the session id, but room keys are shared per over, so a cached room read (Task 8) would cite another session's message ids. Claude recommends seeding per match (`seedFrom(matchId)`, the same room for every fan). Nabhanyu to decide before Task 8; Task 5 has no room-read skill, so implement the PLAN as written unless he amends it. |

## Current State

**Working**: `main` at `557ff2b` (+ this handoff). `pnpm verify` → 3× `typecheck: Done`,
`Checked 113 files … No fixes applied.`, `Test Files  25 passed (25)`, `Tests  337 passed (337)`,
`check-no-hardcode: OK (51 source files, 209 terms)`, `verify-data: OK (2 matches)`, `✓ built`.
`pnpm test:e2e` → `8 passed`. `mutate.py` 18/18. Engine and oracle identical on both matches.

**Broken**: nothing known. **Known limits**: BUG-002 (archive rejections), the first-innings model's
overconfidence (F03), room reads only on deliveries (none after the match ends).

**Uncommitted Changes**: none. `task/04-moments-engine` still exists (merged). A local **`.env` holds a
real API key** (proxy, OpenAI-compatible, D-033): only `pnpm ai:smoke` (5.9) and the provider adapters
may use it; never open, print, copy or commit it.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/PLAN.md` (Task 5) | Authoritative spec: files, interfaces, gateway rules, adapters, pricing, budget, skills, timing, SQLite |
| `packages/engine/src/detectors/types.ts` | `MomentTrigger` and every facts type (documented: which facts are per-session, which are reveal-only) |
| `packages/engine/src/gate/gate.ts` | `createGate`; one per session; decisions + counters for telemetry |
| `packages/engine/src/detectors/catchup.ts` | `missedLegalBalls`, `buildCatchUpFacts`, `catchUpKey` (session-driven, not in the gate) |
| `packages/engine/src/cricket/join.ts` | `joinSeq` / `seqAfterOvers` for session start and `jump` |
| `packages/engine/src/clock.ts`, `src/buffer/delay.ts` | Stadium/TV time from `ClockState`; the client buffer (Task 6) |
| `packages/engine/src/crowd/simulate.ts`, `data/crowd/` | `simulateCrowd` and its corpus; prefix-stable per seed |
| `packages/engine/test/helpers/replay.ts`, `test/gate.test.ts` | The exact replay loop the session's ticker should run |
| `apps/server/src/{config,http/app,index}.ts` | Existing server: config (provider detection D-033), Hono app, boot |
| `packages/engine/src/contracts/{session,moments,telemetry,chat}.ts` | `ClockState`, `StreamMessage`, `Moment`, payload schemas, `AICallTrace`, `TelemetrySnapshot` |
| `docs/Decisions.md` D-014, D-015, D-016, D-033, D-045 to D-049 | Gateway, keys, fallbacks, providers, Task 4 design |
| `docs/features/F04-moments-engine.md` | Task 4 record, follow-ups 1-4 are for you |

## Code Context

**Task 4 exports** (`packages/engine/src/index.ts`):
```typescript
stadiumAt(clock: ClockState, nowWall: number): number          // stadiumT + max(0, now − wallAt)·speed while playing
tvTimeAt(clock: ClockState, nowWall: number): number           // max(0, stadiumAt − delayMs)
releaseDue<T extends { t: number }>(items: readonly T[], tvT: number): { released: T[]; held: T[] }
momentVisibility(moment: Pick<Moment, "revealAt" | "nudgeAt">, tvT: number): "hidden" | "teaser" | "revealed"
describeDelivery(event: DeliveryEvent, players: ReadonlyMap<string, Player>): { text: string; tags: DeliveryTag[] }
seqAfterOvers(events: readonly MatchEvent[], innings: InningsNumber, afterOvers: number): number
joinSeq(events: readonly MatchEvent[], joinAt: JoinAt): number  // -1 for pre_match
mulberry32(seed: number): () => number;  seedFrom(text: string): number

interface DetectorContext { matchId: string; players: readonly Player[]; rules: FantasyRules; persona: Persona; winprob: WinProbModel; priors: PriorsFile }
interface DetectorInput { before: MatchState; after: MatchState; event: MatchEvent; events: readonly MatchEvent[]; ctx: DetectorContext; chat?: readonly ChatMessage[] }
type DetectorVerdict = { outcome: "deterministic" | "suppressed"; reason: string } | { outcome: "ai_trigger"; reason: string; trigger: MomentTrigger }
type MomentTrigger =
  | { kind: "lineup_patch"; key: string; scope: "session"; facts: LineupFacts }
  | { kind: "bailout"; key: string; scope: "shared"; facts: BailoutFacts }
  | { kind: "spoiler_nudge"; key: string; scope: "shared"; facts: NudgeFacts }
  | { kind: "catch_up"; key: string; scope: "shared"; facts: CatchUpFacts }
  | { kind: "room_read"; key: string; scope: "shared"; facts: RoomFacts }
lineupDetector, collapseDetector, nudgeDetector, roomDetector: Detector   // names "lineup" | "collapse" | "nudge" | "room"
createGate(detectors: readonly Detector[], opts: { nowMicros: () => number }):
  { process(input: DetectorInput): { decisions: GateDecision[]; triggers: MomentTrigger[] }; counters(): GateCounters }
interface GateCounters { eventsTotal: number; eventsDeterministic: number; triggers: number; suppressed: number }
buildCatchUpFacts(input: { events: readonly MatchEvent[]; fromSeq: number; toSeq: number; ctx: DetectorContext; lens: Lens }): CatchUpFacts
catchUpKey(matchId: string, innings: InningsNumber, fromOver: number, toOver: number, lens: Lens): string
missedLegalBalls(events: readonly MatchEvent[], lastSeenSeq: number, currentSeq: number): number
resolveQuestRule(rule: QuestRule, events: readonly MatchEvent[]): "pending" | "won" | "lost"
CrowdCorpusSchema / CrowdCorpus;  simulateCrowd(input: { events; players; corpus; seed: string }): ChatMessage[]
```

**The facts a teaser may use** (`NudgeFacts`, nudge key `nudge:<match>:<eventId>`):
```typescript
facts.before   = { situation: Situation, striker: BatterFigures, nonStriker: BatterFigures, bowler: BowlerFigures, freeHit: boolean }  // teaser
facts.outcome  = { description, tags, runs, dismissed, situation, matchOver }                                                       // reveal only
facts.why      = "big_ball" | "match_decided"                                                                                       // reveal only
facts.leverage = { value, threshold, wpBefore, wpAfter, swing }
```

**Session tick per released event** (the loop the tests already use):
```typescript
const before = structuredClone(state);
applyEvent(state, event);
const { decisions, triggers } = gate.process({ before, after: state, event, events, ctx, chat });
// triggers of kinds with a Task 5 skill (spoiler_nudge) go to the orchestrator; lineup_patch,
// bailout and room_read have no skill until Task 8: keep their decisions, skip the gateway.
```

**Catch-up for a late joiner** (session creation or a return after a pause/jump):
```typescript
const toSeq = joinSeq(events, persona.joinAt);                        // late-from-work: inn 2 after 14 overs
if (missedLegalBalls(events, lastSeenSeq /* -1 for a new fan */, toSeq) >= 12) {
  const facts = buildCatchUpFacts({ events, fromSeq: lastSeenSeq + 1, toSeq, ctx, lens });
  const key = catchUpKey(ctx.matchId, facts.window.innings, facts.window.fromOver, facts.window.toOver, lens);
  // late-from-work: key "catchup:1298150:2:0-14:casual", situation 90/4, 70 off 36, rrr 11.67
  // guard (5.5): every cited id must be in facts.window.deliveryIds
}
```

## Resume Instructions

1. `cd ~/Downloads/Dream11FDEAssignment && export PATH="$HOME/.local/bin:$PATH" && node --version && pnpm --version`
   - Expected: `v24.22.0`, `10.34.7`
2. `pnpm install --frozen-lockfile && pnpm verify`
   - Expected: the "Current State" baseline (25 files / 337 tests). If anything is red, stop and report.
3. `git checkout -b task/05-server-ai`; create `docs/features/F05-server-ai.md` from `docs/features/_TEMPLATE.md`.
4. Add `@anthropic-ai/sdk` and `openai` to `apps/server` (versions published ≥ 14 days ago; pnpm's
   `minimumReleaseAge` enforces it; a Decisions entry with versions and alternatives).
5. Steps 5.0 → 5.9 test-first: `pnpm vitest run --project server <name>` fails for the right reason,
   then passes. Use the scripted provider and an injected clock everywhere; no test needs a key or the
   network. Commit small (`test(server): …`, `feat(server): …`), each commit green.
6. Finish: `pnpm verify` green (more than 337 tests, none skipped), `pnpm test:e2e` (8 passed),
   `git diff --stat main -- packages/engine/test/golden scripts/oracle data/models` empty, docs
   updated, `pnpm ai:smoke` run once if Nabhanyu agrees to spend a few thousand tokens (paste its
   provider, endpoint host, model, latency and token lines, never the key), everything committed;
   then `HANDOFF7.md` (`AGENTS.md` → "Finishing"), and stop.

## Setup Required

- `~/.local/bin` on `PATH` (Node, pnpm). No sudo; no C compiler (no native addons).
- Network only for installing the two SDKs and the optional `pnpm ai:smoke`.
- `.env` (mode 600, git-ignored) already configures the proxy endpoint (`OPENAI_BASE_URL`,
  `gpt-6.1-sol` for both tiers). Calls take 4-8.5 s and report ~4.4k input tokens each (D-033).

## Edge Cases & Error Handling

- A detector that throws is a bug the gate does not swallow: catch per session in the ticker, log,
  keep the other sessions running (F04 follow-up 3).
- `buildCatchUpFacts` throws when no complete over was missed; call it only when
  `missedLegalBalls ≥ 12`, and still guard.
- Seek/jump: re-simulating the crowd for a prefix gives the same messages; the gate (and its asked-for
  keys) stays with the session. A jump past a captain's cheap dismissal means the collapse detector
  never saw it as a trigger but its history replay still counts it (it counts every qualifying
  dismissal since the persona's join point); a session that jumps could treat the jump target as a
  new join point if this matters.
- Teaser timing (PLAN): `revealAt = event.t`, `nudgeAt = event.t − 6000`; a result ready after the
  fan's TV passed `nudgeAt` goes out with `nudgeAt: null` and the trace shows `usedMs > budgetMs`.
- `winProbability` is null before the first `innings_start`; detectors never need it pre-match.
- The crowd's `id`s are `<eventId>:c<n>`; message `t` can be up to 90 s after its event.

## Warnings

- **Do not edit** `packages/engine/test/golden/*`, `scripts/oracle/*` or `data/models/*`, or any
  existing test, to get green. Engine changes need a test first and, for `contracts/`, a Decisions
  entry (Constraint 8). If the plan looks wrong, write `docs/bugs/BUG-004-*.md` and flag it.
- `check:hardcode` scans `apps/*/src` too: prompts, fallbacks and route code must not name players,
  teams, venues or labels; interpolate facts.
- No hand-written "AI" text: fallbacks are labelled templates built from the same facts (D-016).
- Prompts for shared keys never include per-session facts (Constraint 11): no `squadImpact`, no
  `projection`, no fan messages; the teaser never sees `outcome` or `why`.
- `spoilerLint` (5.5) rejects outcome statements, not ordinary words; consider also rejecting
  "decides it"-style phrasing for `match_decided` teasers (F04 follow-up 2).
- Tags are never moved or deleted (the one correction above was a tag the auditor had just created on
  the wrong commit). Do not merge, tag, push or rewrite history.
- pnpm prints "Update available 10.34.7 → 12.x": ignore it (pinned via `packageManager`).
