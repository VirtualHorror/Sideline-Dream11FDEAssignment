# Flow: how execution travels through the code

> What calls what, in what order, across files. Sections marked **BUILT** describe code that
> exists now; sections marked **PLANNED (Task N)** describe the agreed shape that task must
> implement, and are rewritten as BUILT when that task merges. Bugs live in the gaps between files,
> so every hop names the file.

---

## 1. Server boot — BUILT (T1)

```
node apps/server/src/index.ts
  └─ index.ts
       ├─ resolve repoRoot = apps/server/src/../../..           (import.meta.dirname)
       ├─ read version from <repoRoot>/package.json
       ├─ loadConfig(process.env, repoRoot)                      apps/server/src/config.ts
       │    ├─ drop empty env values ("KEY=" means unset)
       │    ├─ EnvSchema.safeParse  → throws "Invalid environment: PORT: …" on bad input
       │    └─ pick AI provider: SIDELINE_AI_PROVIDER > ANTHROPIC_API_KEY > OPENAI_API_KEY > "none"
       │         (explicit provider without its key → throws)
       ├─ createApp({config, version, startedAt})                 apps/server/src/http/app.ts
       └─ serve({fetch: app.fetch, port, hostname})              @hono/node-server
            └─ logs "[sideline] v… listening …" + publicConfigSummary(config)   (never secrets)
```

## 2. HTTP request — BUILT (T1)

```
request
  └─ secureHeaders (CSP default-src 'self', no inline scripts, frame-ancestors 'none', DENY, nosniff)
       ├─ GET /api/health            → JSON {ok, service, version, uptimeSec, node, nodeEnv, aiProvider}
       ├─ any other /api/*           → app.notFound → JSON 404 {error:{code:"not_found", message}}
       └─ only if apps/web/dist/index.html existed at boot:
            ├─ serveStatic(root = webDistDir)   (rejects "..", "//", "\" and any "%" in the path)
            └─ GET * (non-/api)      → index.html from memory (SPA fallback)
  thrown error anywhere → app.onError → console.error(err) + JSON 500 {error:{code:"internal"}}
```

## 3. Web page load and theming — BUILT (T1)

```
GET /  → index.html
  ├─ <script src="/theme-init.js">  (blocking, in <head>)       apps/web/public/theme-init.js
  │     reads localStorage["sideline.theme"] (guarded) → "system"|"light"|"dark"
  │     resolves against prefers-color-scheme → sets <html data-theme> + data-theme-pref
  └─ <script type="module" src="/src/main.tsx">  (bundled by Vite into /assets/index-*.js)
        ├─ import @fontsource-variable/anek-latin/standard.css (self-hosted woff2, wght + wdth axes)
        ├─ import ./styles/app.css → tailwind + tokens.css (all colours keyed off [data-theme])
        └─ createRoot(#root).render(<App/>)                       apps/web/src/App.tsx
              ├─ header: wordmark + <ThemeControl/>                apps/web/src/theme/ThemeControl.tsx
              │     useState(readStoredPreference(safeLocalStorage()))   apps/web/src/theme/theme.ts
              │     useEffect: applyTheme(pref); in "system" also subscribe to matchMedia changes
              │     onChange → setPreference + writeStoredPreference (errors swallowed)
              ├─ main: intro copy (Task 6 replaces with the landing hero)
              └─ <AttributionFooter/>  (required line + Cricsheet credit)   apps/web/src/components/AttributionFooter.tsx
```

Dev mode: `pnpm dev` runs Vite on :5173 (HMR) and the server on :8787; Vite proxies `/api` to the
server (`apps/web/vite.config.ts`). Prod: the server serves `apps/web/dist`.

## 4. Data provenance and integrity — BUILT (T1)

```
node scripts/fetch-cricsheet.ts            reads data/raw/cricsheet/manifest.json (source URL, match list)
  → download zip to a fresh temp dir → `unzip -p` each listed file → JSON.parse check
  → write data/raw/cricsheet/<id>.json and record sha256 in the manifest
node scripts/fetch-cricsheet.ts --check    same download, compare sha256s only (exit 1 on drift)

node scripts/verify-data.ts                (pnpm check:data)
  → for each manifest match: raw exists + sha256 matches; players/context/personas parse
    (engine schemas, imported relatively from packages/engine/src); persona squads pass
    validateSquad(rules.team); every data/matches/<id> folder is in the manifest
```

## 5. Verification pipeline — BUILT (T1)

```
pnpm verify
  = pnpm typecheck      (tsc 7: engine src [no Node/DOM types], engine tests, server, web, root scripts/e2e)
  → pnpm lint           (biome check .)
  → pnpm test           (vitest projects: engine, server, web, scripts)
  → pnpm check:hardcode (scripts/check-no-hardcode.ts: deny-list from data/ vs application source)
  → pnpm check:data     (scripts/verify-data.ts)
  → pnpm build          (vite build → apps/web/dist)
pnpm test:e2e           (playwright: builds, starts server on :8799, desktop + 390 px mobile, system Chrome)
python3 -I scripts/oracle/cricsheet_oracle.py <raw> [--players --rules] [--json]   (auditor's reference)
scripts/oracle/audit/run_sweep.sh <raw-dir> <work-dir>    (auditor's archive sweep, from the T2 audit)
  → per match: gen_fixtures.py → engine-report --json + oracle --json → compare.py
  → dump_engine.ts (events + per-delivery state) → check_spec.py (rules re-derived from the raw file)
```

---

## 6. Timeline build — BUILT (T2)

```
data/raw/cricsheet/<id>.json + data/matches/<id>/{players,context}.json
  → buildTimeline({raw, players, context, timing?})                            engine/cricket/timeline.ts
       ├─ CricsheetMatchSchema.parse(raw)                                     engine/cricket/cricsheet.ts
       ├─ map Cricsheet names → registry ids; team names → context codes
       ├─ emit coverage, squads, notes, toss, XIs, innings, deliveries, result
       ├─ label legal balls (illegal extras share the next legal-ball number)
       ├─ carry free hits through a wide/no-ball and mark non-boundary fours
       ├─ time events from DEFAULT_TIMING plus FNV-1a jitter of stable event ids
       └─ validate every event with MatchEventSchema
  → foldEvents(matchId, events, uptoSeq?)                                    engine/cricket/reducer.ts
       └─ update scorecards, live rates, partnerships, fall of wickets, over/maiden state
  → fantasyPoints(state, players, rules)                                      engine/fantasy/scoring.ts
       └─ score XI players from state, then squadPoints applies captain/vice multipliers

node scripts/engine-report.ts <raw.json> --players <players.json> --rules <rules.json> [--json]
  └─ load context.json beside players.json and print the reducer report for oracle comparison
```

`buildMatchSummary(raw, context)` uses Cricsheet venue, city, and date with authored context
metadata. `applyEvent` mutates a state one event at a time; `foldEvents` creates a fresh state for
seeking and replay. Over summaries retain both team runs and bowler-conceded runs so maiden
classification follows the extras rules exactly.

## 7. Session lifecycle and tick loop — PLANNED (Task 5)

```
POST /api/sessions {matchId, personaId, delayMs?, lens?}
  → sessions/manager.create → Session{clock at persona.joinAt, state = fold(events ≤ join)}
GET /api/sessions/:id/stream (SSE)
  → hello → snapshot{clock, events ≤ stadiumNow, moments, chat}
one global tick (≈100 ms) for all live sessions:
  stadiumNow = stadiumAt(clock, now)                                  (engine/clock.ts, built T4)
  for each newly due event: applyEvent → gate.process({before, after, event, events, ctx, chat})
     (§11, built T4; chat = the session's simulated crowd, §12)
     → triggers → orchestrator.handle(trigger) → (cache | provider | fallback) → Moment → SSE "moment"
  late join or return after ≥ 12 missed legal balls → buildCatchUpFacts → catch_up trigger (§11)
  batched SSE "events" / "chat"; periodic SSE "telemetry"
POST /api/sessions/:id/control {play|pause|speed|seek|jump|delay|lens}
  → clock update → seek/jump refolds state and sends a new "snapshot"
idle > TTL → session evicted (stream closed)
```

## 8. AI gateway call — PLANNED (Task 5)

```
orchestrator.handle(trigger)
  ├─ in-flight map by trigger.key (concurrent identical triggers share one promise)
  ├─ cache.get(key, promptVersion, model) → hit: payload, provenance "cache" (or "replay")
  └─ miss: budget.check → skill.buildPrompt(facts) → provider.complete({schema, effort, timeout})
        → zod validate → skill.guard (spoiler lint / grounding / legality)
        → ok: cache.put; provenance "live"     fail/timeout/refusal/budget: skill.fallback(facts); "fallback"
     every path writes one AICallTrace row and updates counters
```

## 9. Client delay buffer — logic BUILT (T4), UI PLANNED (Task 6)

```
SSE events/chat/moments (stadium time) → store                                 (Task 6)
rAF loop: tvT = tvTimeAt(clock, now)                                            engine/clock.ts
            = max(0, stadiumAt(clock, now) − delayMs)
            stadiumAt = playing ? stadiumT + max(0, now − wallAt)·speed : stadiumT
  → releaseDue(items, tvT) → { released: t ≤ tvT, held }, input order kept     engine/buffer/delay.ts
  → released events fold into the TV state (same engine reducer)
  → momentVisibility(moment, tvT): hidden → teaser (nudgeAt ≤ tvT) → revealed (revealAt ≤ tvT)
       null nudgeAt: hidden → revealed; null revealAt: revealed at once
```

## 10. Model build and model reads — BUILT (T3)

Numbered after the planned sections so the PLAN's references to §7-9 stay valid.

```
node scripts/build-models.ts [--zip <path>]                                   scripts/build-models.ts
  ├─ no --zip: downloadArchive → fresh temp dir (removed in finally)          scripts/lib/archive.ts
  ├─ sha256File(zip); retrievedAt = committed value if the sha256 matches, else today / zip mtime
  ├─ extractArchive → every match id, numeric order (a non-id JSON name throws)
  ├─ for each id:  record XI appearances of the demo squads (for priors)
  │    ├─ demo match (manifest)?                         → excludedMatchIds
  │    ├─ filterReason(raw) (PLAN filters, fixed order)  → counted per reason
  │    ├─ runEngine(id, raw): synthesizeFixtures → buildTimeline → foldEvents
  │    │     error → named BUG-002 reason, or "<stage>: <message>" → excludedMatchIds
  │    └─ accepted: matchRows (applyEvent one event at a time)
  │          chase: before ball 1 of innings 2 + after each legal ball (decided states skipped)
  │          first innings: after each legal ball;   split by fnv1a32(id) % 5 === 0 → test
  ├─ throw unless used + filtered + demo + rejected = files
  ├─ fitLogistic(train rows, l2 = 1e-4·n) per model                       engine/models/logistic.ts
  ├─ metrics on test rows (Brier, log loss, 10 calibration bins)
  ├─ test split again: structuredClone(state) → applyEvent → leverage(before, after) for every
  │    legal ball → nudgeThreshold = nearest-rank 95th percentile        engine/models/leverage.ts
  ├─ priors per demo match: each squad player's 10 latest accepted XI appearances before the date
  │    (runEngine with the player's role, others BAT) → fantasyPoints → roleMean → projectedPoints
  └─ write data/models/{winprob-v1.json, priors-<id>.json, README.md}  (Biome-excluded, byte-stable)

live reads (pure; the model files are passed in as data):
  winProbability(state, model)                                               engine/models/winprob.ts
    ├─ no innings yet → null
    ├─ innings 1 (and the break) → predictLogistic(firstInnings, firstInningsFeatures(runs, wkts, balls))
    └─ innings 2 → reached 1 | all out or out of balls: level 0.5, else 0 | predictLogistic(chase, …)
  leverage({before, after, event, model}) → clamp(swing·|ΔP| + spectacle·closeness, 0, 1)
       caller copies the state before applyEvent (the reducer mutates in place)
  projectedPoints(playerId, priors) / projectSquad(squad, priors, rules)     engine/models/priors.ts
```

The test split and the leverage threshold depend only on match ids and the archive, so a rebuild
from the same zip reproduces every byte (D-039). The nudge detector (Task 4) compares each
delivery's `leverage().value` with `model.leverage.nudgeThreshold`.

## 11. Detectors and the entropy gate — BUILT (T4)

The server's tick loop (Task 5) will run this for every released event; the tests replay whole
matches through it (`packages/engine/test/helpers/replay.ts`).

```
before = structuredClone(state); applyEvent(state, event)                     engine/cricket/reducer.ts
gate.process({ before, after: state, event, events, ctx, chat })              engine/gate/gate.ts
  for each detector (lineup, collapse, nudge, room):                          engine/detectors/*.ts
    t0 = nowMicros(); verdict = detector.evaluate(input); costMicros = nowMicros() − t0
    lineup    the second playing_xi: squad picks outside both XIs → ai_trigger lineup_patch
              facts: squad, benched picks + enumerateSwaps (validateSquad, priors), XIs, toss, notes
    collapse  a delivery: C/VC out (not retired hurt), ≤ 10 runs, within the first 36 legal balls
              → bailout:<match>:<eventId>:<C|VC> with a quest window of the next 18 legal balls,
              unless an earlier one since joinSeq(persona.joinAt) still runs → suppressed quest_active
                                                                              engine/cricket/join.ts
    nudge     a delivery: leverage ≥ model.leverage.nudgeThreshold, or the ball that ends the chase
              → nudge:<match>:<eventId>; facts split "before the ball" (teaser) from "outcome"
                                                                              engine/models/leverage.ts
    room      a delivery: an over ends from 15.6 on, or the last minute's chat > mean + 2 SD of this
              innings' minutes (≥ 10 of them) → room:<match>:<innings>:<over>; crowd messages only
    an ai_trigger whose key this gate already asked for → suppressed duplicate_key
  → GateDecision per verdict (reason, momentKey, costMicros)
  → counters { eventsTotal, eventsDeterministic (no trigger), triggers, suppressed }
  → triggers: MomentTrigger { kind, key, scope, facts } → orchestrator (Task 5)

session-driven (not per event), when a fan joins late or comes back:
  missedLegalBalls(events, lastSeenSeq, currentSeq) ≥ 12                      engine/detectors/catchup.ts
    → buildCatchUpFacts({ events, fromSeq, toSeq, ctx, lens })
         window: whole missed overs of the innings in progress (else the previous innings')
         facts: per-over runs, anomalies (z ≥ 2, population SD), longest run-less spell, top 3 WP
         swings, previous-innings summary, partnership, situation, WP now, squad impact (per session)
    → key catchUpKey(match, innings, fromOver, toOver, lens)

predictions, on server and client as events arrive:
  resolveQuestRule(rule, events) → pending | won | lost                       engine/quests/resolve.ts
```

Detectors keep no state between calls (D-045): history comes from `events` (only `seq <= event.seq`
is read) and the states, so one detector object serves every session; the gate is per session.

## 12. Synthetic crowd — BUILT (T4)

```
simulateCrowd({ events, players, corpus, seed })                               engine/crowd/simulate.ts
  corpus = CrowdCorpusSchema.parse(data/crowd/corpus.json)   (placeholders, sides, rates per trigger)
  for each event (a timeline from its first event; a prefix is fine):
    applyEvent(state, event)
    random = mulberry32(seedFrom(`${seed}|${event.id}`))                       engine/util/prng.ts
    triggers: toss | playing_xi | innings_start | innings_end (break) | match_end | ambient, or for a
              delivery its main reaction (wicket, six, four, noball, wide, dot, runs) plus noball,
              freehit (a free hit is next), over_end, pressure (live chase, death overs), ambient
    per trigger: n in rates[trigger].min..max; lines whose placeholders and side resolve; drawn
      without replacement; t = event.t + exponential delay; affinity from the line's side;
      text filled from players.json short names and team codes; synthetic: true, fromYou: false
  → ChatMessage[] sorted by t (Task 5 releases them on the fan's TV clock; the room detector reads them)
```
