# Test checklist: what to run before anything counts as done

> AI claiming success and code actually working are two different facts. Every command here has
> an expected output. Paste the real output lines into the HANDOFF, not a summary of them.
> Baselines are updated by the task that changes them.

## 0. Environment

| Command | Expected |
| --- | --- |
| `node --version` | `v24.22.0` (from `~/.local/bin`; see D-005) |
| `pnpm --version` | `10.34.7` |
| `pnpm install --frozen-lockfile` | ends with `Done in …`, no `ERR` lines |

## 1. Every change, every task (must all pass)

| # | Command | Expected (baseline after Task 7) |
| --- | --- | --- |
| 1 | `pnpm typecheck` | `packages/engine typecheck: Done`, `apps/server typecheck: Done`, `apps/web typecheck: Done`, then no output from root `tsc`; exit 0 |
| 2 | `pnpm lint` | `Checked N files in …ms. No fixes applied.` and no `×` or `!` diagnostics; exit 0 |
| 3 | `pnpm test` | `Test Files  47 passed (47)` and `Tests  569 passed (569)`; no failed, no skipped |
| 4 | `pnpm check:hardcode` | `check-no-hardcode: OK (131 source files, 209 terms; @TRACKED@ tracked files, no forbidden words)` (counts grow with code/data; the second pass fails on the AI proxy's name in any tracked file, D-068) |
| 5 | `pnpm check:data` | two `sha256 ok` lines, then `verify-data: OK (2 matches)` |
| 6 | `pnpm build` | `✓ built in …` |
| 7 | `pnpm test:e2e` (any UI-visible change) | `22 passed` (desktop + mobile: every route, the climax flow with a held then revealed teaser, tabular numerals, reduced motion); about 1.5 min. The local server is always keyless (`SIDELINE_AI_PROVIDER=none`) |
| 8 | `grep -rnE "\.(skip\|only)\(" --include=*.ts --include=*.tsx packages apps scripts e2e` | no output |
| 9 | `git status --short` | only files the task intended to change |
| 10 | `node scripts/engine-report.ts <raw.json> --players <players.json> --rules <rules.json> --json` | JSON scorecard, fall-of-wicket ids and fantasy report; compare with the Python oracle on both fixtures |
| 11 | `node scripts/build-models.ts --zip <saved t20s_male_json.zip>` (Task 3+, when `scripts/build-models.ts`, `scripts/lib/archive.ts`, the engine or `data/` change) | `build-models: … used (train …, test …)` and `wrote …`; then `git status --short data/models` prints nothing when the zip's sha256 equals the one in `data/models/README.md` (2026-10-16: `95305bc2…860a`, 3,093 used, threshold 0.18437). A new archive changes the files: review the diff |
| 12 | `pnpm ai:smoke` (Task 5+, with a key in `.env`; spends a few thousand tokens and sends one ball's facts to the provider: ask Nabhanyu first) | `ai-smoke: provider …, endpoint <kind>, model …`, `ai-smoke: outcome ok, provenance live, …, latency … ms, tokens … in / … out, cost $… (est.)`, `ai-smoke: spoilerLint ok`, `ai-smoke: OK`; with no provider (or `SIDELINE_AI_PROVIDER=none`): `ai-smoke: skipped (…)`. The key is never printed. 2026-10-17: `FAILED (error: provider error: PermissionDeniedError (403))`: the proxy account was out of credit (Nabhanyu); re-run when it is topped up |
| 13 | Server by hand (Task 5+): `PORT=8788 node apps/server/src/index.ts` (no `--env-file`: keyless, aiMode `replay`), then `curl -s -X POST -H 'content-type: application/json' -d '{"matchId":"1298150","personaId":"late-from-work"}' :8788/api/sessions` and `curl -N :8788/api/sessions/<id>/stream` | the boot line with `aiMode: 'replay'`, `analyticsRows: 502`; the stream starts `event: hello`, `event: snapshot` (249 events and 2 catch-up reels after a jump to 18 overs), then `events`, `chat`, `telemetry` frames with `id:` rising by one; SIGTERM prints `shutting down` and frees the port |
| 14 | Dev server by hand (Task 6+): `SIDELINE_AI_PROVIDER=none pnpm dev`, open `http://127.0.0.1:5173` | the server logs `aiProvider: 'none'`, `aiMode: 'replay'`; the landing page lists both matches; "Late from work" opens at 90/4 with its catch-up reel revealed once the 15 s feed reaches the join point; at 16x with a 25 s delay, a jump to after 18 overs of the chase shows the 18.6 card held under the veil, then revealed with the floodlight outburst and the "Six" headline on the TV; the scorebug ends on the result |
| 15 | Deploy dry runs (Task 7+): `deploy/install.sh --dry-run`, `deploy/update.sh --dry-run [ref]` | every step and file listed, the env report naming variables only (`deploy-env: copied OPENAI_API_KEY, …`), ending `dry run: nothing was changed`; `scripts/test/deploy.test.ts` proves no host-changing command runs |
| 16 | `pnpm ai:record` (Task 7+; without `--yes` nothing is sent) | `ai-record: plan: 67 moments need a provider call (48 teasers, 19 catch-up reels); 0 already recorded in …/data/ai-replay`. With `--yes` it spends money: ask Nabhanyu first (Constraint 26) |
| 17 | `deploy/update.sh <ref>` (the auditor, after a merge; as the developer, no password) | `update: health: http://127.0.0.1:8780/api/health` and each site's health body with `"aiEndpoint":"openai-compatible"`, then `update: deployed <sha> (<ref>) at https://3-108-67-100.sslip.io/` |
| 18 | `PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e` (Task 7+) | `22 passed` against production (with a key that fails, the climax card shows `Fallback: AI unavailable`) |
| 19 | Public origin (Task 7+): `curl -sI https://<host>/`; `curl -sI http://<host>/`; a session's `curl -sN https://<host>/api/sessions/<id>/stream` | `HTTP/2 200` with the CSP, `x-frame-options: DENY`, `nosniff`, `strict-transport-security`; `308` to https; the stream's first byte in well under a second with `event: hello` and `event: snapshot` |

`pnpm verify` runs rows 1-6 in order and stops at the first failure.

## 2. Audit protocol (Claude, after every implementer task)

### A. Anti-hardcoding
1. `pnpm check:hardcode` passes.
2. `grep -rn "hardcode-ok:" apps packages` and justify every hit (expected today: none).
3. Read the diff for logic keyed to this match: comparisons with specific over numbers, labels,
   sequence numbers or ids (`over === 18`, `seq === 414`, `label === "19.4"`), lookup tables of
   outcomes, or golden numbers in source:
   `grep -rnwE "159|160|176|169|82|76|168|150" packages/*/src apps/*/src` (each hit must be explainable).
4. Prompts and fallback templates must interpolate facts; any sentence that only makes sense for
   one match is a failure.

### B. Engine vs oracle (from Task 2 on)
```
node scripts/engine-report.ts data/raw/cricsheet/<id>.json --players data/matches/<id>/players.json --rules data/rules/t20-fantasy.json --json > /tmp/engine.json
python3 -I scripts/oracle/cricsheet_oracle.py data/raw/cricsheet/<id>.json --players data/matches/<id>/players.json --rules data/rules/t20-fantasy.json --json > /tmp/oracle.json
```
Totals, extras, every batting/bowling line, fall of wickets and every player's fantasy total must
be identical. The comparison script is the auditor's, not the implementer's:
`python3 -I scripts/oracle/audit/compare.py <raw.json> /tmp/engine.json /tmp/oracle.json` (read-only
for implementers like the rest of `scripts/oracle/`; see `scripts/oracle/audit/README.md`).
Compare oracle output as data, not bytes: its `fantasy` key order changes between runs.

### C. Holdout match (from Task 2 on)
Pick a Cricsheet T20 the implementer has never seen (any other game in
`icc_mens_t20_world_cup_male_json.zip`), generate throwaway fixtures, and run B on it. From Task 4
on, also run the detectors and check that triggers land on sensible balls (cheap captain
dismissals, the biggest win-probability swings), not on the demo match's labels. The Task 4 audit
did this on 951373 and 951353 (F04 audit notes): build the timeline from `gen_fixtures.py`
fixtures, give a synthetic pre-match persona the two innings' first strikers as captain and
vice-captain, give every player an audit-only priors entry (no appearances, one role mean), simulate
the crowd, replay every event through `createGate` with all four detectors, and check that every
one of the biggest |WP swings| has a teaser, that the match's last ball is `match_decided`, that
bailouts follow only cheap early dismissals, and that the deterministic share stays above 0.80.
From Task 5 on, also run whole sessions over a holdout: copy `data/` to a scratch dir, add the
match's raw file and `gen_fixtures.py` fixtures to its manifest with two audit personas (pre-match
with the first strikers as captain and vice-captain; joining after 14 overs of the chase) and
audit-only priors, then drive the server modules with the scripted provider: the session's teaser
keys must equal an independent `createGate` replay, no teaser prompt may contain the outcome, the
late joiner's catch-up prompt must carry the raw file's situation, telemetry must equal the gate's
counters, and keyless every teaser must be a fallback that passes `spoilerLint` (Task 5 audit: 1298158).
From Task 3 on, rebuild `data/models` from the recorded zip (row 11) and plot or print a holdout
match's win-probability trajectory: it should start near the first-innings base rate, move with
wickets and boundaries, and end at 1 for the winner.

From the Task 2 audit on, sweep the whole archive rather than one match:
`scripts/oracle/audit/run_sweep.sh <fresh-raw-dir> <scratch-dir>` runs B on every match with
synthesized fixtures, then re-derives the timeline and reducer rules independently
(`check_spec.py`). The baseline and the exact commands are in `scripts/oracle/audit/README.md`.
An implementer may try any single match; the sweep covers the ones they did not.

### D. Test quality
- New tests assert behaviour with hand-derived or oracle-derived literals, never values computed
  by the code under test.
- Mutation spot check: change one constant or branch in new source code; at least one test must fail.
- Both matches are covered wherever the engine is touched.
- Standing mutant table: `python3 -I scripts/oracle/audit/mutate.py <scratch copy of the repo>`
  (never the working repo). Baseline at `t02-verified`: `12 killed, 6 survived`; from Task 3 step
  3.0 on (`t03-verified`, `t04-verified`): `18 killed, 0 survived`. The table covers Task 2 code;
  mutate new code by hand (Task 3's audit: winprob terminal rules, leverage spectacle, priors
  formula, archive filters; Task 4's: 48 mutants over the clocks, buffer, commentary, join points,
  every detector, the gate, quests, crowd and PRNG, 47 killed, the survivor equivalent in practice,
  listed in F04's audit notes; Task 5's: 54 mutants over the gateway, budget, pricing, cache, skills,
sessions, manager, orchestrator, telemetry, HTTP limits, providers and config, 53 killed, the survivor
equivalent, listed in F05's audit notes).

### E. Docs currency
Feature file complete (scope, what was tried, what worked, verification output), Flow.md flows
moved from PLANNED to BUILT, Architecture status updated, Decisions added for new choices,
this checklist's baselines updated, ROLLBACK row added, `docs/Bug_Feature.md` register updated,
README status line and code module maps (e.g. `packages/engine/src/index.ts`) current.

### F. Security (from Task 5 on)
- `curl -sI http://127.0.0.1:8787/` shows the CSP, `x-frame-options: DENY`, `nosniff`.
- `grep -rE "sk-ant|sk-proj|sk-[A-Za-z0-9]{20}" apps/web/dist` finds nothing.
- `git ls-files .env` prints nothing and `stat -c %a .env` prints `600` (the real key lives only there
  and, after Task 7, in `/etc/sideline/sideline.env`).
- The key value never appears in logs: grep server output for the first 8 characters of the key
  (read from `.env` in a subshell, never echoed) → no matches.
- Rate limit and budget behaviour exercised by tests; oversized input rejected with 400 (a 281- or
  10,000-character question) or 413 (a body over 16 KB); X-Forwarded-For counts only from a loopback
  peer (Task 5: `routes.test.ts`).
- Prompts: no teaser prompt carries a ball's outcome, no shared prompt a fan's squad, and fan text
  sits escaped inside `<fan_question>` (Task 5: `skills.test.ts`, and the holdout run above).
- NL→SQL: write statements, `ATTACH`, `PRAGMA`, recursive CTEs and multi-statements are refused (Task 8).
- Production (Task 7+): the public origin sends the same headers over HTTPS (row 19); `/api/health` shows
  `aiEndpoint` (the kind) and never a host or key (D-068); `ls /etc/sideline` is denied to the developer
  (root 700, the file 600); the service journal has no line with the key's first 8 characters; five asks
  with five spoofed `X-Forwarded-For` values from one client: the fifth answers 429 (Caddy replaces the
  header, D-066); the public bundle has no key-shaped string.

### G. UI review (UI tasks)
- `pnpm test:e2e`, then look at `test-results/**/*.png` (desktop + 390 px, light + dark).
- In Chrome: no console errors; keyboard-only pass (Tab order, visible focus); emulate
  `prefers-reduced-motion: reduce` and confirm effects stop or simplify; attribution visible.
- Spoilers (Task 6+): while a card is held, nothing of its ball is in the DOM (search the page for the
  reveal text and the score after the ball), and the control plane holds that ball's rows too.
- Effects in WebGL: a browser without a GPU may have no WebGL2 (the Task 6 review's desktop Chrome had
  none, so it showed the CSS fallbacks); headless Chrome through Playwright renders WebGL with SwiftShader.
  Check that the landing wordmark fringes under the pointer, that a held card's veil dissolves on the
  reveal, and that the TV headline sweeps (`data-render="webgl"` on `[data-effect]`). Playwright's
  screenshots of WebGL canvases log "GPU stall due to ReadPixels" warnings: the readback's, not the app's.

## 3. Task log (actual results at merge)

| Task | Verified on | Typecheck | Lint | Unit tests | Hardcode | Data | Build | E2E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 Foundation | 2026-10-16 | pass | pass (64 files) | 9 files / 65 tests | OK (25 files, 209 terms) | OK (2 matches) | 297 ms | 8 passed |
| T2 Cricket core | 2026-10-16 | pass | pass (78 files) | 13 files / 106 tests | OK (32 files, 209 terms) | OK (2 matches) | 239 ms | 8 passed |
| T3 Models | 2026-10-16 | pass | pass (89 files) | 18 files / 183 tests | OK (36 files, 209 terms) | OK (2 matches) | 270 ms | 8 passed |
| T4 Moments engine | 2026-10-16 | pass | pass (113 files) | 25 files / 337 tests | OK (51 files, 209 terms) | OK (2 matches) | 641 ms | 8 passed |
| T5 Server runtime + AI | 2026-10-17 | pass | pass (165 files) | 37 files / 492 tests | OK (86 files, 209 terms) | OK (2 matches) | 292 ms | 8 passed |
| T6 Frontend I | 2026-10-17 | pass | pass (222 files) | 47 files / 569 tests | OK (131 files, 209 terms) | OK (2 matches) | 805 ms | 22 passed |
