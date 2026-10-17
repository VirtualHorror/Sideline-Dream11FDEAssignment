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
   deterministic code at no model cost (on the full 2022 replay, 233 of 266 events need no model
   call). The model is called only for high-entropy moments, and
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
| `packages/engine` | Pure, isomorphic TypeScript domain core. Contracts (zod), cricket timeline + reducer, fantasy, models, detectors, gate, delay buffer, crowd. **No I/O, no clocks, no unseeded randomness.** Runs identically on server and client. | contracts, squad validator (T1), timeline, reducer, fantasy scoring (T2), models: logistic, win probability, leverage, priors (T3), clocks, delay buffer, commentary lines, join points, the four phase detectors, catch-up facts, entropy gate, quest resolver, seeded synthetic crowd (T4) **built** |
| `apps/server` | Node 24 + Hono. Runs `.ts` directly (native type stripping, no build). Config, HTTP, sessions, SSE, AI gateway, SQLite. | config, health, static + SPA, security headers **built** (T1); match bundles, SQLite (AI cache, traces, analytics), per-browser sessions on one ticker, SSE, the AI gateway (Anthropic and OpenAI-compatible providers, cache, budget, traces, replay rows, labelled fallbacks), orchestrator, teaser / catch-up / explainer skills and their guards, telemetry with the scale projection, the session API **built** (T5); lineup, bailout, room-read and stat-back skills, inspector planned (T8) |
| `apps/web` | React 19 + Vite 8 + Tailwind 4 SPA. Theme system, effects, TV pane, companion, control plane. | shell, tokens, theme control, attribution **built** (T1); rest planned (T6, T9) |
| `data/` | Real Cricsheet files + manifest/checksums; authored fixtures (squads, credits, notes, personas); rules; trained models; crowd corpus; AI replay cache. | raw, fixtures, rules **built** (T1); models **built** (T3, generated by `scripts/build-models.ts`); crowd corpus **built** (T4, authored, synthetic); glossary **built** (T5, authored, 46 terms); runtime SQLite at `data/runtime/` (T5, git-ignored); replay (T7) planned |
| `scripts/` | `fetch-cricsheet`, `verify-data`, `check-no-hardcode` (built, T1); `engine-report` (built, T2); `oracle/` audit reference (built, T1) and `oracle/audit/` auditor's toolkit: archive sweep, comparator, spec re-derivation, mutants (built, T2 audit); `build-models` + `lib/archive.ts` (built, T3); `ai-smoke` (built, T5: one real teaser through the gateway); `ai-record` (T7) planned. | |
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

### Models (built, T3)

Trained offline by `scripts/build-models.ts` on Cricsheet's men's T20I archive (2026-10-16 zip,
sha256 `95305bc2…860a`): 3,627 matches, of which 3,093 are used (2,486 train, 607 test) after the
PLAN filters (370), the two demo matches and 162 engine rejections (BUG-002). Every exclusion is
counted in `data/models/README.md`, and the same zip rebuilds the files byte for byte (D-039).

| Model | What it reads | Held-out quality |
| --- | --- | --- |
| Chase win probability (logistic, 6 features) | runs needed, balls left, wickets in hand | Brier 0.1215, log loss 0.3712, every calibration bin within 0.05 |
| First-innings win probability (logistic, 6 features) | runs, wickets lost, balls bowled | Brier 0.2099, log loss 0.6061; overconfident at the extremes (0.8-1.0 bins about 0.10 high) |
| Leverage (0-1) | WP swing + spectacle × closeness | big ball at ≥ 0.18437, the test split's 95th percentile (5% of balls; 8.8-9.6% in the demo finishes) |
| Player priors | 10 latest real T20I appearances, scored by the fantasy engine | shrunk toward the role mean with k = 3 (D-042) |

`winProbability`, `leverage`, `projectedPoints` and `projectSquad` are pure functions of state plus
the model file, so the server and the browser compute the same numbers (D-040, D-041). The
leverage climax list was amended once (D-043, BUG-003).

### Moments engine (built, T4)

Pure functions in `packages/engine` decide *when* something matters; the server (built, T5) and the
browser (Task 6) call the same code. Flow: `docs/Flow.md` §9, §11, §12.

| Piece | Rule (from data) | On the demo data |
| --- | --- | --- |
| Lineup detector | at the second playing XI, squad picks outside both XIs → legal single swaps (`validateSquad`), best projection first | babar-believer: Fakhar and Pant benched; captain-rohit: Jaiswal |
| Collapse detector | captain or vice-captain out for ≤ 10 in the first 36 legal balls → a quest over the next 18; one quest at a time | Babar's golden duck (2022), Rohit's 9 (2024); Rizwan and Pant suppressed |
| Nudge detector | leverage ≥ the model's threshold, or the ball that decides the match (D-046) | 23 teasers in 2022, 25 in 2024, each ending on the match's last ball |
| Room detector | after every over from the 16th, or a chat spike (mean + 2 SD of this innings' minutes) | 10 over reads per match plus a few spikes on hot moments |
| Catch-up facts | whole missed overs, anomalies at z ≥ 2, top win-probability swings, situation now | late-from-work: 90/4, 70 off 36, the 20-run 12th over (z 3.04) |
| Entropy gate | every detector on every event; one decision each with a measured cost; one trigger per key | 2022 full replay: 233 of 266 events need no model call (0.876) |
| Quest resolver | settles prediction rules from deliveries the moment they are certain | Kohli has exactly 74 by legal ball 114 |
| Synthetic crowd | authored corpus (303 lines, placeholders only), seeded per event | about 10 messages in the 10 s after a wicket against 0.57 on average |

Detectors are stateless (D-045): history comes from the events and the fan's join point, and the
gate keeps each session's counters and the keys it has already asked for. Trigger facts carry ids
and display names; the two per-session facts behind shared keys (a bailout's squad projection, a
catch-up's squad impact) stay out of shared prompts. On two holdout World Cup finishes the engine
never saw (2016 final, India v Bangladesh 2016), every one of the eight biggest win-probability
swings got a teaser, the match-deciding ball was flagged, and cheap opener dismissals raised
bailouts only when they were cheap.

### Server runtime (built, T5)

One Node process holds a session per browser (D-011), each with its own stadium clock, persona, lens
and delay over a shared, read-only match bundle; one 100 ms ticker folds every due event through the
session's own entropy gate and streams it over SSE. Only moments with a skill reach the model, through
the gateway. Flow: `docs/Flow.md` §1, §2, §7, §8, §13.

| Piece | Rule | Checked on |
| --- | --- | --- |
| Sessions | start at the persona's join point; seek and jump refold from the timeline; skipping 12+ unseen legal balls earns a catch-up; produced moments stay hidden while in the future | late-from-work starts at 90/4; a jump back and forward equals a fresh fold |
| Gateway | dedupe → cache → budget → provider (timeout, raced) → zod → guard → cache; every failure a labelled fallback with a reason; one trace per run | two sessions at 18.6 of the 2022 chase: one call, then a cache hit |
| Teaser | the model sees only the pre-ball facts and writes the teaser; the reveal is the scorecard; ready late for a fan → no teaser for that fan (D-055) | 23 teasers on a full 2022 replay; a 3 s call at 32x: `nudgeAt` null, `usedMs` 3000 > `budgetMs` |
| Catch-up | shared per missed window and lens; the fan's squad impact stays out of the prompt; slides cite only the window | late-from-work: `catchup:1298150:2:0-14:casual`, prompt with 90/4, 70 and 36 |
| Explainer | glossary first (no model); else the fan's TV-time facts with their question as data (D-057) | "what is a free hit?" with zero model calls |
| Telemetry | counters equal the gate's and the gateway's; projection from live keys | a full 2022 replay: 266 events, 23 live calls |

On a World Cup match the code was never tuned on (1298158), whole sessions produced exactly the
engine gate's 23 teaser keys, no teaser prompt carried an outcome, the late joiner's reel cited the
raw file's 88/5 and 43 needed off 36, and keyless every teaser was a labelled fallback that passed
the linter.

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
| High-leverage ball (leverage ≥ threshold), or the ball that decides the match | detector → **Spoiler teaser** (shared key) | yes, once per ball, cached for everyone |
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
JSON-schema output in 4-8.5 s, with ~4.4k hidden input tokens per call. On 2026-10-17 the account was out
of credit (the Task 5 smoke call got a 403, F05): until it is topped up, every AI card is a
labelled fallback and the trace says why. Structured outputs
everywhere; no free-form text reaches the UI without schema validation.

## 6. Scale story ("% compute saved at 10M DAU")

The control plane shows a projection computed from live counters, never from constants:

```
naive LLM calls      = eventsPerMatch × concurrentViewers         (one call per event per fan)
Sideline LLM calls   = uniqueMomentKeys (shared) + Σ cohorts × personal moments
savedPct             = 1 - Sideline / naive
```

With ~250 deliveries, ~20 shared moments and a handful of cohorts per match, the saving is
> 99.99% at 10M viewers. The formula is rendered with the real numbers substituted. As built (T5):
shared keys are every gate trigger and catch-up with a shared key, counted once; personal moments
(a lineup patch keyed by squad, a model-answered question) are assumed for every viewer at the rate
observed so far, the conservative reading. A babar-believer replay of 2022: `naive = 266 events ×
10,000,000 viewers = 2,660,000,000 calls`, Sideline = its shared keys + 1 personal lineup patch per
viewer, saved about 99.6%; with no personal moments the saving shows as 99.999999%.

## 7. Security model

- Secrets only in the server process (env or `/etc/sideline/sideline.env`, 0600). Never in logs,
  health output, SSE or the web bundle (`publicConfigSummary` is the only config view that leaves).
- Strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), nosniff, DENY.
- Input limits: JSON bodies capped at 16 KB while reading (413), questions 1-280 characters (400);
  per-address token bucket on questions (12 a minute, burst 4, 429 + Retry-After; X-Forwarded-For
  trusted only from a local proxy); a global daily AI budget (USD, from reported usage) and a
  per-session cap on model calls (built, T5).
- Fan text is treated as data in prompts (inside `<fan_question>`, escaped so it cannot close the
  tag, and the system prompt says so); outputs are schemas, validated again with zod (built, T5).
- Teaser prompts never contain the ball's outcome (D-055): the model cannot spoil what it was not
  told, and a linter rejects outcome statements anyway.
- NL→SQL runs read-only, single-statement, allow-listed tables, row cap, in a worker with a
  hard timeout (T8).
- Supply chain: exact-ish pins + lockfile; pnpm `minimumReleaseAge` 14 days; install scripts
  blocked by default; no native addons (no compiler on the host).

## 8. Observability

Every gate decision and every AI attempt is recorded (`GateDecision`, `AICallTrace` in
`packages/engine/src/contracts/telemetry.ts`) and streamed to the **Control Plane** drawer:
counters (events, deterministic share, triggers, live calls, cache hits, fallbacks, tokens, cost),
latency p50/p95, recent decisions with reasons, AI traces with their JSON payloads and provenance,
the spoiler latency budget (`budgetMs` vs `usedMs`), and the scale projection. Built on the server
in T5: one `ai_calls` row per AI attempt (with why a fallback happened, D-053), counters per session
and global, `GET /api/telemetry` and a `telemetry` SSE message every 5 s; the drawer is Task 6. The NL
inspector (T8) answers questions over the same tables.

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
| Engine | golden scorecards/points vs the **independent Python oracle**; property tests (strike rotation, fold = replay) | T2 built; T4 extends |
| Models | logistic recovery on seeded synthetic data; committed-model checks (exclusions, Brier, calibration); fast-check shape (WP never rises with runs needed, never falls with wickets in hand); hand-checked leverage values on real deliveries; priors formula and committed files; archive filters and named rejections; the audit rebuilds `data/models` byte for byte | `packages/engine/test/{logistic,winprob,leverage,priors}.test.ts`, `scripts/test/archive.test.ts` (T3 built) |
| Moments | clocks and delay buffer at their edges; commentary lines and tags hand-derived from the raw file; every detector replayed per persona from its join point, with PLAN literals and expectations re-derived independently in Python (catch-up swings, quest outcomes); injected wickets pin the quest window, powerplay and cheap-score edges; the gate's share, counters, key dedupe and injected clock; crowd seeds, prefix stability and the burst after wickets; a hand-mutant pass over the new code | `packages/engine/test/{clock,delay,describe,detectors,gate,quests,crowd}.test.ts` (T4 built) |
| Generality | every engine test runs on **both** matches; the auditor sweeps a whole Cricsheet archive the implementer did not tune on (engine vs oracle, plus an independent re-derivation of the rules), and from T4 runs the detectors on holdout matches | `scripts/oracle/audit/` (from the T2 audit) |
| Anti-hardcoding | deny-list scan built from data | `scripts/check-no-hardcode.ts` |
| AI | scripted provider (no key, no network): prompts carry state-derived facts and nothing per-session or post-ball; every gateway path (cache, dedupe, timeout, refusal, invalid, guard, no provider, budget, replay); skills' guards and fallbacks on every teaser of both matches; providers through the real SDKs with a fake fetch | `apps/server/test` (T5 built), T8 |
| HTTP | Hono `app.request()` with a fake socket peer: routes, validation, limits, SSE framing; sessions with an injected clock (seek and jump refolds, late AI results, eviction) | `apps/server/test` (T1, T5 built) |
| UI | Vitest + Testing Library; Playwright smoke on desktop + 390 px mobile with system Chrome | `apps/web/test`, `e2e/` |

`pnpm verify` runs typecheck, lint, all unit tests, the hardcode scan, the data gate and the
production build. `pnpm test:e2e` runs the browser tests.
