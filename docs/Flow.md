# Flow: how execution travels through the code

> What calls what, in what order, across files. Sections marked **BUILT** describe code that
> exists now; sections marked **PLANNED (Task N)** describe the agreed shape that task must
> implement, and are rewritten as BUILT when that task merges. Bugs live in the gaps between files,
> so every hop names the file.

---

## 1. Server boot — BUILT (T1, T5)

```
node apps/server/src/index.ts                       (`pnpm start`; `pnpm dev` adds --env-file-if-exists=.env;
                                                      production: systemd in /srv/sideline, §14)
  └─ index.ts
       ├─ resolve repoRoot = apps/server/src/../../..           (import.meta.dirname)
       ├─ read version from <repoRoot>/package.json
       ├─ loadConfig(process.env, repoRoot)                      apps/server/src/config.ts
       │    ├─ drop empty env values ("KEY=" means unset)
       │    ├─ EnvSchema.safeParse  → throws "Invalid environment: PORT: …" on bad input
       │    ├─ pick AI provider: SIDELINE_AI_PROVIDER > ANTHROPIC_API_KEY > OPENAI_API_KEY > "none"
       │    │    (explicit provider without its key → throws)
       │    └─ models: anthropic → claude-opus-5-5 unless SIDELINE_MODEL_FAST/SMART (a non-Claude
       │         name → throws); openai → both SIDELINE_MODEL_* required (throws naming the missing one)
       ├─ buildRuntime(config)                                   apps/server/src/runtime.ts
       │    ├─ loadMatchBundles(dataDir)                         data/bundle.ts
       │    │    manifest → every file through its engine schema (errors name the file) → buildTimeline
       │    │    → every persona's join point exists → simulateCrowd(seed = match id) once (D-050)
       │    ├─ loadGlossary(dataDir)                             data/glossary.ts (46 terms)
       │    ├─ openDatabase(data/runtime/sideline.db) → migrate (PRAGMA user_version)   db/*.ts
       │    ├─ rebuildAnalytics(db, bundles): deliveries (with the engine's leverage) + players
       │    ├─ loadReplayRows(data/ai-replay/*.jsonl) → ai_cache source 'replay'   ai/providers/replay.ts
       │    ├─ createProvider(config) → anthropic | openai | null (keyless: aiMode "replay")
       │    └─ gateway (cache, budget, traces) → telemetry → orchestrator → session manager
       ├─ startTicker(manager, 100 ms)                           sessions/ticker.ts
       ├─ createApp({config, version, startedAt, runtime})       apps/server/src/http/app.ts
       └─ serve({fetch: app.fetch, port, hostname})              @hono/node-server
            └─ logs "[sideline] v… listening …" + publicConfigSummary(config)   (never secrets)
               + { matches, analyticsRows, replayRows, aiMode }
SIGINT / SIGTERM → stop the ticker → closeAllConnections (SSE streams) → server.close → db.close → exit 0
```

## 2. HTTP request — BUILT (T1, T5, T6)

```
request
  └─ secureHeaders (CSP default-src 'self', no inline scripts, frame-ancestors 'none', DENY, nosniff)
       ├─ GET  /api/health            → {ok, service, version, uptimeSec, node, nodeEnv, aiProvider,
       │                                 aiModelFast, aiModelSmart, aiEndpoint (kind only, D-068)}
       ├─ only with a runtime (src/index.ts; the T1 tests run without):        http/routes/*.ts
       │    ├─ GET  /api/matches                  bundles → summary + personas {id,label,blurb,lens,delayMs}
       │    ├─ GET  /api/matches/:matchId         bundle → {match, players, rules, winprob} | 404 (T6, D-060)
       │    ├─ POST /api/sessions                 readJson(16 KB cap → 413; JSON/schema → 400)
       │    │      → manager.create → 201 {sessionId, streamUrl} | 404 unknown match/persona | 503 busy
       │    ├─ GET  /api/sessions/:id/stream      404 JSON unknown | SSE (§7)
       │    ├─ POST /api/sessions/:id/control     404 | 400 bad request | 400 invalid_control (jump target)
       │    │      → session.control → {clock}
       │    ├─ POST /api/sessions/:id/ask         rateLimit(clientIp) → 429 + Retry-After
       │    │      → 404 | 400 (trimmed text 1-280, lens) → session.ask (§13) → {moment}
       │    └─ GET  /api/telemetry?scope=global|session&sessionId=&viewers=
       │           → 400 bad query | 404 unknown session | telemetry.snapshot (§8)
       ├─ any other /api/*           → app.notFound → JSON 404 {error:{code:"not_found", message}}
       └─ only if apps/web/dist/index.html existed at boot:
            ├─ serveStatic(root = webDistDir)   (rejects "..", "//", "\" and any "%" in the path)
            └─ GET * (non-/api)      → index.html from memory (SPA fallback)
  thrown error anywhere → app.onError → console.error(err) + JSON 500 {error:{code:"internal"}}
clientIp(c): the socket peer (getConnInfo); X-Forwarded-For only when the peer is loopback (Caddy, §14)
```

## 3. Web page load, theming and routes — BUILT (T1, T6)

```
GET /, /match/:matchId, /architecture (any non-API path) → index.html (server SPA fallback, §2)
  ├─ <script src="/theme-init.js">  (blocking, in <head>)       apps/web/public/theme-init.js
  │     reads localStorage["sideline.theme"] (guarded) → "system"|"light"|"dark"
  │     resolves against prefers-color-scheme → sets <html data-theme> + data-theme-pref
  └─ <script type="module" src="/src/main.tsx">  (bundled by Vite into /assets/index-*.js)
        ├─ import @fontsource-variable/anek-latin/standard.css (self-hosted woff2, wght + wdth axes)
        ├─ import ./styles/app.css → tailwind + tokens.css (colours keyed off [data-theme]; the TV
        │     screen's .surface-night keeps dark values in both themes) + effects.css
        └─ createRoot(#root).render(<App/>)                       apps/web/src/App.tsx
              ├─ useRoute() → parseRoute(pathname) (useSyncExternalStore over popstate, D-062)
              │                                                    apps/web/src/router.tsx
              ├─ header: skip link, wordmark Link "/", "How Sideline is built" Link, <ThemeControl/>
              ├─ main:
              │    "/"              → <Landing/>      GET /api/matches → <PersonaPicker/>
              │                       "Start watching" → navigate(/match/<id>?persona=<id>)
              │    "/match/:id"     → <MatchRoom/>    (§9)  no or unknown persona → the picker
              │    "/architecture"  → lazy <Architecture/> (its own chunk): docs/Architecture.md,
              │                       the PLAN checklist and Decisions.md via ?raw, through
              │                       lib/markdown.ts (markdown-it, html off → React elements, D-061)
              │    anything else    → "That page isn't here"
              └─ <AttributionFooter/>  (required line, Cricsheet credit, "How Sideline is built")
Links: <Link> → history.pushState + a navigate event (modified clicks and new tabs left alone)
```

Dev mode: `pnpm dev` runs Vite on :5173 (HMR) and the server on :8787; Vite proxies `/api` to the
server and may read the repo root for the `?raw` docs (`server.fs.allow`, default deny list kept;
`apps/web/vite.config.ts`). Prod: the server serves `apps/web/dist`. Develop keyless with
`SIDELINE_AI_PROVIDER=none pnpm dev` (a shell variable beats `.env`).

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

## 7. Session lifecycle and tick loop — BUILT (T5; end of match T6; Task 8 skills and the fan's chat T8)

```
POST /api/sessions {matchId, personaId, delayMs?, lens?}                  http/routes/sessions.ts
  → manager.create                                                           sessions/manager.ts
       unknown match/persona → SessionError → 404; at 300 sessions: evict the least recently active
       session with no open stream, else SessionError("busy") → 503
       telemetry.registerSession(id, matchId)
  → createSession                                                            sessions/session.ts
       joined = joinSeq(events, persona.joinAt)                (-1 pre-match)  engine/cricket/join.ts
       state  = foldEvents(events ≤ joined) (no gate: the fan was not watching)
       clock  = {stadiumT: t(joined) or 0, speed 1, playing, delayMs: request ?? persona, wallAt: now}
       chat cursor after the crowd messages at or before the start (bundle.crowd, shared, D-050)
       missedLegalBalls(events, -1, joined) ≥ 12 → startCatchUp(0, joined, at = start)   (§8)

GET /api/sessions/:id/stream (SSE)                                          http/routes/stream.ts
  → session.connect(listener): hello{sessionId, match, persona, aiMode} → snapshot{clock,
    events < cursor, moments due (createdAt ≤ now), chat < cursor} → (error, if the session stopped)
  → queue → writeSSE({event: type, id: seq, data: JSON(message)}); ": heartbeat" every 15 s
  → client gone: stream.onAbort → unsubscribe (the session becomes idle-evictable)

one global ticker, every 100 ms: manager.tick()                            sessions/ticker.ts
  for each session: idle (no stream, nothing for 30 min) → evict + telemetry.forgetSession
                    else try session.tick() catch → session.fail (paused, "error" to its streams)
  session.tick():  now = min(end + delayMs, stadiumAt(clock, wall))       engine/clock.ts
                   (end = the last event or crowd line; the clock runs on by the fan's delay so
                    their TV reaches the end too: BUG-004, D-063)
    while events[cursor].t ≤ now:
      before = structuredClone(state); applyEvent(state, event)           engine/cricket/reducer.ts
      gate.process({before, after, event, events, ctx(persona…), chat: crowd})   engine/gate/gate.ts (§11)
      telemetry.recordGate(id, decisions, triggers)                       telemetry/collector.ts
      spoiler_nudge trigger → budgetMs = max(0, (t − 6 s + delay − now) / speed)
                            → orchestrator.teaser (§8, async)
      lineup_patch → orchestrator.lineupPatch (intent null, revealAt = the XI event)        (§8)
      bailout      → orchestrator.bailout (revealAt = the wicket)                          (§8)
      room_read    → orchestrator.roomRead (revealAt = the ball that closed the over)      (§8)
    → "events" batch; crowd messages ≤ now and the fan's own lines not yet sent → "chat" batch;
      produced moments now due → "moment"
    → events and crowd exhausted and now ≥ end + delayMs → pause the clock, "clock";
      streams open → "telemetry" every 5 s, with the gateway's aiMode now (D-071)

POST /api/sessions/:id/control                                             http/routes/control.ts
  play | pause | speed | delay → clock re-anchored at now (delay: no refold, the buffer is client-side)
  lens → future catch-ups and answers
  seek t | jump {start | toss | over (seqAfterOvers) | event id} → moveTo(t):
     clamp → cursors by time → state = foldEvents(≤ t) → sent marks cleared (moments and the fan's
     own lines alike: a jump back hides them, play passes them again once)
     → skipped ≥ 12 legal balls never seen (beyond the furthest point seen) → startCatchUp
     → "snapshot" (moments with createdAt > t stay hidden until the clock passes them again)
AI work resolves → deliver(moment): kept; sent now if its time has come (else when it does)
```

## 8. AI gateway call — BUILT (T5; Task 8 skills, repair and the mode T8)

```
orchestrator.teaser({trigger, ballT, budgetMs, tvNow})                   orchestrator/orchestrator.ts
  → gateway.run(teaserSkill, nudge:<match>:<eventId>, {nudge facts, team names}, {deadlineMs, sessionId})
  → moment: createdAt = revealAt = ball; nudgeAt = ball − 6 s if tvNow() < it, else null (late:
    straight to the reveal); payload {eventId, nudge (model), reveal (code, from the outcome),
    leverage, budgetMs, usedMs = trace.latencyMs}
orchestrator.catchUp({facts, at})
  → key catchUpKey(match, innings, fromOver, toOver, lens); telemetry.recordKey(shared)
  → gateway.run(catchUpSkill, key, catchUpSkillFacts(facts) /* squadImpact dropped */)
  → moment: createdAt = revealAt = at (shown when the fan's TV reaches the join point)
orchestrator.lineupPatch({key, facts, intent, createdAt, revealAt})          ai/skills/lineupPatch.ts
  → gateway.run(lineupSkill, lineup:<match>:<squad hash>:<intent hash | none>, {facts, team names,
    intent, both squads, team rules}); a fan's request also recordKey(personal)
  → moment lineup_patch, scope session: the XIs' patch reveals with the XI event, a request at once
orchestrator.bailout({trigger, ballT})                                        ai/skills/bailout.ts
  → gateway.run(bailoutSkill, bailout:<match>:<eventId>:<C|VC>, bailoutSkillFacts(facts)
    /* projection split off: payload only, never the prompt */) → moment bailout, shared, at the wicket
orchestrator.roomRead({trigger, ballT})                                       ai/skills/roomRead.ts
  → gateway.run(roomReadSkill, room:<match>:<innings>:<over>, {room facts, team names})
    (the chat escaped inside <chat>) → moment room_read, shared, at the ball that closed the over
orchestrator.statBack / orchestrator.inspect                                  (§16)

gateway.run(skill, key, facts, {deadlineMs?, sessionId?})                ai/gateway.ts
  ├─ in-flight map by (promptVersion, key): a second run awaits the first, then writes its own trace
  ├─ cache.get(key, promptVersion, model)    live row for this model, else a replay row  ai/cache.ts
  │     zod re-check → payload, provenance "cache" | "replay", trace cache "hit"
  ├─ no provider → fallback ("no provider configured and no recorded output")
  ├─ budget.admit(sessionId)                 daily USD cap, per-session call cap        ai/budget.ts
  │     refused → fallback, outcome "budget"
  ├─ skill.buildPrompt(facts) → {system, user};  timeout = skill.timeoutMs(facts, deadlineMs)
  ├─ provider.complete({system, user, jsonSchema (limits stripped), model, effort, maxTokens,
  │     signal}) raced against the abort                     ai/providers/{anthropic,openai}.ts
  │     abort → "timeout" | ProviderRefusalError → "refused" | ProviderOutputError → "error"
  │     | other → "error" (class, status and the body's error code; never its message)
  ├─ costOf(served model, reported usage) → budget.charge                    ai/pricing.ts
  ├─ any answer at all → the provider is answering; a provider error → it is not (mode, D-071)
  ├─ skill.outputSchema.safeParse → invalid → "error"
  ├─ skill.repair?(output, facts) → drops what a rule forbids on its own (an illegal lineup swap)
  ├─ skill.guard(output, facts) → rejected → "fallback" ("guard: …")   ai/guards/{spoilerLint,citations}.ts
  ├─ ok → cache.putLive → payload = skill.toPayload(output, facts), provenance "live"; outcome
  │     "repaired" (with what was dropped) if the repair dropped anything, else "ok"
  └─ else payload = skill.fallback(facts) (labelled, provenance "fallback"; never cached)
  every run: one AICallTrace → traces.record → ai_calls row (with `called`) + telemetry listener;
  gateway counters
gateway.mode() = "live" while a provider is configured, the budget holds and its last call did not end
  in a provider error, else "replay"; at boot it starts from traces.lastProviderAnswer() (D-071)
```

The scripted provider (`ai/providers/scripted.ts`) stands in for a model in every test; nothing in
`pnpm test` needs a key or the network. `pnpm ai:smoke` (`scripts/ai-smoke.ts`) makes one real
teaser call through the gateway with the configured provider and an in-memory database.

## 9. The match room on the fan's TV clock — BUILT (T4 logic, T6 UI)

```
<MatchRoom matchId> (?persona=<id>)                               apps/web/src/pages/MatchRoom.tsx
  ├─ GET /api/matches/:id (players, rules, model) + GET /api/matches (personas)   lib/api.ts (zod)
  ├─ POST /api/sessions {matchId, personaId} → sessionId                (attempt++ restarts it)
  └─ <Room>
       ├─ useSessionStream(sessionId)                           stream/useSessionStream.ts
       │    new EventSource(/api/sessions/:id/stream); per frame: JSON.parse → StreamMessageSchema
       │    → store.dispatch (invalid frames dropped with a warning); a MessageEvent "error" is the
       │    server's session_failed, a bare Event the browser's (reconnecting | closed)
       │    store (stream/store.ts): hello → session, failure cleared; snapshot → clock, events,
       │    moments, chat REPLACED, epoch + 1 (Review focus 1); events/chat appended if new;
       │    moment upserted by id (POST /ask answers arrive twice); clock; telemetry; error
       ├─ useTvView(matchId, clock, events)                     stream/tvClock.ts
       │    tvT = tvTimeAt(clock, now), re-read every 100 ms while playing (and on visibilitychange)
       │    released = releasedCount(events, tvT) (binary search); state = foldEvents(≤ released)
       │    → TvContext (useTvState())
       ├─ chat shown = chat[0, releasedCount(chat, tvT))        (the crowd waits for the TV too)
       ├─ squad impact = squadPoints(fantasyPoints(TV state), persona squad)   (F05 follow-up 1)
       ├─ desktop (≥ 960 px): bar (title, PhaseRail) │ TvPane │ companion │ ControlPlaneDrawer
       │  phone: sticky compact Scorebug + tabs Companion / TV / Control plane, sticky composer
       ├─ <TvPane>                                                broadcast/TvPane.tsx
       │    Scorebug, OverStrip, InningsDotMatrix ×2, WinProbLine (winProbability per delivery),
       │    Commentary (describeDelivery), PlaybackControls, DelayControl, all from the TV state
       │    outbursts: released grew within the same epoch → outburstFor(each newly released event)
       │      big ball = a spoiler_nudge moment exists for it (the gate's leverage rule, D-046),
       │      or match_end → FloodlightGlow.burst(colour) + <GhostText mode="sweep"> headline 4.2 s
       │      a snapshot (new epoch) resets the baseline and lights nothing       broadcast/outburst.ts
       ├─ <MomentFeed> newest first, each card asks momentVisibility(moment, tvT):
       │    SpoilerCard: hidden (DitherVeil 1 over empty bars: no teaser, no outcome in the DOM)
       │      → teaser (nudge) → revealed (reveal, veil dissolves 900 ms); null nudgeAt: hidden → revealed
       │    CatchUpReel: thinking pulse until revealAt (the join point), then slides + squad impact
       │    ExplainerCard: question, answer, related terms (one tap asks again)
       ├─ <Composer> GlowInput, suggestQuestion(TV state, last delivery) → POST /ask → upsert
       │    429 → "try again in N s" (Retry-After); 409 → paused
       ├─ <ControlPlaneDrawer> telemetry (every 5 s): counters, projection formula, gate decisions
       │    with t ≤ tvT, traces only once their moment is revealed (a guard's detail can quote the
       │    score after the ball)                                 controlplane/spoilerSafe.ts
       └─ controls → POST /control → the answered clock dispatched at once, the stream's
          clock/snapshot follows; buttons show the choice at once and drop the guess on failure
engine pieces: tvTimeAt/stadiumAt (clock.ts), releaseDue/momentVisibility (buffer/delay.ts),
  foldEvents, describeDelivery, winProbability, fantasyPoints, squadPoints
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

The server's tick loop (§7, built T5) runs this for every released event; the tests replay whole
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
  → triggers: MomentTrigger { kind, key, scope, facts } → orchestrator (§8; teasers from T5)

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
  → ChatMessage[] sorted by t: one crowd per match, simulated at boot with the match id as seed
    (D-050); sessions stream it at stadium time, the browser releases it on the fan's TV clock (§9),
    and the room detector reads it
```

## 13. A fan's question — BUILT (T5)

```
POST /api/sessions/:id/ask {text, lens?}                                  http/routes/ask.ts
  → rate limiter (token bucket per client address: 12/min, burst 4) → 429 + Retry-After
  → session.ask(text, lens ?? session lens)                               sessions/session.ts
       tvT = tvTimeAt(clock, now); events with t ≤ tvT → foldEvents → situationOf (the fan's screen,
       never the stadium's head start); last 6 deliveries → describeDelivery lines
  → orchestrator.ask → explain()                                         ai/skills/explainer.ts
       glossary.lookup(question) (exact after trimming filler words) → payload source "glossary",
         provenance "deterministic", no trace, no model call                data/glossary.ts
       else key explain:<match>:<tv seq>:<lens>:<fnv1a(question)>; mentioned glossary term attached
         → gateway.run(explainerSkill …) with the question escaped inside <fan_question>
         → telemetry.recordKey(personal)
  → moment {kind explainer, phase any, revealAt null, scope session} → deliver → {moment}
```


## 14. Deploy, redeploy and the public request path — BUILT (T7)

```
sudo deploy/install.sh [--keyless] [--ref <ref>] [--domain <host>]       (once, by Nabhanyu; idempotent)
  ├─ app user = owner of the repository; Node 24 from ~/.local/bin; site = IMDSv2 public IPv4 → <a-b-c-d>.sslip.io
  ├─ 1 /srv/sideline (created root, owned by the developer) → as the developer: deploy/update.sh --no-restart <ref>
  ├─ 2 Caddy: the official apt key and source (dl.cloudsmith.io), apt-get install caddy (once)
  ├─ 3 /etc/caddy/Caddyfile ← Caddyfile.template (sslip.io name, domain, port 8780) → caddy validate → mv
  ├─ 4 /etc/sideline/sideline.env (root 600) ← scripts/deploy-env.ts --env-file .env --port 8780 [--keyless]
  │      Node's .env parser → only SERVER_ENV_NAMES → HOST/PORT/NODE_ENV forced → loadConfig → "NAME=\"value\""
  ├─ 5 /etc/systemd/system/sideline.service ← sideline.service (user, paths, node, port) → systemd-analyze verify
  ├─ 6 /etc/sudoers.d/sideline: <dev> may run /usr/bin/systemctl restart sideline (visudo -c first)
  └─ 7 ufw only if filtering → daemon-reload → enable sideline caddy → restart sideline → reload-or-restart caddy
       → health: http://127.0.0.1:8780/api/health (required), https://<sslip>/ (required), https://<domain>/ (warns)

deploy/update.sh [ref]          (as the developer; default main; --dry-run, --no-restart, --dir)
  ref → commit in this repository → /srv/sideline: refuse an origin other than this repository (from T10
  ~/Downloads/SidelineProd-Dream11FDEAssignment, D-078) and local edits → git fetch origin (branches, tags)
  → checkout --detach <sha> → mkdir data/runtime → pnpm install --frozen-lockfile → pnpm build
  → sudo -n systemctl restart sideline → health on the Caddyfile's port, then each site name

browser ─HTTPS→ Caddy (:443; :80 → 308) ─→ 127.0.0.1:8780 Node (§2) in /srv/sideline
  Caddy: X-Forwarded-For = the real client (a client's own X-Forwarded-* ignored); static files compressed;
  /api/* (and the SSE stream) passed through as written, flushed at once
  systemd: User=<dev>, EnvironmentFile=/etc/sideline/sideline.env, read-only system and home,
  writes only /srv/sideline/data/runtime; Restart=on-failure; SIGTERM → §1 shutdown
```

## 15. Recording the replay cache — BUILT (T7)

```
pnpm ai:record [--yes] [--fresh] [--out <dir>] [--provider scripted]          scripts/ai-record.ts
  ├─ loads .env → loadConfig → createProvider (none → exit 1: nothing to record with)
  ├─ plan: recordMoments(provider null, rows already in <dir>)                     scripts/lib/record.ts
  │    buildRuntime(in-memory DB, hand-moved clock, replayDir <dir>) → for every match × persona:
  │      play: session at the join point (60 s delay, 1x) → tick 5 s → settle → … until the clock stops (D-063)
  │      jumps: a fresh session → pause → jump to each RECORDED_JUMPS target → settle (a catch-up if ≥ 12 balls)
  │    → ai_calls: keys that fell back with "no provider" = the calls to make; replay hits = already recorded
  ├─ no --yes: print the plan, exit 0 (nothing sent)
  └─ --yes: the same walk with the provider → the gateway (dedupe, cache, budget, timeout, zod, guard)
       → replayable rows: live answers + earlier rows, one per key, still valid, recorded skills only
       → <dir>/<matchId>.jsonl (sorted, written through a temporary file) → report calls, tokens, cost, missing
server boot (§1): loadReplayRows(data/ai-replay) → ai_cache source 'replay' → answers any model, with no key
```

## 16. A fan's lineup request, chat line, take and inspector query — BUILT (T8; the sandbox's process T10)

```
POST /api/sessions/:id/lineup-intent {text 1-280}                          http/routes/lineup.ts
  → per-address token bucket (429 + Retry-After) → readJson (400, 413) → session.lineupIntent(text)
       no squad → 409 no_squad; the fan's TV has shown the first ball → 409 locked
       lineupSoFar(): the lineup detector on the released XI event (recomputed, so a skipped XI
       still counts) → null → 409 not_yet | "all_playing" → 409 all_playing
       → orchestrator.lineupPatch({key: lineupKey(match, squad, text), facts, intent: text,
         createdAt: now, revealAt: null}) (§8) → deliver → {moment}

POST /api/sessions/:id/chat {text 1-280, statBack?}                         http/routes/chat.ts
  → bucket → readJson → session.chat(text, statBack)
       message {id you-<n>, t = the fan's TV time, handle "You", fromYou, synthetic false}
       → kept with the session's own lines → "chat" to its stream (snapshots carry it once due)
       statBack → orchestrator.statBack({take, tvT, tvSeq, situation on the TV})
         → runStatBack                                                     ai/skills/statBack.ts
              gateway.run(statBackQuerySkill, statback:<match>:<tvSeq>:<hash>, {take, teams, situation})
              → no SQL (fallback) → labelled "could not check" card
              → runSandboxed(sql, statBackTables(bundle, tvT))   (below) → not ok → labelled card with
                the SQL and the reason
              → gateway.run(statBackVerdictSkill, same key, {take, sql, columns, rows ≤ 50})
                guard: every number in statLine is in the rows or the take
         → moment take_card, scope session, revealAt null → deliver → {message, moment}

POST /api/sessions/:id/inspector {question} | {sql}                       http/routes/inspector.ts
  → bucket → readJson(InspectorRequestSchema) → session.inspect → orchestrator.inspect
       tables = inspectorTables(bundle, tvT, db): visible_deliveries ≤ tvT, players, ai_calls (no
       session id, key or detail; last 5,000 rows)                                  sql/views.ts
       question → gateway.run(inspectorSkill, inspect:<hash>, {question}) → no SQL → status no_query
       → runSandboxed(sql, tables) → {result: InspectorResult}

runSandboxed(sql, tables)                                                   sql/sandbox.ts
  validateSql: one statement, SELECT/WITH, deny list, no comments, ≤ 2000 chars → refused + reason
  two already running → busy
  fork(sql/worker.ts, empty environment, 64 MB heap) → send {tables, sql, maxRows 200} (T10, D-078):
    in-memory database built from the tables → PRAGMA query_only → setAuthorizer (SELECT, reads of
    those tables, 23 plain functions) → SELECT * FROM (<sql>) LIMIT 200 → rows sent back
  answered → SIGKILL → rows | not answered after 2 s → SIGKILL → timeout
  settles (and frees its slot) only once the process has exited: nothing of the query runs on (BUG-005)
```

## 17. Story mode, the Task 9 cards and `/architecture` — BUILT (T9)

```
landing "Watch the story" → /match/<id>?story=1                             components/PersonaPicker.tsx
  MatchRoom: GET /api/matches/:id/story → StoryPlan | null                  http/routes/matches.ts
       buildStoryPlan (once per bundle): story fan = first pre-match persona with a team; catch-up
       point = first late joiner's; the gate (four detectors, the crowd) over the whole match for
       that fan → beats: lineup, bailout, catch_up, climax, room_read, result     engine/story/plan.ts
  → navigate(replace) ?persona=<plan.personaId>&story=1 → session as usual (§7)
  Room: useStoryDirector(plan, {tvT, moments, resultShown}, control)          story/StoryOverlay.tsx
       every TV tick: advanceStory                                             story/director.ts
         steer  → POST control: jump(beat lead-in) · delay 25 s (climax) · speed (32 | 2 | 8 | 16) · play
         watch  → the beat's moment revealed on the TV (the climax: its teaser, then its reveal) /
                  the result on the TV → POST control pause; the overlay's one-line callout
         Continue → next beat (after the teaser: play on to the reveal); Leave → no more commands,
                  the room's own controls come back

MomentFeed (each card checks momentVisibility itself: held cards carry nothing of the moment)
  lineup_patch → SquadDiffLedger: request → POST /lineup-intent (§16) until the first ball on the TV
  bailout      → BailoutQuestCard: resolveQuestRule(rule, events on the TV) per call; BanterCard →
                 share/cardImage.ts (canvas PNG) → navigator.share({files}) | ({text}) | download
  room_read    → RoomReadPods: sample ids looked up in the chat on the TV; poll rule settled the same way
  take_card    → TakeCard (from ChatComposer → POST /chat {statBack: true}, §16)
ControlPlaneDrawer → InspectorQuery: GET /api/inspector/views once; POST /inspector {question} | {sql}
  traces for nudge, bailout and room keys wait for their ball on the TV (controlplane/spoilerSafe.ts)

/architecture                                                               pages/Architecture.tsx
  ?raw at build time: docs/Architecture.md (the theses section and the whole file), docs/PLAN.md (the
  checklist as a table and as PlanTimeline), docs/Decisions.md, README.md (credits)
  PipelineDiagram (inline SVG, across or down by width) · AiUsageTable ← GET /api/telemetry?scope=global
```
