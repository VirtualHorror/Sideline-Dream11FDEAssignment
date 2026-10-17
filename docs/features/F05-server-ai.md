# F05: Server runtime, AI gateway, first skills (sessions, SSE, gateway, teaser, catch-up, explainer)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 05 in `docs/PLAN.md`
- **Branch:** `task/05-server-ai`
- **Owner / session:** Claude, implementing in place of Codex at Nabhanyu's request, then auditing, 2026-10-16
- **Status:** audited and merged (`t05-verified`)

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

- [x] Spot-check of `t04-verified` (Nabhanyu, before 5.0) and its two test gaps pinned (D-051).
- [x] 5.0 `config.test.ts` (extend).
- [x] 5.1 `bundle.test.ts` (+ `db.test.ts` for the SQLite schema and analytics).
- [x] 5.2 `sessions.test.ts`.
- [x] 5.3 `stream.test.ts`.
- [x] 5.4 `gateway.test.ts`.
- [x] 5.5 `skills.test.ts`.
- [x] 5.6 `orchestrator.test.ts`.
- [x] 5.7 `routes.test.ts`.
- [x] 5.8 `telemetry.test.ts`.
- [x] 5.9 `scripts/ai-smoke.ts`.
- [x] 5.10 `pnpm verify` green; docs.

Beyond the PLAN's files: `src/runtime.ts` (assembles the runtime for `index.ts` and the smoke script),
`src/data/glossary.ts`, `src/ai/providers/types.ts`, `src/ai/skills/format.ts`, `src/http/routes/*`
one file per route group, and tests `db.test.ts`, `providers.test.ts`, `boot.test.ts`; the engine
exports `situationOf` (test first).

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
- 2026-10-16, setup: branch `task/05-server-ai`; `@anthropic-ai/sdk` 0.131.0 and `openai` 7.27.0,
  the newest versions at least 14 days old (D-052). The first commit went in with a formatting error:
  `pnpm lint | tail` hid lint's exit code in a chained command. Fixed in a follow-up commit (no history
  rewrite); every later check ran under `set -o pipefail`.
- 2026-10-16, step 5.0: 12 new config cases failed on the missing fields, then passed. Two existing
  OpenAI tests now name the model variables the provider requires (assertions unchanged). One of my own
  cases was wrong (it spread the proxy env, model names included, into the "both keys" case) and
  showed a real footgun: today's `.env` names gpt-6.1-sol, so adding an Anthropic key would send that
  name to Anthropic. A non-Claude name with the Anthropic provider now fails the boot (D-058); its test
  was shown to fail with the check neutered.
- 2026-10-16, step 5.1: bundles from the manifest through the engine's schemas, join points checked,
  the crowd simulated once per match (D-050); SQLite tables and the analytics rebuild (the 18.6 six's
  leverage 0.4100 matches the Python re-derivation). Both demo chases ran all 20 overs, so the
  join-point check is tested on a truncated timeline.
- 2026-10-16: `AICallTrace` gains `costEstimated` and `detail` (D-053, contract tests first).
- 2026-10-16, step 5.4: 16 gateway tests on a minimal echo skill (the gateway is the unit), first
  failing on the missing modules: cache hit, in-flight dedupe, the six failure paths with their
  outcomes and details, budget (daily, carried spend, session cap), a provider that ignores its abort,
  replay rows.
- 2026-10-17, step 5.5: Nabhanyu's instruction for this task (outcomes never reach teaser prompts) made
  the teaser's model output `{ nudge }` only, with a code-built reveal (D-055). 46 glossary terms
  checked against DOMAIN. The "no outcome in any teaser prompt" test first failed on my own check (the
  19.4 no-ball's leverage is exactly 1, and "1" is everywhere): replaced by a stricter allow-list of
  the keys the model sees. The two guards were written before their tests; neutering each one fails
  1-11 tests (5 of 5 caught).
- 2026-10-17, steps 5.2 and 5.6: sessions, manager, ticker, orchestrator, test first. Two test windows
  were wrong and were fixed from data, never from engine output: the ball after an over's end comes
  about 89 s later (34 s + 55 s over break), and the chase has no big ball between overs 14 and 18
  (the spot-check's list: 1.5, 3.2, 5.3, then 18.6 on), so the jump test plays to 19.1. A comparison
  session that kept playing made new teaser calls and confused a count: counted by key, and paused.
- 2026-10-17, step 5.8: the projection printed `100.0000%` for 99.9999991% (a real bug, fixed test
  first); an eviction test evicted before anything happened (the over-break gap again).
- 2026-10-17, steps 5.3 and 5.7: the HTTP layer. The SSE test helper first lost frames (a read abandoned
  to a timeout swallows its chunk, and a 50 ms heartbeat kept the stream busy); it now keeps one read
  pending and moves the clock after every read.
- 2026-10-17: providers through the real SDKs with a fake `fetch` (exact request bodies, refusals,
  unusable output, a typed 429 recorded as `provider error: RateLimitError (429)`, no hidden retries).
- 2026-10-17: boot wiring (`runtime.ts`, `index.ts`). The server was run keyless on a spare port and
  watched with `curl -N`: health, matches, a late-from-work session jumped to 18 overs at 32x (hello in
  replay mode, a snapshot with both catch-up reels, events, the shared crowd, telemetry), ask (glossary:
  deterministic; contextual: a labelled fallback quoting the glossary), telemetry, security headers,
  a 281-character question (400), a clean SIGTERM shutdown.
- 2026-10-17, step 5.9: `pnpm ai:smoke` checked on its skip path and against a local stand-in for a
  Responses endpoint (no tokens spent): strict `json_schema` named `spoiler_nudge`, OK, $0.0233 (est.)
  for 4,512 + 38 tokens.
- 2026-10-17, self-review: a browser reconnecting to a stopped session was not told (fixed test
  first); five behaviours had no test (the provider schema stripping, cache rows per model, the exact
  12-ball catch-up threshold on a jump, the clock stopping at the end, moments streamed live); tests
  added, each passing on the code.
- 2026-10-17: 53 hand mutants of the Task 5 code (scratch copy): 49 killed. Three survivors were real
  gaps and now have tests: the tick streamed a produced moment that a jump back had put in the future
  (a future leak in the live stream, Review focus 1); a glossary answer counted as a personal moment in
  the projection; telemetry's fallback count was never compared with the gateway's (the full replay had
  none). The fourth is equivalent (below).
- 2026-10-17: Task 5 holdout, whole sessions over 1298158 (Zimbabwe v Pakistan 2022) from a scratch data
  dir: 23 teasers, exactly the engine gate's 23 keys; no teaser prompt carried an outcome; telemetry
  equal to the gate's counters (261 events, 228 deterministic, 34 triggers); the late joiner's reel
  `catchup:1298158:2:0-14:f1` with the raw file's 88/5 and 43 needed off 36; keyless, 23 labelled
  fallbacks, none rejected by `spoilerLint`.
- 2026-10-17: `pnpm ai:smoke` against the real proxy endpoint, once, with Nabhanyu's approval: the
  gateway fell back correctly, but the endpoint answered **403** in 365 ms (0 tokens). Local evidence (no
  request): base URL, key (the same as Codex's `proxy_API_KEY`, compared by hash) and models were
  right. With a second approval, two zero-token listings (`GET /v1/models`, the SDK and plain `fetch`)
  both got **503** `proxy_error` / `service_unavailable`, so the cause was not our client; Nabhanyu
  then confirmed the proxy account is **out of credit** and asked to keep the same key. The trace had
  said only `PermissionDeniedError (403)`: it now keeps the body's machine-readable error code too
  (test first). The smoke run is to be repeated when the account is topped up.

## What worked / what did not

- Test first, with a scripted provider and an injected clock, made every AI path (late answers at 32x,
  dedupe across sessions, each failure) testable without a key, and the whole server suite runs in
  about 9 s.
- The owner's rule simplified the teaser: a model that never sees the outcome cannot leak it, and a
  code-built reveal cannot hallucinate it. The linter stays as defence in depth.
- Every wrong expectation was mine and came from an assumption about the data (timing gaps, where the
  big balls are, a leverage of exactly 1); each was fixed from the raw file or the spot-check's
  independent lists, not from engine output.
- Did not work first time: a piped lint check hid a failure (one bad commit, fixed forward); the SSE
  test helper lost frames; the projection's percentage rounded up to 100.
- Known limits: the explainer has no outcome linter (a model that recognises a famous match may know
  its result; prompts forbid using it); numbers written as words escape the teaser linter's number
  check; the SSE queue per connection is unbounded.

## Decisions made

- [D-050: One synthetic crowd per match (Nabhanyu)](../Decisions.md#d-050--one-synthetic-crowd-per-match-seeded-with-the-match-id-2026-10-16-before-t5-nabhanyu)
- [D-051: Spot-check of `t04-verified`](../Decisions.md#d-051--spot-check-of-t04-verified-accepted-two-test-gaps-pinned-in-task-5-2026-10-16-before-t5-claude)
- [D-052: The provider SDKs and their versions](../Decisions.md#d-052--the-provider-sdks-anthropic-aisdk-01310-and-openai-7270-2026-10-16-t5-claude)
- [D-053: `AICallTrace` gains `costEstimated` and `detail`](../Decisions.md#d-053--aicalltrace-gains-costestimated-and-detail-2026-10-16-t5-claude)
- [D-054: The AI gateway and providers as built](../Decisions.md#d-054--the-ai-gateway-and-providers-as-built-2026-10-17-t5-claude)
- [D-055: Teasers: the model writes only the teaser (Nabhanyu + Claude)](../Decisions.md#d-055--teasers-the-model-writes-only-the-teaser-the-reveal-is-the-scorecard-2026-10-17-t5-nabhanyu--claude)
- [D-056: Sessions, catch-ups and moments as built](../Decisions.md#d-056--sessions-catch-ups-and-moments-as-built-2026-10-17-t5-claude)
- [D-057: The explainer](../Decisions.md#d-057--the-explainer-glossary-first-the-fans-tv-as-the-facts-2026-10-17-t5-claude)
- [D-058: Smaller Task 5 choices](../Decisions.md#d-058--smaller-task-5-choices-2026-10-17-t5-claude)

## Verification (paste real output)

```text
pnpm verify                     (branch head)
packages/engine typecheck: Done
apps/web typecheck: Done
apps/server typecheck: Done
Checked 165 files in 447ms. No fixes applied.
 Test Files  37 passed (37)
      Tests  492 passed (492)
check-no-hardcode: OK (86 source files, 209 terms)
verify-data: OK (2 matches)
✓ built in 292ms

pnpm test:e2e
  8 passed (13.3s)

python3 -I scripts/oracle/audit/mutate.py <scratch copy at e50b0d3>
mutate: 18 killed, 0 survived

hand mutants of the Task 5 code (scratch copy): 53, then 1 more for the error-code label
49 killed + 3 killed once their gap tests landed + 1 = 53 killed, 1 equivalent

engine-report vs oracle (compare.py)
IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 11 bowler lines, 14 wickets, 22 fantasy players   (1298150)
IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 12 bowler lines, 15 wickets, 22 fantasy players   (1415755)

pnpm ai:smoke                   (real endpoint, 2026-10-17, approved by Nabhanyu)
ai-smoke: provider openai, endpoint api.proxy.pro, model gpt-6.1-sol
ai-smoke: teaser for 1298150 innings 2, ball 19.4 (leverage 1.000)
ai-smoke: nudge "India need 13 off 3. Kohli (76 off 51) faces Nawaz."
ai-smoke: outcome error, provenance fallback, model gpt-6.1-sol, latency 365 ms, tokens 0 in / 0 out, cost $0.0000
ai-smoke: spoilerLint ok
ai-smoke: FAILED (error: provider error: PermissionDeniedError (403))
(the proxy account is out of credit; the nudge above is the labelled template)

pnpm ai:smoke                   (a local stand-in for a Responses endpoint, no tokens)
ai-smoke: provider openai, endpoint 127.0.0.1, model fake-model
ai-smoke: teaser for 1298150 innings 2, ball 19.4 (leverage 1.000)
ai-smoke: outcome ok, provenance live, model fake-model, latency 44 ms, tokens 4512 in / 38 out, cost $0.0233 (est.)
ai-smoke: spoilerLint ok
ai-smoke: OK
```

## Follow-ups (out of scope, noted for later)

1. **Task 6:** the catch-up payload has no squad impact (it is per-session, Constraint 11): the client
   computes it beside the reel from its own folded state and the persona's squad (`fantasyPoints`,
   `squadPoints`). The reel reveals when the fan's TV reaches the join point, up to `delay` seconds
   after joining: show a thinking state meanwhile (D-033).
2. **Task 6:** every teaser's `phase` is `climax`, including big balls early in an innings; the UI may
   want to place them by over instead.
3. **Task 7:** Caddy must pass `X-Forwarded-For` (its default) for per-address limits to see clients
   (the server trusts it only from loopback). `pnpm ai:record` should write `data/ai-replay/*.jsonl`
   lines `{ key, promptVersion, model, output }`, the loader's schema.
4. **Task 8:** lineup patch, bailout and room-read triggers reach the gate and telemetry but no skill
   yet; the orchestrator is where their skills plug in. Consider an outcome linter for explainer answers
   (D-057's residual risk).
5. The SSE queue per connection is unbounded (a stalled client); fine for the demo, revisit with a cap
   and a resync.
6. `spoilerLint` checks digits only; number words ("five balls left") are left to the phrase list.

## Audit notes (filled by the auditor)

**Audit, 2026-10-17, Claude, on the branch head. Verdict: accepted; merged `--no-ff`, tagged
`t05-verified`.** Caveat first: Codex was unavailable, so the same agent implemented and audited this
task (as with Tasks 3 and 4); the session began with an independent spot-check of `t04-verified` (log,
D-051). Every check below ran on real output; an independent re-audit can repeat them with
TEST_CHECKLIST §2 and this file.

- **Verification (fresh runs):** `pnpm install --frozen-lockfile`; `pnpm verify` → 3× `typecheck: Done`,
  `Checked 165 files … No fixes applied.`, `Test Files  37 passed (37)`, `Tests  492 passed (492)`,
  `check-no-hardcode: OK (86 source files, 209 terms)`, `verify-data: OK (2 matches)`, built;
  `pnpm test:e2e` → `8 passed`.
- **Read-only files:** since `t04-verified`, `packages/engine/test/golden`, `scripts/oracle`, `data/models`
  and `data/raw` are unchanged. The engine changed only by the `AICallTrace` fields (D-053, contract
  tests first) and the `situationOf` export (test first).
- **Anti-hardcoding (§2A):** scan OK; no `hardcode-ok`; no `.skip`/`.only`; no comparison with a label,
  seq number or id in server source. Numbers in it are schema limits (160 is the payload's teaser cap),
  token caps, HTTP statuses and decision numbers in comments. Every system prompt, the lens
  instructions and the glossary were read for match-specific wording: none; facts are interpolated.
- **Engine vs oracle (§2B):** both demo matches IDENTICAL (`compare.py`).
- **Holdout (§2C):** the detectors on 1298158 and 1512763 in the spot-check (log), and whole sessions over
  1298158 through the server modules: the engine gate's 23 teaser keys exactly, no outcome in any teaser
  prompt, telemetry equal to the gate's counters, the late joiner's reel citing the raw file's 88/5 and 43
  off 36, keyless fallbacks all passing the linter.
- **Test quality (§2D):** expectations come from DOMAIN, the raw file and the spot-check's independent
  Python lists (90/4 and 70 off 36; 138/4 with Kohli on 68 before the 18.6 six, 74 and 144/4 after it;
  89/4 on a 15-second-delayed TV after 13.5; 23 teasers; 251 deliveries a match), never from the code under
  test. `mutate.py` → `18 killed, 0 survived`. 54 hand mutants of the new code: 53 killed (three after
  their gap tests landed). The survivor removes the catch-up skill's `squadImpact` destructuring; the
  prompt builder copies an explicit field list and never reads it, so it is equivalent, and the sentinel
  test still guards a builder that would serialise the whole facts. The two guards, written before their
  tests, fail 5 of 5 neutered variants.
- **Shortcut review:** no test weakened, skipped or deleted (two config tests gained the model variables
  that 5.0 makes required; their assertions are unchanged); no golden or oracle edit; nothing keyed to
  labels; the scripted provider replaces only the model (gateway, skills, sessions and both SDKs are
  real; the providers are tested through their SDKs with a fake `fetch`); fallbacks are labelled
  templates from the same facts, used on failure or without a key; the glossary is authored,
  deterministic and labelled as such (`source: glossary`, provenance `deterministic`).
- **Security (§2F):** CSP, `nosniff` and `DENY` on API responses of the live server; `.env` untracked,
  mode 600, unchanged; no key-shaped strings in `apps/web/dist`; the key's first 8 characters in none of
  the captured outputs (server log, stream, verify, E2E); 400, 413 and 429 tested; X-Forwarded-For
  counts only from loopback; provider messages never copied into traces (codes only).
- **Task 5 hooks:** the server watched keyless with `curl -N` (log); every prompt read; the budget
  cut-off tested (carried daily spend, the session cap); `pnpm ai:smoke` run once with Nabhanyu's
  approval: the proxy account is out of credit (403, then 503 on two approved zero-token listings),
  the gateway fell back correctly, and traces now carry the provider's error code.
- **Open (not defects of Task 5):** re-run `pnpm ai:smoke` once the account is topped up (Task 7's
  `ai:record` needs a working provider); follow-ups 1-6.
