# Sideline: architecture

> Big picture of the system: what it is for, its parts, how data moves, and the rules for when AI
> is (and is not) used. Implementation detail lives in code comments and `docs/Flow.md`.
> Every section marks what is **built** and what is **planned (Task N)** so this file is never
> ahead of, or behind, the code. Plan: `docs/PLAN.md`. Domain definitions: `docs/DOMAIN.md`.

## 1. What we are building and why

**Sideline** is an AI-powered second-screen companion for a live cricket match, built as a
Dream11 Forward Deployed Engineer intern assignment. Dream11 is now a free-to-play "Sports Watch
Along" app (creator live streams, Hit or Miss predictions, DreamBucks). Sideline targets the four
moments in a live match where that experience breaks and fans drop off or get spoiled:

| Phase | When | Fan problem | Sideline's answer |
| --- | --- | --- | --- |
| 1. Toss to lock | toss → first ball | Surprise playing XI: a picked player sits out, minutes before lock | **Lineup Patch**: diff XI vs squad (code), legal swaps (code), conditions-aware rationale (AI) |
| 2. Early collapse | powerplay | Captain out for nothing: the fantasy team feels dead, the fan closes the app | **Bailout**: a 3-over comeback quest the engine resolves (code) phrased with banter and grounded trivia (AI) |
| 3. Joining late | mid-match | Opens the app at over 14 to a cold `90/4` and no story | **Catch Me Up**: anomaly-ranked facts (code) told as a short reel, in a chosen lens (AI) |
| 4. Climax | death overs | OTT streams lag 15-45 s; chat, creators and notifications spoil the big ball; chat is a firehose | **Hold the Spoiler** + **Room Read**: delay-aware release (code), spoiler-free teasers (AI), chat clustered into debates (AI) |

The demo replays **real ball-by-ball data** (Cricsheet, ODC-By 1.0) of the 2022 India vs Pakistan
T20 World Cup game, with the 2024 final as a second match that proves nothing is hardcoded.

### Three design theses (the things to remember from this document)

1. **LLM calls scale with match moments, not with fans.** Routine deliveries are handled by
   deterministic code at no model cost. The model is called only for high-entropy moments, and
   its output is cached by *moment key* (e.g. `nudge:<match>:<eventId>`), so the second, third,
   and ten-millionth fan at the same moment get a cache hit. Personal moments are keyed by
   *cohort* (e.g. everyone whose captain just fell), not by user.
2. **The broadcast delay is the AI's latency budget.** The stadium feed reaches the server
   15-45 s before a fan's OTT stream shows the ball. Sideline generates the spoiler-free teaser
   inside that window and releases it on the fan's own TV clock.
3. **The LLM proposes; deterministic rules dispose.** Every model output is a zod-validated
   structure. Swaps are re-checked by the squad validator, predictions are resolved by the engine
   from real deliveries, catch-up slides must cite real event ids, teasers pass a spoiler linter,
   SQL runs read-only in a sandbox. Anything that fails falls back to a deterministic template,
   labelled as such in the UI.

## 2. System context

```
                        ┌──────────────────────── single Ubuntu 24.04 host (AWS t2.xlarge) ───────────────────────┐
  Fan's browser          │                                                                                         │
 ┌──────────────┐  HTTPS │  Caddy (TLS, :443)  ──►  Node 24 process: apps/server (Hono)                            │
 │ apps/web     │◄──────►│                           ├─ static web build (apps/web/dist) + SPA fallback           │
 │ React SPA    │  SSE   │                           ├─ REST: sessions, control, ask, inspector, telemetry        │
 │  ├ TV pane   │◄───────│                           ├─ SSE: per-session stream (events, moments, chat, clock)    │
 │  ├ companion │        │                           ├─ Session manager + one tick loop for all sessions          │
 │  └ control   │        │                           ├─ @sideline/engine (pure): timeline, reducer, detectors     │
 │    plane     │        │                           ├─ AI gateway ──────────────────────────────────────────────┼──► Anthropic or an OpenAI-compatible
 └──────────────┘        │                           │   (cache → provider → validate → fallback)                 │    API (today: proxy); optional,
                         │                           └─ node:sqlite: ai cache, AI traces, analytics tables        │    replay mode works without a key
                         │  data/ (raw Cricsheet, fixtures, rules, models, crowd corpus, AI replay cache)          │
                         └─────────────────────────────────────────────────────────────────────────────────────────┘
```

No managed cloud services. Everything (TLS, app, database, model artefacts) runs on one machine;
the only outbound dependency is the optional LLM API.

## 3. Repository map

| Path | What | Status |
| --- | --- | --- |
| `packages/engine` | Pure, isomorphic TypeScript domain core. Contracts (zod), cricket timeline + reducer, fantasy, models, detectors, gate, delay buffer, crowd. **No I/O, no clocks, no unseeded randomness.** Runs identically on server and client. | contracts, squad validator (T1), timeline, reducer, fantasy scoring (T2) **built**; models, detectors, gate, buffer, crowd planned (T3-T4) |
| `apps/server` | Node 24 + Hono. Runs `.ts` directly (native type stripping, no build). Config, HTTP, sessions, SSE, AI gateway, SQLite. | config, health, static + SPA, security headers **built** (T1); rest planned (T5, T8) |
| `apps/web` | React 19 + Vite 8 + Tailwind 4 SPA. Theme system, effects, TV pane, companion, control plane. | shell, tokens, theme control, attribution **built** (T1); rest planned (T6, T9) |
| `data/` | Real Cricsheet files + manifest/checksums; authored fixtures (squads, credits, notes, personas); rules; trained models; crowd corpus; AI replay cache. | raw, fixtures, rules **built** (T1); models (T3), corpus (T4), replay (T7) planned |
| `scripts/` | `fetch-cricsheet`, `verify-data`, `check-no-hardcode` (built, T1); `engine-report` (built, T2); `oracle/` audit reference (built, T1) and `oracle/audit/` auditor's toolkit: archive sweep, comparator, spec re-derivation, mutants (built, T2 audit); `build-models` (T3), `ai-record` (T7) planned. | |
| `e2e/` | Playwright smoke tests on system Chrome, desktop + mobile. | **built** (T1), grows every UI task |
| `deploy/` | Caddyfile, systemd unit, install/update scripts. | planned (T7) |
| `docs/` | This file, Decisions, Flow, Constraints, TEST_CHECKLIST, ROLLBACK, PLAN, DOMAIN, Bug_Feature (feature and bug register), design/, features/, bugs/. | **built** (T1), kept current every task |

## 4. Data flow (end to end)

```
data/raw/cricsheet/<id>.json ─┐
data/matches/<id>/*.json  ────┼─► buildTimeline()  ──►  MatchEvent[]  (stadium timeline, stable ids)
data/rules, data/models   ────┘        (T2)                    │
                                                              ▼
   Session (per browser): stadium clock (play/pause/speed/seek)  releases events with t <= stadiumNow
                                                              │
               ┌──────────────────────────────────────────────┤ every released event
               ▼                                              ▼
   applyEvent(state) (T2)            Entropy gate (T4): run detectors on (before, after, event)
   fantasy points, WP, leverage        ├─ "deterministic": counted, logged, no model call  (the vast majority)
   (T2, T3)                            ├─ "suppressed": cooldown / duplicate / too late      (logged with reason)
                                       └─ "ai_trigger": MomentTrigger{kind, key, scope, facts}
                                                              │
                                                              ▼
                       Orchestrator (T5): in-flight dedupe by key → AI gateway (T5)
                         cache hit? ──yes──► payload (provenance "cache"/"replay")
                            │ no
                            ▼
                         provider call (structured output, effort, timeout, budget)
                            → zod validate → skill guard (spoiler lint / grounding / legality)
                            → ok: payload ("live")   |   fail: deterministic template ("fallback")
                                                              │
                                                              ▼
                       Moment {kind, key, createdAt, revealAt, nudgeAt, provenance, traceId}
                                                              │  SSE
                                                              ▼
   Browser: delay buffer on the fan's TV clock (tvT = stadiumT - delayMs) (T4 logic, T6 UI)
     events/chat/moments are held until tvT >= t; teasers show at nudgeAt; reveals at revealAt
```

### Time model

- **Stadium time** `t` (ms since coverage start): when something happens at the ground.
  Deterministic per match: pre-match (squads, notes, toss, XIs), then delivery gaps from a
  documented timing model (longer after boundaries, wickets and over ends): `DEFAULT_TIMING` in
  `engine/cricket/timing.ts`, jitter from the event id (D-035).
- **TV time** `tvT = stadiumT - delayMs`: what the fan's stream shows. `delayMs` per fan (0-60 s;
  presets: stadium 0, cable ~15 s, OTT ~25 s, slow stream ~40 s). In production the client would
  read the player's HLS `EXT-X-PROGRAM-DATE-TIME` to measure this automatically.
- **Speed** multiplies stadium time against wall time (1x-32x) for the demo. The story mode drops
  to 1-2x for the climax so the teaser window is perceivable.

## 5. When Sideline does NOT call AI (and when it does)

| Situation | Handled by | Model call? |
| --- | --- | --- |
| Score, overs, CRR/RRR, batter/bowler cards, partnerships | reducer | never |
| Fantasy points, squad legality, credits | fantasy engine + validator | never |
| Win probability, leverage | trained logistic model (T3) | never |
| Playing XI vs squad diff, legal swap enumeration | detector + validator | never |
| Holding spoilers on the fan's TV clock | delay buffer | never |
| Resolving a prediction | quest resolver | never |
| Known glossary term ("what is a free hit?") | glossary lookup | never |
| Routine delivery (dot, single, two) | gate → deterministic | never |
| Captain/VC out cheaply in the powerplay | detector → **Bailout** (cohort key) | yes, once per cohort per moment |
| High-leverage ball (leverage ≥ threshold) | detector → **Spoiler teaser** (shared key) | yes, once per ball, cached for everyone |
| Fan joins/resumes after ≥ 2 overs | session → **Catch Me Up** (over-bucketed key + lens) | yes, cached per window and lens |
| Surprise XI affects a squad / fan asks to rebalance | detector or intent → **Lineup Patch** | yes, per squad hash + intent |
| Chat velocity spike / death-over window | detector → **Room Read** (window key) | yes, once per window |
| Contextual question, "stat-back my take", telemetry question | **Explainer / Stat-back / Inspector** | yes, rate-limited per IP |

Providers (D-033): both Anthropic and any OpenAI-compatible endpoint, chosen by `.env`
(Anthropic if `ANTHROPIC_API_KEY` is set, else OpenAI-compatible if `OPENAI_API_KEY` is set,
`SIDELINE_AI_PROVIDER` overrides). Anthropic default: `claude-opus-5-5` with per-skill `effort`
(low for teasers and classification, medium for synthesis; `claude-haiku-5-5` for a cheaper fast
lane). **Currently configured:** the OpenAI-compatible proxy endpoint
(`https://api.proxy.pro/v1`, `gpt-6.1-sol`, Responses API), verified to return strict
JSON-schema output in 4-8.5 s, with ~4.4k hidden input tokens per call. Structured outputs
everywhere; no free-form text reaches the UI without schema validation.

## 6. Scale story ("% compute saved at 10M DAU")

The control plane shows a projection computed from live counters, never from constants:

```
naive LLM calls      = eventsPerMatch × concurrentViewers         (one call per event per fan)
Sideline LLM calls   = uniqueMomentKeys (shared) + Σ cohorts × personal moments
savedPct             = 1 - Sideline / naive
```

With ~250 deliveries, ~20 shared moments and a handful of cohorts per match, the saving is
> 99.99% at 10M viewers. The formula is rendered with the real numbers substituted.

## 7. Security model

- Secrets only in the server process (env or `/etc/sideline/sideline.env`, 0600). Never in logs,
  health output, SSE or the web bundle (`publicConfigSummary` is the only config view that leaves).
- Strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), nosniff, DENY.
- Input limits (≤ 280 chars), per-IP rate limits and a global daily AI budget (T5).
- Fan text is treated as data in prompts (delimited, never as instructions); outputs are schemas.
- NL→SQL runs read-only, single-statement, allow-listed tables, row cap, in a worker with a
  hard timeout (T8).
- Supply chain: exact-ish pins + lockfile; pnpm `minimumReleaseAge` 14 days; install scripts
  blocked by default; no native addons (no compiler on the host).

## 8. Observability

Every gate decision and every AI attempt is recorded (`GateDecision`, `AICallTrace` in
`packages/engine/src/contracts/telemetry.ts`) and streamed to the **Control Plane** drawer:
counters (events, deterministic share, triggers, live calls, cache hits, fallbacks, tokens, cost),
latency p50/p95, recent decisions with reasons, AI traces with their JSON payloads and provenance,
the spoiler latency budget (`budgetMs` vs `usedMs`), and the scale projection. The NL inspector
(T8) answers questions over the same tables.

## 9. Frontend architecture (planned T6, T9; shell built T1)

- Routes: `/` landing (hero, persona picker), `/match/:matchId` match room, `/architecture`
  (shareable architecture + live build plan for the demo round, rendered from these docs at build
  time; D-034). Footer with the attribution line on every route (enforced by `e2e/smoke.spec.ts`).
- State: SSE stream → store; the client folds events with the same engine reducer at its own TV
  time, so the TV pane and companion never show anything the fan's stream has not shown.
- Visual system (`docs/design/DESIGN_SYSTEM.md`): night-match palette, Anek Latin (Ek Type,
  Mumbai), the four reference effects mapped to meaning (`docs/design/VISUAL_REFERENCES.md`).

## 10. Testing strategy

| Layer | How | Where |
| --- | --- | --- |
| Contracts | invariant tests (wide can't be legal, totals add up, …) | `packages/engine/test/contracts.test.ts` |
| Data | fixtures vs raw data, persona legality, checksums | `packages/engine/test/fixtures.test.ts`, `scripts/verify-data.ts` |
| Engine | golden scorecards/points vs the **independent Python oracle**; property tests (strike rotation, fold = replay) | T2 built; T3-T4 extend |
| Generality | every engine test runs on **both** matches; the auditor sweeps a whole Cricsheet archive the implementer did not tune on (engine vs oracle, plus an independent re-derivation of the rules) | `scripts/oracle/audit/` (from the T2 audit) |
| Anti-hardcoding | deny-list scan built from data | `scripts/check-no-hardcode.ts` |
| AI | scripted provider: prompts must contain state-derived facts; schema + guard + fallback paths | T5, T8 |
| HTTP | Hono `app.request()` | `apps/server/test` |
| UI | Vitest + Testing Library; Playwright smoke on desktop + 390 px mobile with system Chrome | `apps/web/test`, `e2e/` |

`pnpm verify` runs typecheck, lint, all unit tests, the hardcode scan, the data gate and the
production build. `pnpm test:e2e` runs the browser tests.
