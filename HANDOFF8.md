# Handoff: Task 7, Deploy (Milestone A): Caddy + systemd, replay recording, public E2E

**Generated**: 2026-10-17 17:09 IST (by Claude Code, which implemented Task 6 in Codex's place and then audited it)
**Branch**: `main`, clean (this file is committed on top of `9d65a2f`). Task 6 is merged and tagged `t06-verified` (`9d65a2f`). Create `task/07-deploy` from `main`.
**Status**: Ready for implementation. **One owner blocker for step 7.3**: the AI key in `.env` (proxy) is out of credit, and `pnpm ai:record` needs a working provider.

## Goal

Sideline is an AI second-screen companion for live cricket (Dream11 FDE intern assignment by
Nabhanyu). Implement **Task 7 only** from `docs/PLAN.md`: a stable public HTTPS link (Caddy + sslip.io +
systemd on this EC2 host) that works with or without an API key, the `pnpm ai:record` replay cache, and
the public E2E run. This is **Milestone A**, the submittable link. Claude audits afterwards; you do not merge.

## Completed

- [x] Tasks 1-5 (`t01`-`t05-verified`).
- [x] An independent spot-check of `t05-verified` (this session): verify, E2E, oracle diff, `mutate.py` 18/18,
  a keyless live run of the API, 21 fresh server mutants (17 killed; the four gaps now have tests, D-059).
- [x] Task 6, the UI (`t06-verified`; record `docs/features/F06-frontend-core.md`):
  - landing (floodlit hero, ghost-text wordmark, persona picker), `/match/:matchId?persona=<id>`, `/architecture`;
  - the match room folds the SSE stream on the fan's own delayed TV clock: TV pane (scorebug, dot matrix,
    win line, commentary, controls; outbursts only for big balls revealed on the TV), companion (held
    spoilers under the dither veil, catch-up reels, the explainer, the simulated chat), control plane;
  - the four effects with CSS fallbacks (WebGL2 for ghost text and veil);
  - server: `GET /api/matches/:matchId` (D-060) and **BUG-004**: the session clock now runs on to
    `end + delayMs`, so a delayed TV reaches the result (D-063).
- [x] Numbers you inherit: `pnpm verify` 47 files / 569 tests; `pnpm test:e2e` 22 passed (about 1.3 min).

## Not Yet Done (exact rules in `docs/PLAN.md` → "Task 7")

- [ ] **7.1** `deploy/{Caddyfile.template,sideline.service,install.sh,update.sh,README.md}`; `bash -n` clean
  (`shellcheck` is **not installed** here and there is no sudo); `install.sh --dry-run` prints the plan, changes nothing
- [ ] **7.2** `scripts/ai-record.ts` (`pnpm ai:record`): with `--provider scripted` it writes JSONL that
  `loadReplayRows` loads (unit test); a real run needs `--yes` and prints call counts and cost
- [ ] **7.3** With Nabhanyu: `sudo deploy/install.sh`, ports 80/443, Elastic IP, record the replay cache (**needs
  a working key; ask first**), `deploy/update.sh`
- [ ] **7.4** `PLAYWRIGHT_BASE_URL=https://<host> pnpm test:e2e` green; replay check: no key, restart, the
  climax shows `Replayed AI` chips
- [ ] **7.5** Docs (F07, deploy README, ROLLBACK deploy rows, TEST_CHECKLIST §F, Architecture deployment status)
- [ ] Write `HANDOFF9.md` per `AGENTS.md` → "Finishing", then stop

## Failed Approaches (Don't Repeat These)

- **Piped checks again.** `pnpm exec biome check apps/web | grep …` hid lint's exit code and a commit with
  three lint errors went in (fixed forward in `b74319f`). Run each check on its own and read its exit code
  (`cmd > log 2>&1; echo "exit $?"`), or `set -o pipefail`. Biome **warnings** count too: the baseline is
  `No fixes applied.` with zero `!` diagnostics.
- **Browser review through claude-in-chrome on this host.** Its Chrome has no GPU and no WebGL2 (only the
  CSS fallbacks show), its window stays at 766x496 whatever `resize_window` reports, and a background
  window throttles animation frames to about 1 fps. For 1440 and 390 px screenshots use Playwright's
  headless Chrome (`channel: "chrome"`; it renders WebGL with SwiftShader) from a scratch script.
- **Timing from element screenshots of WebGL canvases.** Each one stalls on the readback ("GPU stall due
  to ReadPixels" warnings), so a "480 ms" frame was seconds late and looked like a bug. Time things with a
  `MutationObserver` that logs `performance.now()` instead.
- **Clicking a persona card's text in Playwright.** The card's transparent radio covers it and intercepts the
  click. Use `page.getByRole("radio", { name: /^Late from work/ }).check()`.
- **Controlled inputs that wait for the server.** `check()` on the speed radio failed ("Clicking the checkbox
  did not change its state") until the controls became optimistic. Keep that in mind for any new control.
- **Loose string assertions.** "Rauf to Kohli, six" also matched 18.5's legitimate commentary line; assert the
  ball label or the exact reveal. A BUG-004 test first used a 15 s feed, shorter than the crowd's 22 s tail
  after the match end, and could not fail; pick inputs that make the bug observable.
- **Still true from earlier handoffs:** compute waits from event `t` values (34 s a ball, +55 s after an over,
  +50 s after a wicket); 1298150's chase has no big ball between overs 6 and 18; never call the real AI
  endpoint without asking; `applyEvent` mutates; no `%` in `it.each` titles; commit messages from a file.

## Key Decisions

| Decision | What it means for Task 7 |
|----------|-----------|
| D-025 Caddy + sslip.io + systemd | `<public-ip-with-dashes>.sslip.io`, IP from IMDSv2; the unit runs `node apps/server/src/index.ts` as `nabhanyu` |
| D-033 providers via `.env` | `/etc/sideline/sideline.env` is generated from the git-ignored `.env`; never echo values |
| D-054 replay rows | a recorded row answers for **any** model and with **no** key; a live row for the configured model wins over it |
| D-058 X-Forwarded-For | trusted only from a loopback peer: Caddy on the same host is exactly that (F05 follow-up 3) |
| D-060 match detail route | the room needs `GET /api/matches/:matchId`; nothing to configure |
| D-063 end of match | the clock stops at `end + delayMs`; nothing to configure, but a full-match recording runs that much longer |
| D-064 match room | outbursts only for a ball with a teaser or the result; the control plane holds rows until the TV shows them |
| proxy out of credit (memory, F05) | 403 on 2026-10-17; keep the key; ask Nabhanyu before any real call (smoke, record, diagnostics) |

## Current State

**Working**: `main` at `9d65a2f` (+ this handoff). `pnpm verify` and `pnpm test:e2e` green (output below).
The server boots keyless (`aiMode: 'replay'`, `replayRows: 0`: `data/ai-replay/` does not exist yet) and
serves the API and `apps/web/dist` (after `pnpm build`). `SIDELINE_AI_PROVIDER=none pnpm dev` → web on :5173,
API on :8787.

**Broken**: no code defect known. With the `.env` key, every live AI call falls back (403, out of credit).

**Known limits** (F06 follow-ups): the browser assumes its clock agrees with the server's (a skewed client
clock shifts the TV by skew x speed; matters more on a public link); "Replayed AI" has no recording date on
the chip; the main bundle is 412 kB (127 kB gzipped).

**Uncommitted Changes**: none. `task/06-frontend-core` still exists (merged). `.env` holds a real key (mode
600, git-ignored): never open, print, copy or commit it.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/PLAN.md` (Task 7) | Authoritative spec: files, `install.sh` / `update.sh` / `ai:record` rules, manual steps |
| `apps/server/src/index.ts`, `src/config.ts` | Boot, env schema (`HOST`, `PORT`, `NODE_ENV`, `SIDELINE_DATA_DIR`, `SIDELINE_WEB_DIST`, AI vars), SIGTERM shutdown |
| `apps/server/src/runtime.ts` | Assembles bundles, DB (`data/runtime/sideline.db`), gateway, replay rows (`data/ai-replay`) |
| `apps/server/src/ai/providers/replay.ts`, `src/ai/cache.ts` | The replay JSONL schema and how rows enter the cache |
| `scripts/ai-smoke.ts` | A real call through the gateway with an in-memory DB: the pattern `ai-record` can follow |
| `apps/server/test/runtime.ts` | `testRuntime()` with the scripted provider and a hand-moved clock: how to drive sessions fast |
| `playwright.config.ts` | `webServer` on :8799; add `PLAYWRIGHT_BASE_URL` (skip `webServer` when set) |
| `e2e/match-room.spec.ts` | **Asserts `Fallback: AI unavailable` on the 18.6 card**: with replay rows it shows `Replayed AI`; update it (see Edge Cases) |
| `e2e/smoke.spec.ts` | Every route; `/match/1298150` without a persona shows the picker (no session) |
| `.env.example`, `docs/ROLLBACK.md`, `docs/TEST_CHECKLIST.md` §F | Env names, deploy rollback rows to fill, security checks |

## Code Context

**Replay row** (`apps/server/src/ai/providers/replay.ts`; one JSON object per line in `data/ai-replay/*.jsonl`):
```typescript
const ReplayLineSchema = z.object({
  key: z.string().min(1),          // e.g. "nudge:1298150:1298150:0254", "catchup:1298150:2:0-14:casual"
  promptVersion: z.string().min(1),// "teaser-v1" | "catchup-v1" | "explainer-v1"
  model: z.string().min(1),        // the model that produced it (informational for replay rows)
  output: z.unknown(),             // the skill's validated OUTPUT (e.g. { nudge }), not the payload
});
// loadReplayRows(dir, cache) runs at boot; a malformed line fails the boot naming file:line.
```

**Where live outputs land** (`apps/server/src/db/migrations.ts`): the recorder can read them back.
```sql
CREATE TABLE ai_cache (key TEXT, prompt_version TEXT, model TEXT, payload_json TEXT,
  source TEXT CHECK (source IN ('live', 'replay')), created_at TEXT, hits INTEGER,
  PRIMARY KEY (key, prompt_version, model));
-- payload_json holds the validated output; record only source = 'live' rows (Constraint 2).
```

**Boot line to expect** (keyless):
```text
[sideline] v0.1.0 listening on http://127.0.0.1:8787 { nodeEnv: 'production', aiProvider: 'none', … } { matches: 2, analyticsRows: 502, replayRows: <N>, aiMode: 'replay' }
```

**Keys the demo flows produce** (record what reviewers will hit, not only each persona's own path):
every teaser `nudge:<match>:<eventId>` (shared, 23 in 1298150 and 25 in 1415755), each persona's join catch-up
(`catchup:1298150:2:0-14:casual`, `…:2:0-16:f1`, `catchup:1415755:2:0-15:analyst`, `…:2:0-17:football`), and
catch-ups the room's jumps create (the E2E's jump from 14 to 18 overs gives `catchup:1298150:2:14-18:casual`;
the key includes the lens). Explainer answers are personal (keyed by question and TV position): leave them out.

## Verification Output

```text
pnpm verify          (main at 9d65a2f, after the merge)
packages/engine typecheck: Done
apps/web typecheck: Done
apps/server typecheck: Done
Checked 222 files in 487ms. No fixes applied.
 Test Files  47 passed (47)
      Tests  569 passed (569)
check-no-hardcode: OK (131 source files, 209 terms)
verify-data: OK (2 matches)
✓ built in 787ms

pnpm test:e2e
  22 passed (1.3m)
```

## Audit Requests

What the Task 7 audit will check; flag anything you are unsure about:
- `install.sh --dry-run` changes nothing; a real run is idempotent, prints variable **names** only, writes
  `/etc/sideline/sideline.env` root-owned with mode 600, and forces `HOST=127.0.0.1`, `PORT=8787`, `NODE_ENV=production`.
- Every `data/ai-replay` row came from a real provider call (`source = 'live'`), never by hand; the recorder
  refuses to run without `--yes` and prints call counts and cost before and after.
- SSE through Caddy streams immediately (`curl -N https://<host>/api/sessions/<id>/stream` shows `hello` and
  `snapshot` at once, then frames as they happen); per-address limits see the real client (X-Forwarded-For).
- The public E2E and the replay-mode check (no key → `Replayed AI` chips at the climax).
- Security headers on the public origin (`curl -sI`), no key in logs, the bundle or `/api/health`.

## Resume Instructions

1. `cd ~/Downloads/Dream11FDEAssignment && export PATH="$HOME/.local/bin:$PATH" && node --version && pnpm --version`
   - Expected: `v24.22.0`, `10.34.7`
2. `pnpm install --frozen-lockfile && pnpm verify`
   - Expected: the "Verification Output" above (47 files / 569 tests). If anything is red, stop and report.
3. `git checkout -b task/07-deploy`; create `docs/features/F07-deploy.md` from `docs/features/_TEMPLATE.md`.
4. 7.1 and 7.2 first (no sudo, no key): the scripts with `--dry-run`, `ai-record` against the scripted
   provider with a unit test that round-trips through `loadReplayRows`, `PLAYWRIGHT_BASE_URL` in
   `playwright.config.ts`, and the `e2e/match-room.spec.ts` provenance fix. Test first; commit small.
5. Then ask Nabhanyu once (AskUserQuestion, with a recommendation and the estimated cost): top up proxy or
   add an Anthropic key so `pnpm ai:smoke` and then `pnpm ai:record --yes` can run; and run
   `sudo deploy/install.sh` (an agent has no sudo), open 80/443 in the security group, attach an Elastic IP.
   - Expected after his steps: `curl -fsS https://<ip-with-dashes>.sslip.io/api/health` → `{"ok":true,…}`
6. 7.4 public E2E, the replay check, 7.5 docs; `pnpm verify` + `pnpm test:e2e` green; `HANDOFF9.md`; stop.

## Setup Required

- `~/.local/bin` on `PATH`; Google Chrome for Playwright. No sudo, no compiler, no `shellcheck`, no `caddy`
  on this host until Nabhanyu runs `install.sh`.
- Network: Caddy's apt repo (install.sh, run by Nabhanyu), sslip.io and Let's Encrypt (Caddy's automatic TLS),
  the AI provider for `ai:record` (with approval).

## Edge Cases & Error Handling

- **Replay rows change the E2E**: the local E2E server is keyless, so once `data/ai-replay/1298150.jsonl` holds
  the 18.6 teaser, that card reads `Replayed AI`, not `Fallback: AI unavailable`. Assert one of the known
  provenance labels (or read the expected one from the room's AI-mode chip), keep "held, then revealed".
- **A public server with a live key** answers `Live AI` or `Cached for everyone at this moment`; the public E2E
  must accept those too, and the climax at 16x with a real provider can be late: the card then goes straight
  from held to revealed (`nudgeAt: null`). Do not assert the teaser state against a live provider.
- **Budget**: `SIDELINE_AI_DAILY_BUDGET_USD` (default 3) applies to the recorder's runtime too; proxy reports
  about 4,440 input tokens per call (hidden upstream prompt), about $0.023 each at the default prices, so
  roughly 60 calls cost about $1.40 (estimated).
- **Recording at 32x**: teasers will mostly arrive with `nudgeAt: null` for the recording session; that does
  not matter, the gateway still caches every valid output.
- **Clock skew** on a public link: a visitor whose computer clock is off by a few seconds sees the TV shifted
  by skew x speed (F06 follow-up 1); note it in F07 if you do not fix it.

## Warnings

- **Do not edit** `packages/engine/test/golden/*`, `scripts/oracle/*`, `data/models/*`, or any existing test to get
  green. Changing `e2e/match-room.spec.ts`'s provenance assertion is a spec change caused by replay rows: say so in F07.
- Never print, copy or commit `.env`; never run `pnpm ai:smoke` or `pnpm ai:record` without Nabhanyu's go-ahead.
- `check:hardcode` scans `apps/*/src`, `public`, `index.html`; the deploy scripts are not scanned, but keep match
  facts out of them anyway.
- CSP stays as is (no inline scripts; `'unsafe-inline'` for styles only); add every new route to `ROUTES`.
- Do not merge, tag, push or rewrite history. pnpm's "Update available 10.34.7 → 12.x" is to be ignored.
