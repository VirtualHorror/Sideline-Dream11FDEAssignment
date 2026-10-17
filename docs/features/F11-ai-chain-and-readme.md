# F11: The AI chain, the replay recording and the README

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 11 in `docs/PLAN.md` (after the submission, at Nabhanyu's request)
- **Branch:** `main` (one commit, like Task 10; the public repository gets the same tracked changes as one commit)
- **Owner / session:** Claude, one session on 2026-10-17 (implemented and self-audited)
- **Status:** done; production's env file takes the Groq and Gemini keys with one `sudo deploy/install.sh`
  (Nabhanyu), and the rotated Gemini key waits on a per-link check (`pnpm ai:smoke --each-link`)

## Scope
The proxy's key has had no credit since 2026-10-17, so the live site showed only labelled fallbacks. Nabhanyu
brought free-tier Groq and Gemini keys and asked for three things: (1) an ordered AI chain, Groq's Qwen3.8 27B →
GPT-OSS 20B → Gemini 3.5 Flash-Lite → GPT-OSS 120B → Gemini 3.5 Flash (20 requests a day) → the proxy's key → the
labelled fallback, in production and in the public code, keys only in `.env` and production's env file, key prefixes
in the secret scan, then the live smoke and the replay recording; (2) the README in the shape of his Aegis README,
the old one kept; (3) the docs current, verify and E2E, one commit here and the same tracked changes as one commit on
the public repository (on `54f9e89`), a redeploy. Decisions: D-079 (the chain), D-080 (the README).

## Plan steps
- [x] 11.1 The AI chain: `chat.ts`, `chain.ts`, migration 3, the config, the contract's provider names, prices (test first).
- [x] 11.2 Keys only in `.env`; `pnpm check:hardcode` fails on key-shaped strings in tracked files.
- [x] 11.3 `pnpm ai:smoke` and `--each-link` live; `pnpm ai:record --yes`.
- [x] 11.4 The README's second version; `docs/README.v1.md`.
- [x] 11.5 Docs, `pnpm verify`, `pnpm test:e2e`, the commits, `deploy/update.sh`, the public E2E.
- [ ] 11.6 Nabhanyu: `sudo deploy/install.sh` (production's env file gets the new keys).
- [ ] 11.7 Nabhanyu: a Gemini key Google accepts.
- [x] 11.8 The rotated keys: their prefixes in the key scan; `pnpm ai:smoke` without the recorded rows (D-081).
- [x] 11.9 The README polish (D-080's update).

## Log (newest last)
- **The providers, probed before any code (zero-token listings, then a few hundred tokens a call):** Groq's model list
  has `qwen/qwen3.8-27b`, `openai/gpt-oss-20b` and `openai/gpt-oss-120b`; the owner's `gwen/qwen3.8-27b` answers 404
  `model_not_found`, so the chain uses `qwen/`. Groq's headers give the free tier: 1,000 requests a day and 8,000 tokens
  a minute per model; `max_completion_tokens` is not reserved against the minute's tokens (8,000 was accepted with
  7,329 left). Strict `json_schema` works on all three (Qwen with `reasoning_effort` `none` or `low` and
  `reasoning_format` `hidden`; GPT-OSS with `include_reasoning` false), in 256-548 ms. The Gemini key (`AQ.…`, Google's
  new kind) answers 401 everywhere: `ACCESS_TOKEN_TYPE_UNSUPPORTED` with `x-goog-api-key` (v1beta and v1) and `?key=`,
  `API_KEY_SERVICE_BLOCKED` with a bearer token on the native API, "API key not valid" on the OpenAI-compatible endpoint
  and on Vertex AI's express endpoint. Google's developer forum has many such reports from October 2026; a staff reply
  suggests a key from another project. Google's docs: `gemini-3.5-flash-lite` is stable; `gemini-3.5-flash` is no
  longer selectable and is served by `gemini-3.6-flash`.
- **Prompt sizes** (the recorder's 91 requests through the scripted provider, characters / 4): teasers about 325 tokens,
  catch-ups 785-1,436, room reads 1,237-2,047, bailouts about 1,160. At 8,000 tokens a minute, a model takes a handful
  of calls a minute: so the chain waits for a cooldown when every link is cooling and the skill's time allows.
- **Test first:** `chain.test.ts` (new; the real adapters and SDK over a scripted network), the Chat Completions
  provider in `providers.test.ts`, the chain in `config.test.ts`, migration 3 in `db.test.ts`, the served model and the
  chain's prices in `gateway.test.ts`, the new provider names in the engine's `contracts.test.ts`, the key scan in
  `check-no-hardcode.test.ts`, the chain's variables in `deploy-env.test.ts`, the chain's adapter in `boot.test.ts`,
  the served model in replay rows in `ai-record.test.ts`. Run before the code: every new test failed for the reason
  expected (missing modules, `ai.chain` undefined, `no such column: served_model`, prices of 25 per million from the
  configured fallback, `findSecrets is not a function`).
- **Changed expectations (spec changes, named here):** `db.test.ts` now expects five tables and `user_version` 3 (the
  new migration); `config.test.ts` and `deploy-env.test.ts` expect `aiChain: null` in `publicConfigSummary` for a
  provider that is not the chain (the new field); `providers.test.ts`'s request helper carries the new `tier` and
  `timeoutMs` fields; `boot.test.ts` expected 0 replay rows (no recording existed) and now counts the rows in
`data/ai-replay/*.jsonl` from the files themselves (87 after this recording; 0 again if the recording is removed). No
assertion was removed or loosened.
- **Self-review of the chain:** near the deadline a link's share of the time can be a few milliseconds, and a link
  that did not answer within it was cooled down for 15 s as if it were slow. Test first ("does not cool down a link
  that only ran out of a short share of the time", failed: the next request skipped the link), then a share under 2 s
  no longer cools a link down; it is only not asked again in that request.
- **The key scan's first run** failed on one tracked file: `scripts/test/deploy.test.ts` held a 37-character fake
  `sk-…` key. It is now assembled at run time; the test still proves the key never reaches the env file's report.
- **Verify:** `pnpm verify` green; the counts are in Verification.
- **Live smoke** (the owner's request): `pnpm ai:smoke` answered from Groq's Qwen, 368 tokens in / 27 out, 260 ms,
  spoilerLint ok; `--each-link`: Groq's three links answered (193, 464 and 398 ms, schema-valid), both Gemini links 401,
  the proxy 403 `key_expired`.
- **The recording** (`pnpm ai:record --yes`, three passes; each pass asks only for what is missing): 102 calls (78
  ok, 19 error, 5 fallback) → 78 moments; 15 calls (6 ok) → 84; 7 calls (3 ok) → 87 of the plan's 91. In all, 124
  provider calls, 132,043 tokens in and 81,972 out, $0.10 at the paid-tier list prices (the free tiers bill nothing).
  The rows: 48 teasers, 19 catch-up reels, 19 room reads and 1 bailout, written by `openai/gpt-oss-120b` (37),
  `openai/gpt-oss-20b` (34) and `qwen/qwen3.8-27b` (16). Not recorded: the 2024 final's captain bailout at 0017 and
  its first-innings room reads after overs 16, 17 and 18, whose answers the guards rejected on every pass (a
  prediction that is not a valid quest rule, pod shares adding up to 92%, a pod citing a message outside the window,
  six pods); a keyless server shows those four as labelled fallbacks. Two moments in the first pass found every link
  cooling down beyond the room read's 15 s (Groq's 429s); the second pass recorded them.
- **What the recording shows about the models:** the answers pass every guard, but the open models sometimes swap who
  did what: a 2022 catch-up slide says Mohammad Nawaz "hit 20 runs" in an over he bowled, another that Axar Patel
  "exploded for 21 runs" he conceded (and calls him Pakistan's bowler). The facts in the prompt are right; the guards
  check the shape, the citations and the spoilers, not who did what (Follow-up 3). The rows are kept as recorded
  (Constraint 2: never edited by hand).
- **Docs:** README (second version, D-080) and `docs/README.v1.md`, Decisions D-079 and D-080, Constraints 13 and 26,
  Flow §1, §8, §14, §15 and the new §18, Architecture §2, §3, §4, §5, §7 and §10, PLAN Task 11, TEST_CHECKLIST, ROLLBACK,
  the register, SUBMISSION, DEMO_SCRIPT, `deploy/README.md`, `data/README.md`, AGENTS.md, `.env.example`.
- **The follow-up: the rotated keys (D-081).** Nabhanyu revoked the first Groq and Gemini keys and brought new ones.
  `.env` holds them (mode 600, git-ignored; checked against the values given by hash, never printed), with the Gemini
  key's Cloud project as `GEMINI_PROJECT_ID`, which nothing reads. Neither pair, nor a fragment of one, was ever in a
  tracked file or a commit of either copy (`git log --all -S` on each prefix finds no commit). Test first for the
  prefixes: three tests in `check-no-hardcode.test.ts` (a fragment of each of the four keys is flagged with the kind
  of key; another key's start, the part both Google keys share and the keys in another case pass; the CLI fails on a
  fragment and never prints it) failed on the old scanner (`[]`, and the CLI exiting 0) and pass now; four hand
  mutants each fail a test. The scan finds nothing in either copy's tracked files.
- **The smoke answered from the recording.** With the new keys, `pnpm ai:smoke` printed `outcome ok, provenance
  replay, provider replay, model openai/gpt-oss-120b, latency 1 ms` and `FAILED (ok)`: `buildRuntime` reads
  `data/ai-replay` unless told otherwise, and a cache look-up serves a replay row for any model, so the teaser this
  task recorded after its own live smoke never reached the chain. Test first: `scripts/test/ai-smoke.test.ts` runs
  the real script with the provider pinned to a stand-in Responses endpoint on 127.0.0.1 (variables set in the
  environment beat `.env`, checked first) and failed (`expected [] to deeply equal [ 'POST /v1/responses' ]`); with
  `replayDir: null` it passes, and the live smoke answered from Groq's Qwen in 342 ms (368 in / 34 out, spoilerLint
  ok). Its teaser has Nawaz "facing" balls he bowled: Follow-up 3 again.
- **The rotated Gemini key, without spending quota:** Google's model listings answer 200 with it, on the
  OpenAI-compatible endpoint the chain uses and on the native one, where the first key got 401. No teaser went to
  Gemini: `--each-link` waits for Nabhanyu's go-ahead (Constraint 26).
- **The README polish (D-080's update):** the headings and phrases borrowed from the Aegis README are replaced ("What
  broke, and how I got out" and its "How I got out" and "The uncomfortable part", "The honest scoreboard" and "The
  uncomfortable numbers are the point", the lines pointing at a section and at the shot list; "The easy way out" and
  "how honestly" with them), the provider status is brought up to date (the live site does not answer from Groq until
  production has the keys), and from `docs/README.v1.md` come back the four moments by feature, the scope task by task
  with the milestones, the full command list, the deep link to the 2022 chase, the Flow sections behind the API and the
  links to the submission note and the demo script. Docs: D-080's update, D-081, Constraint 13, Architecture §5 and §7,
  Flow §8, PLAN Task 11, TEST_CHECKLIST rows 3, 4 and 12, ROLLBACK, the register, AGENTS.md.

## Verification
```text
pnpm verify (with every change staged)
packages/engine typecheck: Done / apps/web typecheck: Done / apps/server typecheck: Done
Checked 274 files in 946ms. No fixes applied.
 Test Files  60 passed (60)
      Tests  807 passed (807)
check-no-hardcode: OK (164 source files, 209 terms; 357 tracked files, no forbidden words, no keys)
verify-data: OK (2 matches)
✓ built in 895ms

pnpm test:e2e                                                          26 passed (4.4m)
  (the local server is keyless: the 18.6 card now shows "Replayed AI", data/ai-replay/1298150.jsonl exists)

pnpm ai:smoke                ai-smoke: outcome ok, provenance live, provider groq, model qwen/qwen3.8-27b,
                             latency 260 ms, tokens 368 in / 27 out, cost $0.0004 … ai-smoke: OK
pnpm ai:smoke --each-link    links 1, 2, 4 (Groq) answered in 193, 464, 398 ms, schema-valid;
                             links 3, 5 (Gemini) AuthenticationError (401); link 6 PermissionDeniedError (403, key_expired)
pnpm ai:record               plan: 4 moments need a provider call (0 teasers, 0 catch-up reels, 1 bailouts,
                             3 room reads); 87 already recorded

hand mutants (scratch script; each mutant applied, its tests run, the file restored):
  chain: no cooldown after a failure                    KILLED (8 failing)
  chain: ignores retry-after                            KILLED
  chain: a hung link gets all the time                  KILLED
  chain: never counts a capped link's requests          KILLED (2 failing)
  chain: never waits                                    KILLED
  chain: a bad answer moves on to the next link         KILLED
  chain: UTC days for the cap                           KILLED
  chat: Qwen keeps its reasoning at low effort          KILLED
  chat: thinking outside completion_tokens not counted  KILLED
  gateway: caches without the served model              KILLED (2 failing)
  gateway: the trace names the chain, not the link      KILLED
  config: the chain is not the default with a Groq key  KILLED (10 failing)
  scanner: no Groq pattern                              KILLED (2 failing)
  recorder: the configured model in replay rows         KILLED
  14 of 14 killed

deploy/update.sh (main = 514fb01)
update: {"ok":true,…,"aiProvider":"openai","aiModelFast":"gpt-6.1-sol","aiModelSmart":"gpt-6.1-sol",
         "aiEndpoint":"openai-compatible","aiChain":null}   (both names; the env file still the Task 7 one)
update: deployed 514fb01 (main) at https://3-108-67-100.sslip.io/
journalctl -u sideline: { matches: 2, analyticsRows: 502, replayRows: 87, aiMode: 'replay' }   (was replayRows: 0)
PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e     26 passed (3.8m)
PLAYWRIGHT_BASE_URL=https://sideline.nabhanyubm.tech pnpm test:e2e  26 passed (3.8m)
```
The commit after `514fb01` records this evidence (docs only: TEST_CHECKLIST and this file, which the web build does
not read), so production's code is `514fb01` and needs no redeploy for it. Production runs the chain once
Nabhanyu's `sudo deploy/install.sh` writes the new keys into its env file; `/api/health` then says
`"aiProvider":"chain"` with the `aiChain` list.

The follow-up (D-081 and the README polish):
```text
vitest run scripts/test/check-no-hardcode.test.ts   before the scanner change: Tests  2 failed | 12 passed (14)
                                                    after it:                  Tests  14 passed (14)
vitest run scripts/test/ai-smoke.test.ts            before the fix: expected [] to deeply equal [ 'POST /v1/responses' ]
                                                    after it:       Tests  1 passed (1)
hand mutants of KEY_PREFIXES (each applied, the scanner's tests run, the file restored):
  prefixes not reversed                  KILLED (2 failing)
  case-insensitive matching              KILLED
  the live Google key dropped            KILLED
  only the part both Google keys share   KILLED
  4 of 4 killed
pnpm ai:smoke (before the fix)   outcome ok, provenance replay, provider replay, model openai/gpt-oss-120b,
                                 latency 1 ms, tokens 0 in / 0 out … ai-smoke: FAILED (ok)
pnpm ai:smoke                    outcome ok, provenance live, provider groq, model qwen/qwen3.8-27b,
                                 latency 342 ms, tokens 368 in / 34 out, cost $0.0004, spoilerLint ok … ai-smoke: OK
Gemini, zero-token listings      OpenAI-compatible /v1beta/openai/models: HTTP 200; native /v1beta/models: HTTP 200
pnpm verify (with every change staged)
  Checked 275 files in 883ms. No fixes applied.
   Test Files  61 passed (61)
        Tests  811 passed (811)
  check-no-hardcode: OK (164 source files, 209 terms; 358 tracked files, no forbidden words, no keys)
  verify-data: OK (2 matches)
  ✓ built in 861ms
pnpm test:e2e                    26 passed (4.3m)
```
No redeploy: production's server code did not change; the new decision and PLAN rows reach `/architecture` with the
next `deploy/update.sh`.

## Audit notes (self-audit: Claude implemented Task 11)
- **A. Anti-hardcoding:** `pnpm check:hardcode` OK; no `hardcode-ok`; the model ids live in config (`DEFAULT_AI_CHAIN`)
  and the price table, not in any match logic; the reasoning options are keyed to model families (`qwen/`,
  `openai/gpt-oss`), which is the providers' API, not match data.
- **Tests:** literal expectations (link order, cooldown lengths, the Pacific-day boundaries in October and December,
  exact request bodies, the exhausted summary's text, list-price costs); the links are the real adapters over a
  scripted network, so a 429 is the SDK's own error with its headers.
- **Hand mutants:** 14 of 14 killed (Verification).
- **Security:** keys only in `.env` (mode 600) and production's root-only env file; `publicConfigSummary` gains the
  chain's links (endpoint kind, models, cap) and no key or host; a trace names statuses and error codes, never a
  provider's message (a Groq 429's message names the organisation); the key scan covers every tracked file.

## Follow-ups (out of scope, noted for later)
1. **A working Gemini key** (Nabhanyu): every Gemini endpoint answered the first `AQ.` key with 401. The rotated key
   authenticates (D-081); `pnpm ai:smoke --each-link` shows whether both Gemini links answer a teaser, and nothing in
   the code changes.
2. **`sudo deploy/install.sh`** (Nabhanyu) so production's env file gets `GROQ_API_KEY` and `GEMINI_API_KEY` (the
   rotated pair); until then production runs the proxy's key (403) and serves the recorded answers.
3. **Who-did-what in recorded answers:** a guard that checks a slide's or teaser's player names against the cited
   events' batter and bowler (code, not a model) would catch the bowler/batter swaps above; or the smart-tier skills
   could start the chain at a stronger link. Either needs a prompt version bump and a fresh recording.
4. **Pass over a link before its 429:** Groq reports the minute's remaining tokens (`x-ratelimit-remaining-tokens`); the
   chain could skip a link whose remainder is below the request's size instead of learning it from a 429.
5. **Prices:** `gemini-3.6-flash` (which serves `gemini-3.5-flash`) goes from $0.75 / $3.75 to $1.50 / $7.50 per million
   tokens on 2027-01-01 (Gemini's pricing page); `pricing.ts` holds today's.
