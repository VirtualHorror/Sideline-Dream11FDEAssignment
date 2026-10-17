# Handoff: Task 6, Frontend I (effects, landing, match room, phases 3-4 UI, control plane, `/architecture`)

**Generated**: 2026-10-17 08:30 IST (by Claude Code, which implemented Task 5 in Codex's place and then audited it)
**Branch**: `main`, clean (this file is committed on top of `a4b71cd`). Task 5 is merged and tagged `t05-verified` (`a4b71cd`). Create `task/06-frontend-core` from `main`.
**Status**: Ready for implementation (Task 5 done and verified; Task 6 not started)

## Goal

Sideline is an AI second-screen companion for live cricket (Dream11 FDE intern assignment by
Nabhanyu). Implement **Task 6 only** from `docs/PLAN.md`: the landing page (floodlight hero, ghost-text
wordmark, persona picker), the match room (TV pane folded on the fan's own TV clock, the companion with
spoiler cards, catch-up reel, explainer and the simulated chat, the control plane drawer), the four
effects with their fallbacks, and the shareable `/architecture` page. Everything runs against the real
Task 5 server. Claude audits afterwards; you do not merge.

## Completed

- [x] Tasks 1-4 (`t01`-`t04-verified`). A fresh-session spot-check of `t04-verified` (this session)
  re-derived the teaser counts and catch-up facts in Python, ran the detectors on two never-seen holdouts
  and pinned two Task 4 test gaps (D-051).
- [x] Task 5, the server runtime (`t05-verified`; record `docs/features/F05-server-ai.md`):
  - match bundles, SQLite (`data/runtime/sideline.db`, git-ignored), one crowd per match (D-050);
  - per-browser sessions on one 100 ms ticker, streamed over SSE; seek/jump refold; catch-ups;
  - the AI gateway (Anthropic and OpenAI-compatible providers, in-flight dedupe, cache, budget, timeout,
    zod, guards, labelled fallbacks, one trace per run, replay rows), orchestrator, telemetry;
  - skills: spoiler teaser (the model never sees the outcome, D-055), catch-up, glossary-first explainer
    (`data/glossary.json`, 46 terms); `pnpm ai:smoke`.
- [x] Numbers you inherit: `pnpm verify` 37 files / 492 tests; E2E 8 passed; a full 2022 replay for
  babar-believer is 266 events, 23 teasers; keyless, every AI card is a labelled `fallback`.

## Not Yet Done (exact rules and literals in `docs/PLAN.md` → "Task 6")

- [ ] **6.1** store + TV clock: TV state at `tvT` = `foldEvents` of events with `t ≤ tvT`; a new `snapshot` replaces state
- [ ] **6.2** `SpoilerCard`: veiled (no outcome text in the DOM) before `nudgeAt`, teaser until `revealAt`, reveal after
- [ ] **6.3** effects: CSS fallback without WebGL2 and under `prefers-reduced-motion: reduce`; `GlowInput` `data-state`
- [ ] **6.4** `InningsDotMatrix` (120 cells per innings + extras markers; 1298150 innings 2 over 18 classes), tabular `Scorebug`
- [ ] **6.5** control plane: counters, gate decisions with reasons, traces with provenance + expandable JSON, projection formula
- [ ] **6.6** E2E `e2e/match-room.spec.ts` (persona → room; jump after 18 overs at 16x, 25 s delay → card veiled, then revealed); **6.6b** `/architecture`
- [ ] **6.7** `pnpm verify` + `pnpm test:e2e` green; docs (F06, Flow §3 and §9 UI, Architecture, DESIGN_SYSTEM statuses, TEST_CHECKLIST, ROLLBACK, Bug_Feature, README)
- [ ] Write `HANDOFF8.md` per `AGENTS.md` → "Finishing", then stop
- [ ] Owner action, not Task 6: top up the proxy account and re-run `pnpm ai:smoke` once (Task 7's `ai:record` needs a working provider)

## Failed Approaches (Don't Repeat These)

- **Guessing timeline gaps.** Three waits this session were too short. `DEFAULT_TIMING`
  (`packages/engine/src/cricket/timing.ts`): 34 s per ball, +18 s after a boundary, +50 s after a
  wicket, +55 s after an over's end, ±3 s jitter. The ball after an over's end is ~89 s later; after a
  six ~52 s. Compute waits from event `t` values.
- **Guessing where the teasers are.** 1298150's chase teasers: 1.5, 3.2, 5.3, then 18.6, 19.1, the 19.4
  no-ball, the 19.4 wide, 19.5, the 19.6 wide and the deciding 19.6 single; **none between overs 6 and
  18**. Innings 1: 1.1, 3.6, 10.5, 11.1, 11.3, 12.2, 13.2, 13.6, 15.5, 16.4, 18.3, 19.2, 19.3.
- **Jumping at 32x with coarse waits makes teasers late.** A ball released 30 s of stadium time after
  its `t` has a budget of 0 and arrives with `nudgeAt: null` (sample below). The real ticker (100 ms)
  keeps the lag ≤ 1.6 s at 16x, so 6.6's sequence (veiled → teaser → reveal) holds at 16x with a 25 s
  delay; do not use 32x for it.
- **Piped checks in `&&` chains.** `pnpm lint | tail` hid a lint failure and a bad commit went in.
  Use `set -o pipefail` (or check each exit code).
- **SSE reading in tests.** A `reader.read()` raced against a timeout and abandoned swallows its chunk;
  keep one read pending (see `readFrames` in `apps/server/test/stream.test.ts`).
- **String-matching numbers.** `String(leverage)` is `"1"` for the 19.4 no-ball and matches everything;
  assert structure (keys, parsed values).
- **Calling the real AI endpoint.** The proxy account is **out of credit**: `pnpm ai:smoke` got a 403
  and two diagnostic listings a 503. `pnpm dev` loads `.env`, so every big ball would try (and fail);
  run UI work keyless: `SIDELINE_AI_PROVIDER=none pnpm dev` (a shell variable beats the env file).
- **Still true from earlier handoffs:** `applyEvent` mutates (clone before); no `%` in `it.each` titles;
  write merge/commit messages to a file and check exit codes; tick PLAN steps, never reword them.

## Key Decisions

| Decision | What it means for Task 6 |
|----------|-----------|
| One crowd per match (D-050, Nabhanyu) | Every fan of a match sees the same `synthetic: true` chat; label it "Simulated crowd". |
| Teaser: model writes the nudge, code writes the reveal (D-055, Nabhanyu + Claude) | `payload.nudge` is AI text (or a template if `provenance: fallback`); `payload.reveal` is always the scorecard line. `nudgeAt: null` = no teaser for this fan (late): hidden → revealed. |
| Moments are sent at stadium time (D-056) | The server pushes a moment as soon as it exists; the **browser** holds it with `momentVisibility(moment, tvT)`. Never render outcome text before `revealAt` on the TV clock. |
| Catch-up reveals at the join point (D-056) | `revealAt = createdAt =` the stadium time the fan joined or jumped to; show a thinking state until the TV gets there. The payload has **no squad impact** (Constraint 11): compute it client-side from the folded state and the persona squad (F05 follow-up 1). |
| Explainer (D-057) | A glossary answer is `provenance: deterministic`, `source: glossary`, `traceId: null`; an AI answer is built from what the fan's TV has shown. |
| Traces explain fallbacks (D-053, D-054) | `trace.detail` says why ("no provider configured and no recorded output", "provider error: PermissionDeniedError (403)"); `costEstimated` → show "est.". |
| HTTP limits (D-058) | Questions 1-280 characters (400 otherwise); 429 with `Retry-After` after a burst of 4 (12 a minute); `{ error: { code, message } }` everywhere. |
| Markdown renderer (PLAN 6) | New dependency: Decisions entry, version published ≥ 14 days before install, raw HTML disabled. |

## Current State

**Working**: `main` at `a4b71cd` (+ this handoff). `pnpm verify` → 3× `typecheck: Done`,
`Checked 165 files … No fixes applied.`, `Test Files  37 passed (37)`, `Tests  492 passed (492)`,
`check-no-hardcode: OK (86 source files, 209 terms)`, `verify-data: OK (2 matches)`, `✓ built`.
`pnpm test:e2e` → `8 passed`. The server boots keyless (`aiMode: "replay"`) and serves the whole API.

**Broken**: no code defect known. The proxy account is out of credit, so with `.env` every live AI call
falls back (403) until it is topped up.

**Known limits** (F05 follow-ups): every teaser's `phase` is `climax`; the SSE queue per connection is
unbounded; the explainer has no outcome linter; BUG-002 (archive rejections).

**Uncommitted Changes**: none. `task/05-server-ai` still exists (merged). `.env` holds a real key
(mode 600, git-ignored): never open, print, copy or commit it.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/PLAN.md` (Task 6) | Authoritative spec: files, props, steps, literals |
| `docs/design/DESIGN_SYSTEM.md`, `docs/design/VISUAL_REFERENCES.md`, `docs/design/reference/*` | Colours, type, layout, effect maths and what each effect means |
| `packages/engine/src/contracts/{session,moments,telemetry,chat}.ts` | `StreamMessage`, `ClockState`, `ControlRequest`, `Moment` and payloads, `TelemetrySnapshot`, `ChatMessage` |
| `packages/engine/src/{clock.ts,buffer/delay.ts}` | `tvTimeAt`, `releaseDue`, `momentVisibility`: the client-side spoiler shield |
| `apps/server/src/http/routes/*.ts`, `apps/server/src/http/app.ts` | The API you call (shapes below) |
| `apps/server/src/sessions/session.ts` | What the stream sends, when (hello → snapshot → events/chat/moment/clock/telemetry/error) |
| `apps/server/src/orchestrator/orchestrator.ts` | How each moment's `createdAt`, `revealAt`, `nudgeAt` are set |
| `docs/Flow.md` §3, §7, §8, §9, §13 | Page load, session and stream, gateway, client buffer (UI is yours), questions |
| `apps/web/src/*`, `apps/web/vite.config.ts` | Task 1 shell (tokens, theme, attribution); Vite proxies `/api` to `:8787` |
| `e2e/smoke.spec.ts`, `playwright.config.ts` | Add `/match/1298150` and `/architecture` to `ROUTES`; the E2E server runs keyless |

## Code Context

**REST** (`{ error: { code, message } }` on every failure):
```text
GET  /api/matches                       → { matches: (MatchSummary & { personas: {id,label,blurb,lens,delayMs}[] })[] }
POST /api/sessions {matchId, personaId, delayMs?, lens?}   → 201 { sessionId, streamUrl: "/api/sessions/<id>/stream" } | 400 | 404 | 503
GET  /api/sessions/:id/stream           → SSE: "event: <type>\nid: <seq>\ndata: <StreamMessage JSON>\n\n"; ": heartbeat" every 15 s
POST /api/sessions/:id/control <ControlRequest>            → { clock: ClockState } | 400 invalid_request | 400 invalid_control | 404
POST /api/sessions/:id/ask {text, lens?}                   → { moment: Moment } | 400 | 404 | 409 session_failed | 429 (Retry-After)
GET  /api/telemetry?scope=global|session&sessionId=&viewers=  → TelemetrySnapshot | 400 | 404
```

**Stream order** (`StreamMessageSchema`; validate every message):
```text
hello {sessionId, match, persona, aiMode: "live"|"replay"} → snapshot {clock, events, moments, chat}
→ events {events} | chat {messages} | moment {moment} | clock {clock} | telemetry {telemetry} (every 5 s)
→ error {code: "session_failed", message} (also repeated after the snapshot on reconnect)
seek/jump → a new snapshot: replace state, events, chat and moments; never merge
```

**Real keyless moments** (from `buildRuntime`, late-from-work jumped to 18.5 at 32x):
```json
{"key":"nudge:1298150:1298150:0254","kind":"spoiler_nudge","phase":"climax","createdAt":14050000,"revealAt":14050000,"nudgeAt":null,"provenance":"fallback","traceId":"05b8…","scope":"shared","payload":{"eventId":"1298150:0254","nudge":"India need 22 off 7. Kohli (68 off 49) faces Rauf.","reveal":"18.6 Rauf to Kohli, six. India 144/4, need 16 off 6","leverage":0.4100038502113644,"budgetMs":0,"usedMs":1}}
{"key":"catchup:1298150:2:0-14:casual","kind":"catch_up","phase":"mid_match","createdAt":12623000,"revealAt":12623000,"nudgeAt":null,"provenance":"fallback","scope":"shared","payload":{"innings":2,"fromLabel":"0.1","toLabel":"13.6","lens":"casual","situation":"India 90/4, need 70 off 36","slides":[{"kind":"turning_point","headline":"The big moment: 1.5","body":"1.5 Naseem to Rahul, OUT, bowled. India's win chance went from 46% to 32%.","citedEventIds":["1298150:0149"]}, "…3 more, the last watch_next"]}}
{"key":"explain:1298150:253:casual:94b0d23a","kind":"explainer","phase":"any","revealAt":null,"nudgeAt":null,"provenance":"deterministic","traceId":null,"scope":"session","payload":{"question":"what is a free hit?","lens":"casual","answer":"The delivery after a no-ball. …","source":"glossary","relatedTerms":["no-ball","bowled","caught"]}}
```

**Engine functions the client uses** (`@sideline/engine`, all pure):
```typescript
tvTimeAt(clock: ClockState, nowWall: number): number                 // max(0, stadiumAt − delayMs)
releaseDue<T extends { t: number }>(items: readonly T[], tvT: number): { released: T[]; held: T[] }
momentVisibility(m: Pick<Moment, "revealAt" | "nudgeAt">, tvT: number): "hidden" | "teaser" | "revealed"
foldEvents(matchId: string, events: readonly MatchEvent[], uptoSeq?: number): MatchState
situationOf(state: MatchState): Situation | null                     // public since Task 5
winProbability(state, model) / describeDelivery(event, playersById) / fantasyPoints + squadPoints (squad impact)
```

## Resume Instructions

1. `cd ~/Downloads/Dream11FDEAssignment && export PATH="$HOME/.local/bin:$PATH" && node --version && pnpm --version`
   - Expected: `v24.22.0`, `10.34.7`
2. `pnpm install --frozen-lockfile && pnpm verify`
   - Expected: the "Current State" baseline (37 files / 492 tests). If anything is red, stop and report.
3. `git checkout -b task/06-frontend-core`; create `docs/features/F06-frontend-core.md` from `docs/features/_TEMPLATE.md`.
4. Develop keyless: `SIDELINE_AI_PROVIDER=none pnpm dev` → `http://127.0.0.1:5173` (Vite proxies `/api`
   to `:8787`). Expected server log: `aiProvider: 'none'`, `aiMode: 'replay'`.
5. Steps 6.1 → 6.7 test-first (Vitest + Testing Library in `apps/web/test`, injected clocks), commit small
   (`test(web): …`, `feat(web): …`), each commit green. The markdown renderer needs its Decisions entry first.
6. Finish: `pnpm verify` green (more than 492 tests, none skipped), `pnpm test:e2e` green (more than 8),
   screenshots reviewed in both themes at 1440 px and 390 px, docs updated, everything committed; then
   `HANDOFF8.md` (`AGENTS.md` → "Finishing"), and stop.

## Setup Required

- `~/.local/bin` on `PATH`; Google Chrome for Playwright (`channel: "chrome"`). No sudo, no compiler.
- Network only to install the markdown renderer. No AI key needed: the UI must look right in replay mode
  (labelled fallbacks) and in live mode.

## Edge Cases & Error Handling

- A moment arrives before its time (the server sends at stadium time): hold it; `momentVisibility` decides.
- `nudgeAt: null` → no teaser for this fan; `revealAt: null` → show at once (explainer answers).
- A seek or jump sends a new `snapshot`: replace everything (Review focus 1); moments later than the new
  time are absent and come back by `moment` messages once the clock passes them.
- `aiMode: "replay"` or `provenance: "fallback"` → the `ProvenanceChip` says so; never style a fallback as AI.
- `error: session_failed` → show the session as paused; a reconnect gets it again.
- 429 on ask → show `Retry-After`; 400 → the 280-character limit.
- The clock pauses itself at the end of the match (a `clock` message with `playing: false`).
- EventSource reconnects on its own; every connection starts with `hello` and a `snapshot`.

## Warnings

- **Do not edit** `packages/engine/test/golden/*`, `scripts/oracle/*`, `data/models/*` or any existing test
  to get green. Engine or contract changes need a test first and, for `contracts/`, a Decisions entry.
- `check:hardcode` scans `apps/web/src`, `public` and `index.html`: match ids, persona ids, names, teams and
  labels come from `/api/matches` and the stream, never from code (E2E specs may name them).
- CSP: no inline scripts (`'unsafe-inline'` only for styles); assets same-origin; fonts self-hosted.
- The attribution line stays on every route, verbatim; add each new route to `ROUTES` in `e2e/smoke.spec.ts`.
- Never print, copy or commit `.env`; never run `pnpm ai:smoke` without asking Nabhanyu (it spends credit).
- Do not merge, tag, push or rewrite history. pnpm's "Update available 10.34.7 → 12.x" is to be ignored.
