# Handoff: Task 10 Final audit and submission (holdout, history scrub, submission zip, GitHub push)

**Generated**: 2026-10-18 01:00 IST (by Claude Code, which implemented and self-audited Tasks 8 and 9 in one session, D-069)
**Branch**: `main` = `t09-verified` (merge `6cdcb06`) + one docs commit (records, the holdout tooling, this file). Task 10
works on `main`; only the history scrub happens first in a separate mirror clone (D-072).
**Status**: Ready for Task 10. Not blocked. Three things come from Nabhanyu: the GitHub remote (and its auth), a key
with credit for the live AI smoke (or his call to skip it), and one `sudo deploy/install.sh` for the domain.

## Goal

Sideline is an AI second-screen companion for live cricket (Dream11 FDE intern assignment by Nabhanyu). Task 10
(`docs/PLAN.md` → "Task 10", Milestone C): the final audit of the whole repository with a fresh holdout match,
`/security-review`, a redeploy with the public E2E and (with a working key) the live AI smoke, `docs/SUBMISSION.md`
(≤ 200 words, Nabhanyu's voice, the link), `docs/DEMO_SCRIPT.md`, the README pass, the submission zip, the
owner-approved scrub of the forbidden word from git history with the tags re-pointed (D-072), the first push of `main`
and the tags to GitHub (D-069), and `t10-verified`.

## Completed

- [x] Tasks 1-9, tagged `t01-verified` to `t09-verified`. Records: `docs/features/F01`-`F09`, Decisions D-001 to D-077.
- [x] **Owner carry-overs (this session):** the domain is `sideline.nabhanyubm.tech` (D-070: `deploy/install.sh`
  default, deploy test, docs); the TV's AI chip follows the provider's last answer (D-071: a provider error turns the
  mode to "replay" until any answer; migration 2 adds `ai_calls.called` so a restart remembers; `telemetry` messages
  carry `aiMode`); Task 10's history scrub and tag re-pointing are approved and recorded (D-072; Constraint 21 and
  ROLLBACK name it as the one exception).
- [x] **Task 8 (`t08-verified`, merge `3bb8c3c`, merged on its own first at the owner's request, D-075):** lineup patch
  (illegal swaps dropped via `skill.repair`, fan requests until the first ball on their TV), bailout (yes/no quest rules
  the engine settles), room read, stat-back and the NL inspector over a read-only SQL sandbox (validation, a worker on an
  in-memory copy of the documented views, `query_only`, SQLite's authorizer, 200 rows, 2 s kill: D-074), routes
  `lineup-intent`, `chat`, `inspector` (D-073). The recorder records bailouts and room reads (plan: 91 calls).
- [x] **Task 9 (`t09-verified`, merge `6cdcb06`, Milestone B):** a card for every moment, the fan's chat line, the
  inspector UI, story mode (engine `buildStoryPlan` from personas and triggers, `GET /api/matches/:id/story`, a pure
  director, D-076), `/architecture` polish, the landing's performance pass (D-077).
- [x] **Deployed** `t09-verified` with `deploy/update.sh`; the public E2E passes (26); production's stream says
  `"aiMode":"replay"` (the key still 403s); Lighthouse on production: phone 92, desktop 90, accessibility 100.
- [x] **Holdout tooling committed** for Task 10: `scripts/oracle/audit/holdout_data.py` and `holdout_sessions.ts`
  (README section "Session-level holdout"); baseline `AUDIT OK` on 1512773.

## Not Yet Done

Task 10, in this order (the scrub must come after `t10-verified` exists and before any push):
- [ ] **Baseline:** `pnpm install --frozen-lockfile && pnpm verify` (expect 59 files / 739 tests) and `pnpm test:e2e` (26).
- [ ] **Full audit (TEST_CHECKLIST §2) across the repo:** A-G as written; engine vs oracle on both matches; a holdout the
  code never saw. **Pick a new match** (used so far: 1298158 in T5, 951373 and 951353 in T4, 1512773 in T8-9): e.g.
  1512772 (2026 semi-final, India v England, in `/tmp/icc_mens_t20_world_cup_male_json.zip` or re-download it) through
  `holdout_data.py` + `holdout_sessions.ts`, plus `compare.py`; optionally the whole
  archive with `run_sweep.sh`. Mutation spot checks by hand (the owner asked this session to skip the long loops).
- [ ] **`/security-review`** of `git diff t01-verified..HEAD`; fix or document each finding (focus: the SQL sandbox and
  the inspector, stat-back's TV-time cut, fan text in prompts, rate limits, the deploy scripts).
- [ ] **Live AI smoke** only with Nabhanyu's go-ahead (Constraint 26): the key answers 403 `key_expired`. If he renews:
  `pnpm ai:smoke`, then `pnpm ai:record` (plan: 91) and `pnpm ai:record --yes` ($3 daily cap), rows committed on a task
  branch, audited, deployed. Otherwise record "skipped: no credit".
- [ ] **`docs/SUBMISSION.md`:** ≤ 200 words in Nabhanyu's voice: the fan problem, how Sideline helps (four moments), the AI
  tools used (Claude Code as architect, auditor and, with Codex unavailable, implementer of Tasks 3-9; Codex for Task 2),
  the links (`https://3-108-67-100.sslip.io/`, the domain once it serves, the GitHub repo once pushed). Ask him to read it.
- [ ] **`docs/DEMO_SCRIPT.md`:** a 5-minute walkthrough (landing → "Watch the story" → its seven stops → the control plane
  and inspector → `/architecture`) and likely questions with answers (when we don't call AI, the scale projection, cost,
  failure modes: no key, a failing key (D-071), slow AI vs the delay budget, what's next).
- [ ] **README final pass**, every doc current, then **tag `t10-verified`** on `main`.
- [ ] **Submission zip** (owner, PLAN Task 10): `git archive --format=zip --prefix=sideline/ -o ../sideline-t10.zip
  t10-verified` (tracked files only: no `.env`, no `node_modules`, no database); `unzip -l` to check; sha256 into
  `docs/SUBMISSION.md` (a commit after the tag changes nothing the zip holds; say which commit it is).
- [ ] **History scrub (D-072)**, then **push** (D-069): see Resume Instructions 6-8. Never push before the scrub.

**Owner (Nabhanyu), not blockers:**
- [ ] **Domain:** DNS is done (`dig +short A sideline.nabhanyubm.tech @1.1.1.1` → `3.108.67.100`, Cloudflare, DNS only), but
  the installed Caddyfile lists only the sslip.io name, so `https://sideline.nabhanyubm.tech/` fails the TLS handshake. Run
  once: `sudo /home/nabhanyu/Downloads/Dream11FDEAssignment/deploy/install.sh` (idempotent: rewrites the Caddyfile with
  both names, the env file and the unit, redeploys `main`); then `curl -fsS https://sideline.nabhanyubm.tech/api/health`.
- [ ] **GitHub:** the remote URL and how to authenticate (`gh auth login` or an SSH key); repository visibility.

## Failed Approaches (Don't Repeat These)

- **`pkill -f <pattern>` where the pattern is in your own command line** killed the shell running it (exit 144). Find a
  server by its port instead: `ss -ltnp | grep ':8791 '` and kill that pid.
- **Floodlight performance attempts that did not work:** a quarter-size blob field scaled up 4x (Chrome still paid the
  per-frame repaint), and stepping the drift animation (worse and noisier). What worked: fixed-colour tints cross-faded
  with `opacity` plus `translate` drift (compositor work), D-077.
- **Hiding the landing's "uses AI" section until the matches load** moved the footer instead (CLS 0.42). Reserving the
  picker's height (`.start--loading`) fixed the 0.12 shift.
- **Reading one Lighthouse run as the truth:** the same build scores ±10 points on this host (remote desktop, other
  sessions, load average 4-6). Run three times, or measure production; record the spread.
- **A test that passed for the wrong reason:** a missing reducer action returned `undefined` and the test helper's
  default parameter silently used a fresh state. Assert on the state you expect to have grown, not only on its shape.
- **An unwatched session at 1x** sits idle past the 30-minute TTL before the first innings' 1.1 and is evicted: play at
  32x or keep a stream open. **Playing at 32x overshoots** jump points by up to 32 s of stadium time.
- **A lazy-loaded route under a busy full test run:** `waitFor`'s default 1 s timed out; the first wait now allows 10 s.
- **Snippet-based mutation scripts** must match Biome's formatted code (a reformatted line silently SKIPs), and they
  restore files with `git checkout --`: commit before mutating, or you lose work.
- **jsdom has no canvas:** inject `draw` into `BanterCard` in tests rather than letting `getContext` log "not implemented".
- **Still true:** never call the real AI endpoint without asking; no foreground `sleep` (use a background `until` loop);
  the claude-in-chrome window has no WebGL2 and stays 766 px wide (use Playwright for screenshots).

## Key Decisions

| Decision | What it means for Task 10 |
|----------|-----------|
| D-072 history scrub (owner) | scrub the word from every commit and message, keep the trail (authors, dates, merges), re-point `t01`-`t10-verified`, back up first, verify, then push; the one exception to Constraint 21 |
| D-069 / D-075 | Task 10 pushes to GitHub (the first remote); Task 8 was merged and tagged before Task 9 on one branch |
| D-070 domain | `sideline.nabhanyubm.tech`; Caddy serves it after `sudo deploy/install.sh` |
| D-071 AI mode | the chip says "replay" while the provider errors; production shows that now; live AI returns by itself with credit |
| D-073 / D-074 inspector and sandbox | the inspector runs a question's SQL or the operator's own through the sandbox; `ai_calls` without session ids, keys or details |
| D-076 story | beats from personas and triggers; `?story=1`; the room's controls are off while the tour steers |
| D-077 landing performance | production phone 92 / desktop 90; local runs vary with host load |
| D-068 / Constraint 27 | never write the proxy's name; `pnpm check:hardcode` scans every tracked file |

## Current State

**Working**: everything on `main`; `pnpm verify` and `pnpm test:e2e` green locally and the E2E against production.
Production runs `t09-verified` from `/srv/sideline` on `127.0.0.1:8780` behind Caddy at `https://3-108-67-100.sslip.io/`.

**Broken**: no code defect known. Every production AI card is a labelled fallback (the key 403s). The domain's HTTPS fails
until `sudo deploy/install.sh` (TLS alert: no certificate configured for that name).

**Uncommitted Changes**: none (this file is committed with the records and the tooling).

**History facts (for the scrub):** the forbidden word appears in 14 commits (the first `f008b53`, 2026-10-16): 121 lines
of content and 3 lines of commit messages; this session's commits added none. Tags are lightweight (`git tag`).

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/PLAN.md` → "Task 10" | the checklist, the D-072 note, the submission zip item |
| `docs/Decisions.md` D-072 | the scrub's conditions (backup, keep the trail, re-point tags, verify) |
| `scripts/check-no-hardcode.ts` | `FORBIDDEN_WORDS` (stored reversed): decode it in a subshell, never type it into a file or message |
| `scripts/oracle/audit/holdout_data.py`, `holdout_sessions.ts`, `README.md` | the session-level holdout, ready to run |
| `docs/TEST_CHECKLIST.md` §2, rows 17-20 | the audit protocol, redeploy, public E2E, Lighthouse |
| `deploy/install.sh`, `deploy/update.sh`, `deploy/README.md` | domain install (sudo, owner), redeploy and rollback by ref |
| `apps/server/src/sql/{validate,sandbox,worker,views}.ts` | the security review's main target |
| `apps/web/src/story/{director.ts,StoryOverlay.tsx}`, `packages/engine/src/story/plan.ts` | story mode for the demo script |
| `docs/features/F08-ai-skills-2.md`, `F09-frontend-complete.md` | follow-ups to decide on or carry |

## Code Context

```typescript
// packages/engine (public)
lineupKey(matchId: string, squad: FantasySquad, intent?: string | null): string   // ":none" or the request's hash
buildStoryPlan(input: StoryInput): StoryPlan | null
// contracts: StoryPlanSchema/StoryBeatSchema (contracts/story.ts),
//            InspectorRequestSchema/InspectorResultSchema/InspectorViewSchema (contracts/inspector.ts);
// the stream's telemetry message: data { telemetry, aiMode?: AiMode }

// apps/server
interface Skill<F, O, P> { /* ... */ repair?(out: O, facts: F): { output: O; dropped: string[] } }
interface TraceSink { /* ... */ lastProviderAnswer(): boolean | null }        // seeds GatewayDeps.providerAnswering
runSandboxed(sql: string, tables: readonly SqlTable[]): Promise<SandboxOutcome>
// SandboxOutcome = { status: "ok"; sql; columns; rows; truncated } | { status: "refused"|"timeout"|"error"|"busy"; sql; reason }
// Session gains lineupIntent(text), chat(text, statBack), inspect(request)
```
```text
POST /api/sessions/:id/lineup-intent {text 1-280}            → {moment}; 409 {error:{code: no_squad|not_yet|all_playing|locked}}
POST /api/sessions/:id/chat {text 1-280, statBack?: boolean} → {message, moment | null}
POST /api/sessions/:id/inspector {question} | {sql}          → {result: InspectorResult}
GET  /api/inspector/views                                    → {views: InspectorView[]}
GET  /api/matches/:matchId/story                             → {story: StoryPlan | null}
(all POSTs: per-address bucket first, 429 + Retry-After; 16 KB body cap, 413)
```

## Verification Output

```text
pnpm verify (main at this handoff's commit; at the t09-verified merge it was 270 files and 343 tracked files)
packages/engine typecheck: Done / apps/web typecheck: Done / apps/server typecheck: Done
Checked 271 files in 862ms. No fixes applied.
 Test Files  59 passed (59)
      Tests  739 passed (739)
check-no-hardcode: OK (162 source files, 209 terms; 346 tracked files, no forbidden words)
verify-data: OK (2 matches)
✓ built in 788ms

pnpm test:e2e                                                         26 passed (4.1m)
deploy/update.sh t09-verified       update: deployed 6cdcb06 (t09-verified) at https://3-108-67-100.sslip.io/
PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e       26 passed (3.8m)
Lighthouse 13.5.0, production: phone performance 92, desktop 90; accessibility 100; best practices 96
pnpm ai:record (no --yes)  plan: 91 moments need a provider call (48 teasers, 19 catch-up reels, 2 bailouts, 22 room reads)
node scripts/oracle/audit/holdout_sessions.ts <scratch>/data 1512773  AUDIT OK (inspector: 249 deliveries, 414 runs)
engine vs oracle: IDENTICAL on 1298150, 1415755, 1512773
hand mutants: Task 8 8/8 killed; Task 9 10/10 killed (2 test gaps pinned first)
```

## Audit Requests

- The SQL sandbox and the inspector (Review focus 5): try to read a session id, the future (stat-back past the TV),
  `sqlite_master`, a write, a huge result, a slow query, a flood of requests (two workers at once, then "busy").
- Story mode on the second match (1415755) by hand: its plan stops at Rohit's 1.4, 15 overs of the chase, 16.1 and the
  16.6 room read.
- D-071's semantics: a timeout leaves the mode alone; a guard rejection counts as an answer. Agree, or record otherwise.
- That no hand-written text is presented as AI: the story's callouts are code-written UI copy; every fallback is labelled.
- No commit message or tracked file names the proxy after the scrub (decode the word, grep the scrubbed repository).

## Resume Instructions

1. `cd ~/Downloads/Dream11FDEAssignment && export PATH="$HOME/.local/bin:$PATH" && node --version && pnpm --version`
   - Expected: `v24.22.0`, `10.34.7`
2. `git status --short` (empty) `&& git log --oneline -1` (this handoff's commit on `main`) `&& pnpm install --frozen-lockfile && pnpm verify`
   - Expected: the Verification Output above. If red, stop and report.
3. `curl -fsS https://3-108-67-100.sslip.io/api/health` → `"ok":true`; `curl -fsS https://sideline.nabhanyubm.tech/api/health`
   → fails until Nabhanyu's install, then `"ok":true`.
4. Audit: TEST_CHECKLIST §2 with a new holdout (README "Session-level holdout", another match id), then `/security-review`.
5. Docs: `SUBMISSION.md`, `DEMO_SCRIPT.md`, README; commit; `git tag t10-verified`; the zip (Not Yet Done).
6. **Back up before the scrub:** `git -C ~/Downloads/Dream11FDEAssignment bundle create ~/Downloads/sideline-before-scrub.bundle --all`
   then `git bundle verify ~/Downloads/sideline-before-scrub.bundle` → "is okay". Keep it until the push is verified.
7. **Scrub (D-072) in a mirror clone**, e.g. `git clone --mirror ~/Downloads/Dream11FDEAssignment ~/Downloads/sideline-scrub.git`:
   - Preferred: `git filter-repo` (not installed; no pip here). Fetch its single-file script from its official release into a
     scratch directory (published ≥ 14 days ago), run `python3 -I <script> --replace-text <file> --replace-message <file>`
     with one line `regex:(?i)<the word>==>proxy` in a file outside every repository; it rewrites contents and messages,
     keeps commits, dates and merges, and moves the tags.
   - Fallback: `git filter-branch --tree-filter '<edit only text files that contain it>' --msg-filter '<sed>'
     --tag-name-filter cat -- --all` (slow, built in).
   - Verify: `git log --all -p | grep -ic <word>` → 0 and `git log --all --format=%B | grep -ic <word>` → 0; the same commit
     count as before (`git rev-list --all | wc -l`); for each tag, the old and new trees differ only in lines that held the
     word (`git diff --stat` between them after fetching both into one scratch repository); `pnpm verify` green on a fresh
     clone of the scrubbed `main`.
   - Then point the working copy at the scrubbed history with Nabhanyu (e.g. fetch the rewritten refs and reset `main` and the
     tags, keeping `.env` untouched), and redeploy with `deploy/update.sh t10-verified` (it fetches from the working copy).
8. **Push:** `git remote add origin <url from Nabhanyu>`; `git push origin main`; `git push origin --tags`; open the repository
   page and check the tags and the README. Update `SUBMISSION.md` and the README with the GitHub URL if needed.

## Setup Required

- `~/.local/bin` on PATH; Google Chrome for Playwright; no sudo for us (`deploy/update.sh` restarts through the one sudo rule).
- `.env` holds the real key (mode 600): never open, print, copy or commit it. `git archive` and the scrub never touch it.

## Edge Cases & Error Handling

- With a key that fails, the TV's chip reads "No live AI: recorded answers or labelled fallbacks" and every AI card is a
  labelled fallback; a renewed key brings "live" back on its first answer (no restart needed).
- Story mode with live AI: the climax runs at 2x so a teaser keeps its time budget; at higher speeds a live teaser arrives
  revealed (Review focus 3), and the director then skips straight to the reveal stop.
- The inspector's `ai_calls` is every fan's calls (without session ids): an operator's view, not a per-session one (F08).

## Warnings

- **Never write the proxy's name** (Constraint 27): not in files, commit messages, the zip, the GitHub description.
- **The scrub rewrites every hash and moves the tags:** do it only with the bundle backup and Nabhanyu present, never on a
  repository that has been pushed, and never push the unscrubbed history (D-072).
- Never run `pnpm ai:smoke` or `pnpm ai:record --yes` without Nabhanyu's go-ahead (Constraint 26).
- Production only through `deploy/update.sh <audited ref>` (and `sudo deploy/install.sh` by Nabhanyu); never edit
  `/srv/sideline`, `/etc/caddy/Caddyfile`, `/etc/sideline` or the unit. Port 8787 is development's, 8780 production's.
- Do not edit `packages/engine/test/golden/*`, `scripts/oracle/*.py` (the oracle), `data/models/*` or an existing test to get
  green; a changed expectation is a spec change: name it in the feature file and the commit.
- pnpm's "Update available" notice is to be ignored.
