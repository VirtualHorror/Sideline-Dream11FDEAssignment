# F06: Frontend I (effects, landing, match room, phases 3-4 UI, control plane, `/architecture`)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 06 in `docs/PLAN.md`
- **Branch:** `task/06-frontend-core`
- **Owner / session:** Claude, implementing in place of Codex at Nabhanyu's request, then auditing, 2026-10-17
- **Status:** audited and merged (`t06-verified`)

## Scope

The first screen people see. A landing page with the floodlight hero, the ghost-text wordmark and a
persona picker; a match room where the fan's TV pane (folded on their own delayed TV clock), the
companion (held spoilers, catch-up reels, the explainer, the simulated watch-along chat) and the
control plane drawer run against the real Task 5 server; the four reference effects with their
fallbacks; and the shareable `/architecture` page rendered from the repository's docs. Before any of
it, an independent spot-check of `t05-verified` (Nabhanyu's request). Not in scope: phases 1-2 cards,
room read, the inspector, story mode and the `/architecture` diagram (Task 9), deployment (Task 7).

## Plan steps

- [x] 6.0 Spot-check of `t05-verified` (Nabhanyu, before 6.1) and its four test gaps pinned (D-059).
- [x] 6.1 Store and TV clock.
- [x] 6.2 `SpoilerCard`.
- [x] 6.3 Effects and their fallbacks; `GlowInput` `data-state`.
- [x] 6.4 `InningsDotMatrix`, tabular `Scorebug`.
- [x] 6.5 Control plane.
- [x] 6.6 E2E `e2e/match-room.spec.ts`.
- [x] 6.6b `/architecture`.
- [x] 6.7 `pnpm verify` + `pnpm test:e2e` green; docs.

Beyond the PLAN's files: `apps/server` gained `GET /api/matches/:matchId` (D-060) and the BUG-004 fix
(D-063); the web app gained `components/PersonaPicker.tsx`, `broadcast/outburst.ts` (which moments light
up), `companion/suggest.ts` (the composer's suggestion), `controlplane/spoilerSafe.ts` (the control plane's
holds), `lib/useMediaQuery.ts` and `styles/effects.css`.

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
- 2026-10-17, setup: branch `task/06-frontend-core`; the room needs players, the win-probability model
  and the fantasy rules in the browser, which no Task 5 route served: `GET /api/matches/:matchId`, test
  first (D-060).
- 2026-10-17, step 6.1: the stream store (a snapshot replaces, increments are idempotent, moments upsert
  by id), the TV clock (`useTvTime` re-read every 100 ms, `foldToTv`, `useTvView`, `TvContext`) and
  `useSessionStream` (every frame validated; the server's `event: error` told apart from the browser's
  connection error), tests first on real 1298150 events: the TV shows 89/4 while the ground is at 90/4
  (F05 audit literal), and a snapshot after a jump back leaves nothing of the future.
- 2026-10-17, steps 6.2-6.3: `SpoilerCard` keeps the teaser and the outcome out of the DOM until the TV
  reaches them, with fake time through the real TV clock; the four effects start on their CSS fallbacks
  and upgrade only with WebGL2, no reduced motion and a real context (tests: no WebGL2, reduced motion
  with WebGL2, a refused context), and `GlowInput` exposes `data-state`. React's hook linter reads WebGL's
  `useProgram` as a hook: one wrapper with one suppression (`effects/webgl.ts`).
- 2026-10-17, step 6.4: the dot matrix, scorebug, over strip, commentary, win line, phase rail and
  controls; literals read off the raw Cricsheet file (innings 2 overs 17-19: fours, the 17.2 wide mark,
  the 19.4 no-ball six and wide marks before the byes off the free hit, the two wickets).
- 2026-10-17, step 6.5: the control plane; a trace's detail can quote the score after the ball (a guard
  rejection), so decisions and traces about a ball the TV has not shown are held. One commit went in with
  three lint errors: `biome check | grep` hid the exit code, the trap HANDOFF7 names; fixed forward in the
  next commit (no history rewrite) and every later check ran on its own exit code.
- 2026-10-17, pages: landing, match room, `/architecture`, the router (D-062), the API client and the
  companion cards; `markdown-it` 15.0.2 for the docs page (D-061), rendered as React elements.
- 2026-10-17, visual review in the real Chrome (dev server keyless) and headless Chrome screenshots at
  1440 and 390 px in both themes:
  - The desktop Chrome here has no GPU and no WebGL2 (CSS fallbacks shown); its window could not be
    resized below 766 px, so the 1440 and 390 px views came from Playwright, whose headless Chrome renders
    WebGL (SwiftShader).
  - Found and fixed: the floodlight invisible on the tall hero (blobs sized by width but offset by
    height); the persona cards burying the cone (the hero now holds the wordmark, the picker follows,
    D-064); phone tabs letting content show around them (one opaque sticky block); reel slides clipped at
    the card's edge (now a grid); the phase rail's scrollbar (now wraps); tables crushed at 390 px (they
    scroll in their box); the pitch graphic through the headline (the ground dims); the ghost sweep
    painting no fringes (the splat's energy scaled its velocity to almost nothing, VISUAL_REFERENCES "As
    built"); playback buttons that looked dead for a round trip (optimistic, test first).
  - **BUG-004** (major, Task 5 code): a babar-believer session (25 s feed) froze at 160/6 and never showed
    the result, because the session clock stopped when the ground was done. Fixed test first (D-063); two
    Task 5 expectations that encoded the old rule add the fan's delay. Afterwards, in headless Chrome, a
    25 s feed at 32x showed every last-over moment in turn and ended on "India won by 4 wickets" with the
    result outburst.
  - The scorebug read "Need 0 off 0" between the winning run and the innings end; fixed test first.
- 2026-10-17, step 6.6: `e2e/match-room.spec.ts` on desktop and 390 px (persona → room; 25 s delay, 16x,
  jump after 18 overs of the chase; the 18.6 card veiled with nothing of the ball in it, then revealed;
  deterministic events counted; screenshots in both themes; tabular numerals; reduced motion), and a jsdom
  match-room test with a stubbed `fetch` and `EventSource` (outbursts only for TV reveals during play, the
  reel's squad impact from the TV state). The E2E first clicked the persona's name, which the card's
  transparent radio covers; it now checks the radio by role.
- 2026-10-17, self-audit: 28 hand mutants of the web code, 24 killed; the four survivors were test gaps
  and are closed (below).

## What worked / what did not

- Holding everything on the TV clock in one place (the store plus `useTvView`) made every panel
  spoiler-safe by construction; the tests drive the TV with paused clock messages, so no fake timers are
  needed for most of them.
- Driving the real UI found what the unit tests could not: an invisible effect, an unreadable phone
  layout, controls that felt dead, and a server bug that hid the result from most personas (BUG-004).
- The motion budget held: one outburst at a time, only for balls the gate flagged, so the last over of
  the 2022 chase lights up seven times while the first nineteen overs stay calm.
- Did not work first time: a piped lint check (one bad commit, fixed forward); the hero layout from the
  sketch; the sweep's strength; an E2E click on text covered by a transparent radio.

## Decisions made

- [D-059: Spot-check of `t05-verified`](../Decisions.md#d-059--spot-check-of-t05-verified-accepted-four-test-gaps-pinned-in-task-6-2026-10-17-before-t6-claude)
- [D-060: `GET /api/matches/:matchId`](../Decisions.md#d-060--the-match-room-reads-players-rules-and-the-model-from-get-apimatchesmatchid-2026-10-17-t6-claude)
- [D-061: `markdown-it` 15.0.2 as React elements](../Decisions.md#d-061--architecture-renders-the-docs-with-markdown-it-1502-as-react-elements-2026-10-17-t6-claude)
- [D-062: A 60-line router](../Decisions.md#d-062--a-60-line-router-instead-of-a-routing-library-2026-10-17-t6-claude)
- [D-063: The session clock stops when the fan's TV has shown the end](../Decisions.md#d-063--the-session-clock-stops-when-the-fans-tv-has-shown-the-end-2026-10-17-t6-claude-amends-d-056)
- [D-064: The match room as built](../Decisions.md#d-064--the-match-room-as-built-tv-clock-spectacle-rules-held-control-plane-layout-2026-10-17-t6-claude)

## Verification (paste real output)

```text
pnpm install --frozen-lockfile
Done in 873ms using pnpm v10.34.7

pnpm verify                     (branch head)
packages/engine typecheck: Done
apps/web typecheck: Done
apps/server typecheck: Done
Checked 222 files in 480ms. No fixes applied.
 Test Files  47 passed (47)
      Tests  569 passed (569)
check-no-hardcode: OK (131 source files, 209 terms)
verify-data: OK (2 matches)
✓ built in 805ms

pnpm test:e2e
  22 passed (1.3m)

engine-report vs oracle (compare.py), spot-check
IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 11 bowler lines, 14 wickets, 22 fantasy players   (1298150)
IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 12 bowler lines, 15 wickets, 22 fantasy players   (1415755)

python3 -I scripts/oracle/audit/mutate.py <scratch copy at d217b96>
mutate: 18 killed, 0 survived

hand mutants, Task 5 server code (spot-check): 21 → 17 killed + 4 killed once their gap tests landed
hand mutants, Task 6 web code (self-audit):     28 → 24 killed + 4 killed once their gap tests landed
```

## Follow-ups (out of scope, noted for later)

1. **Task 7:** the browser assumes its clock agrees with the server's (`wallAt`); a skewed browser clock
   shifts the TV by skew × speed. The control response's clock could estimate the offset.
2. **Task 7:** "Replayed AI (recorded on <date>)" needs the recording date on the moment or the trace;
   the chip says "Replayed AI" until then.
3. **Task 9:** keyboard: the phone tabs are buttons in a tablist without arrow-key roving; the reel's
   slides are a grid (no carousel controls needed today); `aria-live` covers the feed, and Task 9's polish
   pass should check how often it speaks during a busy over.
4. **Task 9:** the `/architecture` diagram, the live "when we don't call AI" table and the plan timeline
   (D-034); this task renders the docs only.
5. The main bundle is 412 kB (127 kB gzipped), mostly react-dom and zod; marking the engine package
   `sideEffects: false` would let the bundler drop unused engine modules (the crowd simulator, detectors).
6. The jump control defaults to "2nd innings, after 18 overs", the death overs of a chase; a default from
   the TV's current position would suit a fan who is mid-innings.

## Audit notes (filled by the auditor)

**Audit, 2026-10-17, Claude, on the branch head. Verdict: accepted; merged `--no-ff`, tagged
`t06-verified`.** Caveat first: Codex was unavailable, so the same agent implemented and audited this
task (as with Tasks 3, 4 and 5); the session began with an independent spot-check of `t05-verified` (log,
D-059). An independent re-audit can repeat every check with TEST_CHECKLIST §2 and this file.

- **Verification (fresh runs):** `pnpm install --frozen-lockfile`; `pnpm verify` → 3× `typecheck: Done`,
  `Checked 222 files … No fixes applied.` (no warnings), `Test Files  47 passed (47)`,
  `Tests  569 passed (569)`, `check-no-hardcode: OK (131 source files, 209 terms)`,
  `verify-data: OK (2 matches)`, built; `pnpm test:e2e` → `22 passed`.
- **Read-only files:** since `main` (`t05-verified` plus HANDOFF7), `packages/engine`, its golden files,
  `scripts/oracle` and `data/` are unchanged; no contract changed. Server changes: one read-only route
  (D-060) and the BUG-004 fix (D-063), each test first.
- **Anti-hardcoding (§2A):** scan OK; no `hardcode-ok`; no `.skip`/`.only`; the only number hits in web
  source are a font width (82%), a 150 ms fade and a font-stretch table; comparisons are with innings 1/2
  numbering, never a label, seq or id. Match facts reach the UI only through the API.
- **Engine vs oracle (§2B):** both matches IDENTICAL (spot-check); the engine is untouched.
- **Holdout (§2C), for a UI task:** the second match (1415755), which no UI test drives, ran in Chrome:
  the Proteas fan opens at 147/4 needing 30 off 30 (PLAN 2.4's literal) with the Analyst lens, and a
  glossary question answers with "Rules only". Nothing in the web code names either match.
- **Test quality (§2D):** expectations come from the raw Cricsheet file (the dot-matrix rows), PLAN and
  F05 audit literals (89/4 and 90/4, 144/4, 16 off 6, India below 35% at 90/4), or are derived by engine
  functions that are not the unit under test (a fold for the TV-state checks). 28 hand mutants of the web
  code: 24 killed by the tests as written; the four survivors (a wicket off a six written as a six, the win
  line from the batting side in the first innings, the death overs one over late, Tab overwriting typed
  text) were gaps and now have tests that fail on them. The jsdom match-room test was shown to fail when
  outbursts fire on snapshots and when the squad impact reads the stadium state. Two of my own new test
  expectations were wrong and were corrected from the data, never from the code: "Rauf to Kohli, six" also
  matched 18.5's legitimate line, and BUG-004's first test used a feed shorter than the crowd's tail.
- **Shortcut review:** no test weakened, skipped or deleted; two Task 5 expectations changed with BUG-004
  and are named there, with the new test failing on the old code; no golden or oracle edit; nothing keyed
  to labels or ids; no hand-written AI text (every card's words come from the server, fallbacks are
  labelled "Fallback: AI unavailable", the glossary "Rules only"); no invented numbers (counters, costs,
  budgets, the projection and the win line are computed); stubs replace only the network edges (`fetch`,
  `EventSource`) and WebGL's availability.
- **Security (§2F):** no `dangerouslySetInnerHTML` or `innerHTML` anywhere (the docs page builds React
  elements from markdown-it tokens with raw HTML off); CSP unchanged, and the E2E runs against the
  production server with its CSP and fails on any console error; no key-shaped strings in
  `apps/web/dist`; `.env` untracked, mode 600, unchanged; no AI endpoint was called (keyless dev server);
  the only external URL in web source is the Cricsheet credit.
- **UI review (§2G):** Chrome: no console errors through the flows; keyboard pass on the landing page
  (skip link, wordmark, nav, theme, match, persona, Start watching, footer; visible focus on every stop,
  the radio cards outline the whole card); reduced motion checked in E2E (static floodlight, CSS ghost text,
  no canvas). Headless screenshots at 1440 and 390 px in both themes reviewed for the landing page,
  `/architecture`, the match room (catch-up, held card, reveal with the outburst and the ghost headline,
  control plane) and the result; no horizontal overflow on any view.
- **Task 6 hooks:** visual review against the references (above and VISUAL_REFERENCES "As built"); no
  outcome text in the DOM while a card is held (unit, jsdom and E2E); Lighthouse was not run (not
  installed; Task 9.5 sets the ≥ 90 target).
- **Open (not defects of Task 6):** re-run `pnpm ai:smoke` once the proxy account is topped up (owner);
  follow-ups 1-6.
