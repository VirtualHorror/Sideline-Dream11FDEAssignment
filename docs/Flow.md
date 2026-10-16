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
  stadiumNow = clock.stadiumAt(now)
  for each newly due event: applyEvent → gate.process(before, after, event) → triggers
     → orchestrator.handle(trigger) → (cache | provider | fallback) → Moment → SSE "moment"
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

## 9. Client delay buffer — PLANNED (Task 4 logic, Task 6 UI)

```
SSE events/chat/moments (stadium time) → store
rAF loop: tvT = stadiumAt(clock, now) − delayMs
  → release events/chat with t ≤ tvT into the TV state (same engine reducer)
  → momentVisibility(moment, tvT): hidden → teaser (nudgeAt ≤ tvT) → revealed (revealAt ≤ tvT)
```
