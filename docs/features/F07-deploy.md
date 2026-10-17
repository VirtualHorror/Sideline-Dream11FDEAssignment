# F07: Deploy (Milestone A)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 7 in `docs/PLAN.md`
- **Branch:** `task/07-deploy`
- **Owner / session:** Claude (Codex unavailable), 2026-10-17, with Nabhanyu for the sudo step
- **Status:** audited and merged (`t07-verified`)

## Scope
A stable public HTTPS link that works with or without an API key: `deploy/install.sh` (Caddy with
automatic TLS for `<ip-with-dashes>.sslip.io` and the owner's domain, a sandboxed systemd unit, the
root-only environment file, a deploy checkout separate from the working copy), `deploy/update.sh`
(redeploy and rollback by ref), `pnpm ai:record` (the replay recorder), and the public E2E. Also: step
7.0, the independent spot-check of `t06-verified`; the owner's two UI notes; removing the AI proxy's
name from the repository (D-068). Not in scope: recording real replay rows (the AI key has no credit,
owner's call: see "Open").

## Plan steps
- [x] **7.0** Independent spot-check of `t06-verified` (D-065)
- [x] **7.1** `deploy/{Caddyfile.template,sideline.service,install.sh,update.sh,README.md}`; `bash -n` clean; dry runs print the plan and change nothing (proven with shims)
- [x] **7.2** `pnpm ai:record` with `--provider scripted` writes JSONL the replay loader reads (tests)
- [~] **7.3** With Nabhanyu: `sudo deploy/install.sh` (done), ports and Elastic IP (done by him), `update.sh` (done); **recording the replay cache deferred** until the key has credit (owner)
- [x] **7.4** `PLAYWRIGHT_BASE_URL=https://<host> pnpm test:e2e` green; the replay check proven with scripted rows in a scratch data directory, through the real UI (the real one waits for a recording)
- [x] **7.5** Docs (this file, deploy README, ROLLBACK, TEST_CHECKLIST, Architecture, Flow, Decisions, Constraints)

## Log (newest last)
- **Step 7.0, spot-check of `t06-verified`** (fresh session): `pnpm verify` 47 files / 569 tests, E2E 22
  passed, engine vs oracle IDENTICAL on both matches, `mutate.py` 18 killed / 0 survived, all as recorded.
  14 fresh hand mutants of the Task 6 code: 11 killed. The 3 survivors were test gaps (a teaser's trace
  shown while its card only teases; a question's trace never shown; a seek past the end clamped to the
  end plus the delay) and each now has a test that fails on its mutant (D-065, commit e06476c).
- **Owner's UI notes:** "1 balls without a run" (the reel for late-from-work's jump from 14 to 18 overs:
  the raw file's overs 15-18 hold five isolated dot balls, the first at 15.1) now reads "1 ball without a
  run / At 15.1, nothing was scored.", and the template's other counts agree with their numbers (test
  first). The reel's clipped right edge did not reproduce at 30 widths (360-1920 px, headless with and
  without scrollbars, and the host's Chrome at 766 px); Nabhanyu then checked the live site and withdrew it.
- **The deploy checkout (D-066):** production first ran from the working copy in the plan, but
  `pnpm verify` empties `apps/web/dist` under a server that keeps `index.html` in memory (a blank public
  page after every build), tests share `data/runtime`, and `update.sh <ref>` would switch the developer's
  branch. Production runs from `/srv/sideline`, a clone detached at the deployed commit.
- **Port 8780, not 8787 (D-066):** `pnpm dev`, its Vite proxy and the developer's `.env` own 8787 on this
  host; production there would break `pnpm dev` or, worse, give the dev UI the production API.
- **The environment file:** rendered by `scripts/deploy-env.ts` with Node's own `.env` parser; only the
  variables the server reads; HOST/PORT/NODE_ENV forced (an EnvironmentFile overrides the unit's
  Environment= lines); values in systemd's double-quoted form, checked by round trip through systemd 255
  itself (`systemd-run --user -p EnvironmentFile=…`: 8 tricky values identical, an unrelated variable
  not passed through).
- **The unit's sandbox:** `systemd-analyze verify` clean, `systemd-analyze security` 3.2 "OK"; the server
  booted and served under `ProtectSystem=strict`, `ProtectHome=read-only`, `ReadWritePaths=data/runtime`
  and the address-family filter as a user unit (DNS resolves inside it). The capability options cannot be
  tried as a user unit (expected); PID 1 applied them in production.
- **Shell traps found and fixed before the sudo run:** `put_file … || true` would have switched off
  `set -e` inside the function (a failed `mv` unnoticed); a pipe into `awk … exit` / `head -n 1` can kill
  the writer with SIGPIPE under pipefail; `systemctl` resolved through PATH (a root script must not trust
  it, and the sudo rule must name `/usr/bin/systemctl`). The dry-run test shims every host-changing
  command and fails if one is called (shown to catch a dropped `run`); a static test covers `systemctl`.
- **A dry-run mutant reached the real `systemctl` once:** while proving the static test, a mutant without
  `run` called `/usr/bin/systemctl reload-or-restart caddy` as the developer for about 25 s before failing
  (Caddy was not installed then; nothing changed). If a polkit password prompt appeared on the desktop
  around then, that was it.
- **The recorder:** walks every persona through the server's own sessions (play from the join point; the
  room's one-click jumps), so its keys are exactly a live server's: 67 moments today (48 teasers, 19
  catch-up reels). Hand-moved clock, 1x, 60 s delay, so each teaser gets the full 15 s timeout. Without
  `--yes` it only plans (no provider, nothing sent).
- **Install (Nabhanyu, sudo):** Caddy 2.11.7 from the official repository, Let's Encrypt certificate for
  `3-108-67-100.sslip.io`, both services enabled; production at `main` (`055de66`). Then `deploy/update.sh
  task/07-deploy` from this session: the passwordless restart works and both health checks pass.
- **D-068 (owner):** the proxy's name removed from every tracked file, `/api/health` reports the kind of
  endpoint (`openai-compatible`) instead of its host, and `pnpm check:hardcode` now fails on the name in
  any tracked file. The owner's domain `sideline.nabhanyubm.xyz` added to the Caddyfile; at the time of
  writing the `.xyz` registry answers NXDOMAIN for `nabhanyubm.xyz` (the domain is not published yet), so
  Caddy will get its certificate once it resolves; the sslip.io name works meanwhile. *(Corrected in Tasks 8-9:
  the owner's domain is `sideline.nabhanyubm.tech`, D-070.)*

- **The climax E2E records the card's states in the page:** with production, Caddy and the public runs' sessions
  loading this host, a local run first saw the 18.6 card in its teaser state: the hold lasts (25 - 6) / 16 = 1.2 s
  of wall time and Playwright polls up to 1 s apart, so the Task 6 assertion could miss it. A MutationObserver now
  logs every state with the card's text; the test asserts held first (replay mode), the outcome never in the DOM
  before the reveal, revealed last. Stable twice under load, and it fails when the card shows the outcome while
  held (mutant, restored).

## What worked / what did not
- Worked: proving "a dry run changes nothing" with PATH shims instead of trusting it; testing the env file
  against systemd itself; the recorder reusing the session machinery (no second copy of the key rules);
  verifying through the real proxy: SSE first byte in 54 ms; spoofed X-Forwarded-For counted as one client.
- Did not: the plan's two literal choices (run from the working copy, port 8787) on a host that is also the
  development machine; my first SSE check (a `timeout | grep` pipe killed the reader, not the stream).

## Decisions made
D-065 (spot-check), D-066 (deployment as built), D-067 (the recorder and the zero-credit production),
D-068 (the proxy's name, the health endpoint, the custom domain), D-069 (Tasks 8 and 9 in one session;
Task 10 pushes to GitHub).

## Verification (paste real output)
```
pnpm verify                     (task/07-deploy, before the merge)
… typecheck: Done ×3; Checked 229 files … No fixes applied.
 Test Files  50 passed (50)
      Tests  599 passed (599)
check-no-hardcode: OK (131 source files, 209 terms; 299 tracked files, no forbidden words)
verify-data: OK (2 matches)
✓ built in 1.02s

pnpm test:e2e (local, keyless)                           22 passed
PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e   22 passed (1.2m)
  (production on the task branch, the key's account without credit: 43 provider calls, all 403
  key_expired, 0 tokens, $0, every card the labelled fallback; the journal has no key prefix)

deploy/update.sh task/07-deploy
update: health: http://127.0.0.1:8780/api/health
update: {"ok":true,…,"aiProvider":"openai","aiModelFast":"gpt-6.1-sol",…,"aiEndpoint":"openai-compatible"}
update: health: https://3-108-67-100.sslip.io/api/health   (same body)
update: deployed 2b8e6fe (task/07-deploy) at https://3-108-67-100.sslip.io/

public origin: HTTP/2 200; CSP, x-frame-options DENY, nosniff, referrer policy, HSTS (the app's own);
http:// → 308 to https://; certificate Let's Encrypt (YE1) for 3-108-67-100.sslip.io until 2027-01-15;
SSE through Caddy: HTTP 200, first byte 0.054 s, hello + snapshot + moment + chat in 4 s;
5 asks with 5 spoofed X-Forwarded-For values: 4 passed the limiter, the 5th 429 (Retry-After 5);
the public JS bundle: 0 key-shaped strings.

pnpm ai:record (plan, nothing sent)
ai-record: plan: 67 moments need a provider call (48 teasers, 19 catch-up reels); 0 already recorded
```

## Follow-ups (out of scope, noted for later)
1. **Owner, when the key has credit:** `pnpm ai:smoke`, then `pnpm ai:record --yes` (67 calls, capped by the
   $3 daily budget), commit `data/ai-replay/*.jsonl` on a task branch for audit, `deploy/update.sh`; then the
   real replay check: `sudo deploy/install.sh --keyless` and the climax shows "Replayed AI"; re-run
   `sudo deploy/install.sh` to restore the key.
2. **The domain** (corrected to `sideline.nabhanyubm.tech` by D-070, whose DNS already prints the Elastic IP): run
   `sudo deploy/install.sh` once and check `https://sideline.nabhanyubm.tech/api/health`.
3. With a key that has no credit, production is in "live" mode and every AI card falls back; the TV's
   chip says "Live AI connected". A mode that notices a failing provider would read better (Task 9 polish). *(Done in
   Tasks 8-9: the chip follows the provider's last answer, D-071.)*
4. Clock skew (F06 follow-up 1) and "Replayed AI (recorded on <date>)" (F06 follow-up 2) are still open.
5. A build briefly breaks the page until the restart (the server keeps `index.html` in memory): about a
   second during `update.sh`; building into a fresh directory and swapping would remove it.
6. Git history still contains the proxy's name in old commits and handoffs; Task 10's GitHub push needs
   the owner's decision on that history (D-068, D-069).

## Audit notes (filled by the auditor)
**Audit, 2026-10-17, Claude. Verdict: accepted; merged `--no-ff`, tagged `t07-verified`.** Self-audit (Codex
unavailable), after the independent spot-check of `t06-verified` in the same session (D-065).
- **Verification:** the numbers above, fresh; local E2E 22 passed and the public E2E 22 passed against
  production. The first public run had one timeout: two full-page phone screenshots of the WebGL landing page
  take 10-15 s each here (the same through Caddy as direct), so that test got a 60 s budget (commit 577dc43).
- **Read-only files:** golden fixtures, `scripts/oracle/`, `data/raw`, `data/models` and the engine's contracts
  untouched. `data/ai-replay/` does not exist (no real recording yet; scripted rows only ever in scratch dirs).
- **Anti-hardcoding:** scan OK, no `hardcode-ok`, no `.skip`/`.only`; the deploy scripts name no match facts.
- **Tests:** every new test ran red first or was shown to fail on a mutant (spot-check gaps, plural fix,
  env renderer, dry-run shims and the static systemctl check, recorder round trip, forbidden words,
  `aiEndpoint`). Changed expectations, all named in their commits: the 18.6 card's provenance (replay rows
  make it vary by server, D-067) and the config tests that pinned the proxy's host (D-068).
- **Security:** env file root 600 (not readable by the developer: checked); sudo rule limited to one
  command; unit sandboxed; no key in the bundle, `/api/health` or the boot line; X-Forwarded-For spoofing
  defeated end to end; the E2E's local server forced keyless.
