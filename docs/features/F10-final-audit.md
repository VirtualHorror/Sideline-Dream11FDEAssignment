# F10: Final audit and submission

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 10 in `docs/PLAN.md` (Milestone C)
- **Branch:** `main` (Task 10 audits the whole repository on `main`, HANDOFF10; no task branch, no merge commit)
- **Owner / session:** Claude, one session from HANDOFF10
- **Status:** audited (`t10-verified`)

## Scope
The final audit of the whole repository (TEST_CHECKLIST §2 with a holdout match no code had seen and the whole
World Cup archive), a security review of everything since `t01-verified`, the redeploy with the public E2E on both
names, the submission note, the demo script, the README's clone-and-run steps, and `t10-verified`. Then, from the
tag: the public repository (a fresh clone, its history scrubbed of the forbidden word, D-072), the submission zip,
the working copy's move with production re-pointed at it (D-078), and the push. Not run, at Nabhanyu's call: the live
AI smoke and the replay recording (the proxy's account has no credit).

## Plan steps
- [x] Full audit protocol (TEST_CHECKLIST §2) across the whole repo, including a holdout match end to end.
- [x] `/security-review` of the full diff since `t01-verified`; fix or document findings.
- [ ] Redeploy, public E2E, live AI smoke. *(Redeploy and public E2E done on both names; the live AI smoke skipped.)*
- [x] `docs/SUBMISSION.md`.
- [x] `docs/DEMO_SCRIPT.md`.
- [ ] Push to GitHub. *(From the tag, after it: D-078.)*
- [ ] Submission zip. *(From the tag, after it: D-078.)*
- [x] README final pass; tag `t10-verified`.

## Log (newest last)
- **Baseline** at HANDOFF10's commit: `pnpm verify` green (59 files, 739 tests), `pnpm test:e2e` 26 passed (4.2 min);
  both names answer `"ok":true` (the domain since Nabhanyu ran `sudo deploy/install.sh`).
- **Holdout:** 1512772, the 2026 semi-final at the Wankhede (India 253/7 beat England 246/7 by 7 runs), named
  nowhere in the code or data (only as a suggestion in HANDOFF10). Engine vs oracle on `gen_fixtures.py` fixtures:
  IDENTICAL (2 innings, 18 batter lines, 12 bowler lines, 14 wickets, 22 fantasy players). Whole sessions
  (`holdout_data.py`, `holdout_sessions.ts`): `AUDIT OK`, scripted and keyless; checked by hand against the raw file:
  the inspector's 259 deliveries and 499 runs are the file's; the pre-match persona (Samson captain, Salt
  vice-captain) gets a bailout at 2:1.1, where the raw file has Salt caught first ball of the chase's second over;
  the story's beats are the lineup, that bailout, the late joiner's catch-up, the climax and room read at 2:19.6 (the
  last ball) and the result.
- **Archive sweep** (`run_sweep.sh`, the zip with sha256 `df5e2fa7…a742`, as at the baseline): 199 IDENTICAL, 31
  engine rejections by the same documented reasons (BUG-002), `TOTAL mismatches: 0` over 51 check categories:
  unchanged from the Task 2 baseline.
- **Models:** rebuilt from the recorded T20I zip (sha256 `95305bc2…860a`): `3,093 used`, threshold `0.18437…`, and
  `git status --short data/models` empty (byte-identical). The holdout's win probability, the batting side's after each
  over: India 0.57 after the first over, 0.52 after the 1.6 wicket, rising to 0.97 at 253/7; England's chase 0.05
  after the first over, falling with each wicket to 0.00 at the last ball, so the winner ends at 1.
- **Mutants:** the standing table on a scratch copy without `.env`: `mutate: 18 killed, 0 survived` (baseline 18/0).
- **Security review** (the `/security-review` skill needs a remote branch, which this repository does not have, so
  the review was done by hand over the same diff, `t01-verified..HEAD`, Review focus 5 first): one finding, BUG-005.
  The SQL sandbox answered "timeout" at 2 s, but its worker thread, inside SQLite's native loop, kept computing (a
  core per query, its slot freed), and anyone can send such SQL through the inspector. Fixed test first (D-078): the
  new test failed on the thread with 960 ms of CPU in the second after the timeout, the fix runs each query in a child
  process that is killed, and a mutant that answered without killing failed it too (1,940 ms). On production: a
  seven-way cross join of both squads through the public inspector answered `timeout` after 2,066 ms, the server had
  no child left, and it used 10 ms of CPU in the next 3 s. Other findings, documented and left as follow-ups (each
  is a denial of service with a bound already in place): see Follow-ups 2-4.
- **Docs:** SUBMISSION (the note: 184 words with the links), DEMO_SCRIPT, BUG-005, D-078, README (clone-and-run, the
  status, every route), PLAN, Architecture, Flow §14 and §16, ROLLBACK, the register, the deploy README; every path to
  the working copy names its new folder.
- **Redeploy and production:** `deploy/update.sh main` (e7297a0) with both names healthy; the public E2E 26 passed on
  each name; the sandbox, the limits and the headers checked by hand there (Verification). Lighthouse on the domain
  (the landing's code unchanged since `t09-verified`; only chunk names moved): accessibility 100 and best practices 96
  in all six runs, performance lower than at Task 9 (phone 87, 89, 75; desktop 78, 75, 73), every loss in blocking
  time (350-950 ms) while this host's load average was 7-8: the remote desktop session (gnome-shell, Chrome Remote
  Desktop, Xorg) used about a core and the server itself was idle. D-077's note holds: measure on a quiet host.

## After the tag
- **A fresh clone on this host failed two deploy tests.** `pnpm verify` in the public copy (a clone of `t10-verified`
  whose history is scrubbed) failed `install.sh --dry-run prints every step and changes nothing` and `install.sh
  --domain '' serves the sslip.io name alone`: `update: error: /srv/sideline is not a deploy checkout of
  …/Sideline-Dream11FDEAssignment (origin: …)`. The install dry runs planned against this host's real `/srv/sideline`,
  whose `origin` is the working copy, so they passed only in that copy or on a host without `/srv/sideline` (any
  reviewer's clone). Behind it, the second test also read the working copy's `.env` (it passed no `--env-file`), so it
  would fail in every fresh clone, on any host (`…/Sideline-Dream11FDEAssignment/.env: not found`). Fixed test first in
  a commit after the tag, which stays where it was (Constraint 21): the tests now give each install dry run its own
  deploy checkout, with a new `install.sh --dir <path>` (default `/srv/sideline`, as `update.sh --dir` already had;
  they failed first with `unknown option --dir`), and the test's own environment file. The same commit goes to the
  public copy as a patch (D-078), where `pnpm verify` then passes.

## What worked / what did not
- Worked: measuring a stopped query's CPU found what the 2 s test could not (it checked when the answer came, not
  whether the work stopped); a trial scrub on a throwaway clone, checked tree by tree, before touching the real one.
- Did not: the `/security-review` skill (it diffs against `origin/HEAD`, and there is no remote until the push).

## Decisions made
D-078 (the sandbox's process; the two copies of the repository; the skipped live AI steps; the zip and the push
after the tag).

## Verification (paste real output)
```
pnpm verify (main, with the fix and the docs)
packages/engine typecheck: Done / apps/web typecheck: Done / apps/server typecheck: Done
Checked 271 files in 974ms. No fixes applied.
 Test Files  59 passed (59)
      Tests  740 passed (740)
check-no-hardcode: OK (162 source files, 209 terms; 346 tracked files, no forbidden words)
verify-data: OK (2 matches)
✓ built in 859ms

engine vs oracle   1298150: IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 11 bowler lines, 14 wickets, 22 fantasy players
                   1415755: IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 12 bowler lines, 15 wickets, 22 fantasy players
holdout 1512772    IDENTICAL: 0 differences; compared 2 innings, 18 batter lines, 12 bowler lines, 14 wickets, 22 fantasy players
holdout_sessions   scripted inspector: ok [{"deliveries":259,"runs":499}] … AUDIT OK
run_sweep.sh       199 IDENTICAL, 31 ENGINE_REJECTS; TOTAL mismatches: 0; check categories ok: 51
mutate.py          mutate: 18 killed, 0 survived

sql.test.ts before the fix   AssertionError: expected 960 to be less than 500
            the mutant       AssertionError: expected 1940 to be less than 500
            after the fix    Tests  32 passed (32)

deploy/update.sh main        update: deployed e7297a0 (main) at https://3-108-67-100.sslip.io/ (both names healthy)
production inspector         {'source': 'you', 'status': 'timeout', 'reason': 'the query ran past 2 s and was stopped'}
                             answered after 2066 ms; children of the server now: 0; CPU over the next 3 s: 10 ms
                             DELETE FROM ai_calls → {'status': 'refused', 'reason': 'only SELECT or WITH queries are allowed'}
five spoofed X-Forwarded-For 200 200 200 200 429
headers (both names)         HTTP/2 200, the CSP, x-frame-options: DENY, nosniff, strict-transport-security; http → 308
PLAYWRIGHT_BASE_URL=https://sideline.nabhanyubm.tech pnpm test:e2e    26 passed (3.7m)
PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e       26 passed (3.8m)
pnpm test:e2e (local, the fixed code)                                  26 passed (4.2m)
build-models --zip <95305bc2…860a>   3,093 used (train 2,486, test 607); nudgeThreshold 0.18437096987916934; data/models unchanged
Lighthouse 13.5.0 on https://sideline.nabhanyubm.tech/ (load average 7-8)
phone:   performance 87, 89, 75; accessibility 100; best practices 96 (FCP 2.1 s, LCP 2.1-2.3 s, TBT 350-950 ms, CLS 0.007)
desktop: performance 78, 75, 73; accessibility 100; best practices 96 (FCP 0.4-0.5 s, LCP 0.5 s, TBT 530-770 ms, CLS 0.007)
```

## Follow-ups (out of scope, noted for later)
1. The live AI smoke and the replay recording, once the proxy's account has credit (D-067, D-078).
2. `POST /api/sessions` has no per-address limit: 300 sessions with open streams would turn new visitors away
   (503 busy); idle sessions are evicted, and the AI spend stays under the daily budget and the 80-call session cap.
3. The per-address buckets count an exact address; an IPv6 client with a /64 has many. Keying IPv6 by its /64
   would close it; the daily budget bounds the cost meanwhile.
4. A sandboxed query can still allocate memory fast for its 2 s (a `group_concat` over a cross join);
   `node:sqlite`'s limits (`limits.length`) could cap a value's size.
5. F09's follow-ups 2 (the story's stop card below the fold on a phone: seen again in the bailout stop's screenshot)
   and 3 (quest picks forgotten on reload).
6. Lighthouse's performance score on this shared host follows its load (D-077); prerendering the landing's HTML stays
   the next step if a quiet run on production falls under 90.

## Audit notes (filled by the auditor)
The final audit; Claude also implemented Tasks 3-9 and this task's fix, so it is partly a self-audit (Codex
implemented Task 2). CLAUDE.md protocol and TEST_CHECKLIST §2 over the whole repository:
- **A. Anti-hardcoding:** `check:hardcode` green; no `hardcode-ok` in `apps` or `packages`; the golden-number grep's
  hits are all schema lengths (160 characters), the win-probability model's documented 160-run scale, SVG layout
  coordinates and effect timings; prompts and fallbacks interpolate facts.
- **B. Engine vs oracle:** IDENTICAL on both matches.
- **C. Holdout:** 1512772 end to end (engine vs oracle, whole sessions, the story plan), and the whole archive.
- **D. Test quality:** no `.skip` or `.only`; the standing mutants 18 of 18; the new test watched failing on the old
  code and on a mutant of the fix.
- **E. Docs:** current (see the log); no golden file, oracle file or existing expectation changed.
- **F. Security:** `.env` untracked and 600; no key-shaped string and no key prefix in either bundle; the key's first 8
  characters appear 0 times in the service journal; `/etc/sideline` denied to the developer; the headers and the
  per-address limit hold on production; BUG-005 fixed.
- **G. UI:** the E2E (desktop and 390 px, light and dark, reduced motion) locally and on production.
Accepted: `t10-verified`.
