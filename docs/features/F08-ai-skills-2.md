# F08: AI skills II (lineup patch, bailout, room read, stat-back, inspector)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 8 in `docs/PLAN.md`
- **Branch:** `task/08-09-skills-frontend` (one branch with Task 9, D-069)
- **Owner / session:** Claude (Codex unavailable), 2026-10-17, one session with Task 9 at Nabhanyu's request
- **Status:** audited and merged (`t08-verified`)

## Scope
The remaining AI skills, each with a deterministic guard and a labelled fallback, test first on the scripted
provider: the lineup patch (phase 1), the bailout (phase 2), the room read (phase 4), stat-back and the NL
inspector over a read-only SQL sandbox, and their routes. Also the session's carry-overs from the owner: the
domain (D-070), the TV chip that follows the provider (D-071), Task 10's history scrub (D-072). Not in scope: the
cards and the inspector UI (Task 9), recording real replay rows (the key has no credit, D-067).

## Plan steps
- [x] **8.1** Lineup: an illegal swap is dropped and the card falls back only when nothing legal remains; a legal answer is accepted with `squadValid` true
- [x] **8.2** Bailout: a rule starting before the trigger is rejected; an accepted quest's predictions resolve through `resolveQuestRule` on real events
- [x] **8.3** Room read: invented message ids and shares outside 95-105 are rejected
- [x] **8.4** SQL sandbox: DELETE, ATTACH, PRAGMA, a recursive CTE, two statements and an infinite cross join are refused or killed; a valid query returns at most 200 rows; stat-back cannot see past the fan's TV
- [x] **8.5** Routes: lineup intent, chat (stat-back on request), inspector; limits and 429s
- [x] **8.6** `pnpm verify` green; docs

## Log (newest last)
- **Carry-overs first.** The domain is `sideline.nabhanyubm.tech` (D-070): `dig` prints the Elastic IP through
  Cloudflare (DNS only); the HTTPS handshake fails until `sudo deploy/install.sh` puts the name in Caddy. The deploy
  test's expected default changed first and failed. The chip (D-071): a 403 from a key with no credit now turns the
  gateway's mode to "replay" until any later answer; migration 2 adds `ai_calls.called` (with a backfill for the rows
  production already holds) so a restart starts from the last answer, and every `telemetry` message carries the mode.
  The climax E2E now reads whether a key exists from `/api/health`, because a failing key's chip says "replay" while
  its server still calls. Task 10's history scrub is recorded as the owner's decision (D-072).
- **8.1 lineup patch.** The facts are the lineup detector's (babar-believer: Fakhar Zaman and Rishabh Pant benched,
  up to five listed swaps each). The PLAN's "the illegal swap is dropped and provenance fallback only if nothing legal
  remains" needed a step the gateway did not have: `skill.repair` runs after zod and before the guard, drops what a
  rule forbids on its own, and the trace says `repaired` with what it dropped; telemetry counts a repaired answer as
  live, not a fallback. A listed swap that breaks a squad rule once earlier swaps are in is dropped too (tested with
  the budget tightened to 99.5, since no pair of real babar-believer swaps conflicts). The guard also refuses a captain
  who is in the squad but not in an XI (a benched captain scores nothing, DOMAIN §3). The fan's request goes into the
  key's intent slot (`lineupKey(match, squad, intent)`) and into the prompt escaped inside `<fan_request>`; it is
  allowed from the XIs until the fan's TV shows the first ball (teams lock then).
- **8.2 bailout.** Rules come from the model as one flat object with nulls (`questRules.ts`, shared with the room
  read's poll) and must parse as a `QuestRule` inside the quest window (legal balls 8-25 for Babar's 1.1 golden duck),
  after the wicket and not already decided (a batter's "0 or more" is won before a ball). A prediction is yes/no:
  exactly two options, the first if the rule comes true. Outcomes in the tests were counted from the raw file in Python
  (Rizwan caught at ball 24, fours at 12 and 19, no six, 12 dots). The squad projection is per session: it never
  reaches the shared prompt and rides only in the payload. A session test first failed because an unwatched session at
  1x sits past the 30-minute idle TTL before 1.1; it runs at 32x like the other full replays.
- **8.3 room read.** The chat sits escaped inside `<chat>`; pods may cite only the window's message ids; shares must add
  up to 95-105; a settled poll must be about balls still to come (the 2022 chase's 20th over made 16, so "16 or more" is
  won). The fallback reads the window's stance tags (largest remainders, so the shares make exactly 100).
- **Counts that changed on purpose:** a full babar-believer replay of 1298150 now makes 37 calls (23 teasers, 12 room
  reads, 1 lineup patch, 1 bailout) instead of Task 5's 23; the jump-back test re-streams the 18.6 room read with the
  two teasers. The recorder now records bailouts and room reads (`pnpm ai:record` plans 91 calls: 48 teasers, 19
  reels, 2 bailouts, 22 room reads) and its sessions run without the lineup detector, so it never pays for a personal
  patch.
- **8.4 sandbox.** `node:sqlite` in Node 24.22 has `setAuthorizer`, which made the sandbox stronger than the PLAN's
  text checks: the worker builds an in-memory copy of the documented views (never the server's database), sets
  `query_only`, and allows only SELECT, reads of those tables and a list of plain functions. That also stops a recursive
  CTE written without the RECURSIVE keyword (SQLite runs those), `sqlite_master`, `random()` and `printf`. The cross join
  of four copies is terminated at 2 s. Stat-back is two calls on one key: the query, then a verdict whose every number
  must appear in the rows or the take (Kohli's 61 off 47 through 17.6, from the raw file).
- **8.5 routes.** All three rate-limit per address before reading the body, like `/ask`. The fan's chat line is stamped
  on their TV clock (so it shows at once), goes to their own stream and snapshots only, and a jump back hides it like a
  moment.

## What worked / what did not
- Worked: the scripted provider reading legal ids out of the prompt's own `<facts>` made the happy path cheap to keep
  in every session test; the authorizer turned "deny words in the text" into a real allow-list.
- Did not: two route tests were wrong, not the code (playing at 32x overshoots the "18 overs" point, so the fan's
  line was correctly hidden by that jump; the test database has no analytics rows). Both tests were corrected.

## Decisions made
D-070 (domain), D-071 (the chip follows the provider), D-072 (Task 10's history scrub), D-073 (the inspector and the
fan's chat as built), D-074 (the SQL sandbox as built), D-075 (Task 8's skills as built).

## Verification (paste real output)
```
pnpm verify (task/08-09-skills-frontend at d059704)
packages/engine typecheck: Done / apps/web typecheck: Done / apps/server typecheck: Done
Checked 248 files in 816ms. No fixes applied.
 Test Files  55 passed (55)
      Tests  705 passed (705)
check-no-hardcode: OK (145 source files, 209 terms; 307 tracked files, no forbidden words)
verify-data: OK (2 matches)
✓ built in 1.03s

pnpm ai:record (no --yes: nothing sent)
ai-record: plan: 91 moments need a provider call (48 teasers, 19 catch-up reels, 2 bailouts, 22 room reads); 0 already recorded in …/data/ai-replay
```

## Follow-ups (out of scope, noted for later)
1. The recorder does not walk the story mode's path yet (Task 9 adds the story; its catch-ups in the story persona's
   lens may need recording, F09).
2. Lineup patches, stat-backs and inspector questions are personal and never recorded: with no working key they are
   always labelled fallbacks (the inspector still runs the operator's own SQL).
3. The inspector's `ai_calls` view is global (every fan's calls, without session ids, keys or details): a per-session
   view would need the session id, which is a capability and stays out (D-073).

## Audit notes (filled by the auditor)
Self-audit (Claude implemented Task 8; Codex unavailable), 2026-10-17, CLAUDE.md protocol and TEST_CHECKLIST §2:
- **A. Anti-hardcoding:** `pnpm check:hardcode` OK (145 source files; 320 tracked files, no forbidden word); no
  `hardcode-ok`; the diff since `1481f54` has no golden numbers and no comparison with a label, seq, over or id.
  Prompts and templates interpolate facts only.
- **B. Engine vs oracle:** IDENTICAL on 1298150, 1415755 and the holdout 1512773 (the 2026 final, India v New
  Zealand, from the World Cup archive, sha256 `df5e2fa7…a742`, the Task 2 baseline's).
- **C. Holdout sessions:** a scratch data directory with 1512773 (`gen_fixtures.py` fixtures, audit-only priors, one
  invented bench pick, a pre-match persona with the first strikers as captain and vice-captain, a late joiner),
  whole sessions through the real modules, checked by rules written in the audit script: scripted, a lineup patch
  whose swaps take a benched pick out for a new XI player with a valid squad and two different XI armbands, 12 room
  reads citing only real crowd lines with shares of 95-105%, teasers and the reel; keyless, every moment a labelled
  fallback that validates. No bailout fired, and none should: Samson made 89 and Seifert 52 (the raw file). The
  inspector's count over the holdout equals the raw file's 249 deliveries and 414 runs.
- **D. Test quality:** literals from the raw files in Python (quest outcomes, Kohli's 61 off 47 and 82 off 53, the
  20th over's 16, 251 deliveries), FNV hash computed independently. Hand mutants (the long loop skipped at the
  owner's request): 8 of 8 killed (benched captain allowed, shares down to 90%, any number in a verdict, no TV cut,
  every SQL function, bailout window start, a provider error keeping "live", the lineup lock off). The sandbox's
  `query_only` layer is unreachable through the wrapper (only a SELECT can sit inside `SELECT * FROM (...)`), so no
  test can kill its removal: defence in depth, noted.
- **E. Docs:** F08, Decisions D-070 to D-075, Flow §7, §8, §16, Architecture (status, the skills table, security,
  observability, testing), Constraint 12, TEST_CHECKLIST baselines, ROLLBACK, the register, README, PLAN.
- **F. Security:** no key-shaped string in the bundle, `.env` untracked and 600, no `.skip`/`.only`; SQL injection
  through the inspector leaves the real tables untouched; prompt injection in a take or request stays escaped data.
- **G. UI:** `pnpm test:e2e` 22 passed (the chip's mode is read from the stream; the climax test now reads the key's
  presence from `/api/health`). The cards are Task 9's.
Accepted: `t08-verified`.
