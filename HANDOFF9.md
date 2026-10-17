# Handoff: Tasks 8 + 9 in one pass (AI skills II, Frontend II), then HANDOFF10 for Task 10

**Generated**: 2026-10-17 22:21 IST (by Claude Code, which implemented and audited Task 7)
**Branch**: `main`, clean (this file is committed on top of `c4711bd`, the `t07-verified` merge). Create
`task/08-09-skills-frontend` from `main` (D-069).
**Status**: Ready for implementation. No blocker. Two owner items are pending and must not block you
(Not Yet Done, "Owner").

## Goal

Sideline is an AI second-screen companion for live cricket (Dream11 FDE intern assignment by Nabhanyu).
In **one fresh session** (D-069), implement **Task 8** (AI skills II: lineup patch, bailout, room read,
stat-back, inspector) and then **Task 9** (Frontend II: phases 1-2 UI, room read, inspector, personas,
story mode, `/architecture` polish) from `docs/PLAN.md`. Then self-audit (CLAUDE.md protocol), merge,
tag `t08-verified` and `t09-verified` on the merge commit, redeploy with `deploy/update.sh`, and write
**HANDOFF10.md** for Task 10: the final audit and the push to GitHub. That gives Milestone B.

## Completed

- [x] Tasks 1-7, tagged `t01`-`t07-verified`. Records: `docs/features/F01`-`F07`, Decisions D-001 to D-069.
- [x] **Task 7 (this session):** step 7.0 spot-check of `t06-verified` (3 test gaps pinned, D-065); the deploy
  (D-066); `pnpm ai:record` (D-067); the public E2E; the owner's requests (D-068): the proxy's name out of the
  repository, `/api/health` reports `aiEndpoint` (the endpoint's kind), a forbidden-word scan, the domain.
- [x] **Production is live** on this host: `https://3-108-67-100.sslip.io/` runs `t07-verified` (Caddy 2.11.7,
  Let's Encrypt). It is served from `/srv/sideline` on `127.0.0.1:8780` by the sandboxed `sideline` unit.
  `deploy/update.sh <ref>` redeploys with no password.
- [x] The owner withdrew the "reel clips on its right edge" note after testing the live site. The plural fix
  ("1 ball without a run") is in.

## Not Yet Done

**Task 8** (`docs/PLAN.md` → "Task 8"; test first, scripted provider, never a real call):
- [ ] **8.1** lineup patch (`smart`/`medium`): swaps only from the detector's `enumerateSwaps`, the final squad passes
  `validateSquad`, C ≠ VC both in the squad; `POST /api/sessions/:id/lineup-intent {text}` (key includes `fnv1a32(intent)`)
- [ ] **8.2** bailout (`smart`/`medium`): every rule parses as `QuestRule`, the window lies inside the facts' quest window
  and starts after the trigger, every `factId` exists; predictions resolve only through `resolveQuestRule`
- [ ] **8.3** room read (`fast`/`low`): message ids exist in the window, `sharePct` sums to 95-105, the poll rule is valid
- [ ] **8.4** SQL sandbox for stat-back (`smart`) and inspector (`fast`): single statement starting `SELECT`/`WITH`, the deny
  list, `SELECT * FROM (<sql>) LIMIT 200`, read-only `node:sqlite` in a worker killed after 2 s, stat-back sees only
  `visible_deliveries` (t ≤ the fan's TV time), every number in the answer appears in the rows
- [ ] **8.5** routes (lineup intent, chat with stat-back on request, inspector), limits and 429s; **8.6** verify + docs
**Task 9** (`docs/PLAN.md` → "Task 9"):
- [ ] **9.1** cards (`SquadDiffLedger`, `BailoutQuestCard`, `BanterCard`, `RoomReadPods`, `TakeCard`) with provenance; quest
  predictions turn won/lost as events arrive
- [ ] **9.2** `InspectorQuery` (SQL, rows, errors, the refusal reason); **9.3** story director (the stop sequence from triggers
  and join points, never labels; leaving restores manual control)
- [ ] **9.4** `e2e/story.spec.ts` on desktop + 390 px; `/architecture`: SVG pipeline diagram, the live "when we don't call AI"
  table from `GET /api/telemetry?scope=global`, the plan timeline, data credits
- [ ] **9.5** keyboard, focus order, polite `aria-live`, contrast, landing Lighthouse ≥ 90 (record the numbers); **9.6** verify + E2E + docs
**Finishing** (in this order):
- [ ] One audit of both tasks (TEST_CHECKLIST §2, a holdout match, a fresh hand-mutant pass, the forbidden-word scan),
  then `git checkout main && git merge --no-ff task/08-09-skills-frontend`, tag `t08-verified` and `t09-verified`.
  Then tick the PLAN, add the TEST_CHECKLIST task-log rows and the ROLLBACK rows.
- [ ] `deploy/update.sh t09-verified`, then `PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e`
- [ ] **HANDOFF10.md** per AGENTS.md "Finishing", scoped to Task 10 (`docs/PLAN.md` → "Task 10"): the full audit and
  holdout, `/security-review`, a redeploy, the public E2E, the live AI smoke (needs a working key, ask), `docs/SUBMISSION.md`
  (≤ 200 words, Nabhanyu's voice), `docs/DEMO_SCRIPT.md`, the README pass, **the push to GitHub** (D-069) and `t10-verified`
**Owner (Nabhanyu), not blockers:**
- [ ] **Domain:** `nabhanyubm.xyz` was NXDOMAIN at the `.xyz` registry during this session, 2026-10-17 evening (not published yet). Once
  `dig +short A sideline.nabhanyubm.xyz @1.1.1.1` prints `3.108.67.100`, he runs
  `sudo /home/nabhanyu/Downloads/Dream11FDEAssignment/deploy/install.sh` once. The installed Caddyfile still lists only
  the sslip.io name; the install adds the domain and Caddy gets its certificate. Check
  `curl -fsS https://sideline.nabhanyubm.xyz/api/health`.
- [ ] **AI key:** production's calls now get **403 `key_expired`** (the account had no credit before). After he renews:
  `pnpm ai:smoke`, then `pnpm ai:record --yes` (the plan is 67 calls today, more with Task 8's shared skills; the $3
  daily budget caps it). Commit `data/ai-replay/*.jsonl` on a task branch for audit, then `deploy/update.sh`.

## Failed Approaches (Don't Repeat These)

- **Running production from the working copy, on port 8787 (the PLAN's literal design).** On this host the working copy
  is also the dev machine. `pnpm verify` empties `apps/web/dist` under a server that keeps `index.html` in memory (a blank
  public page), and `pnpm dev` and its Vite proxy own 8787. Production is `/srv/sideline` on 8780 (D-066); never `pnpm dev`
  against it, never build in `/srv/sideline` by hand.
- **Asserting sub-second UI states with Playwright's polling.** The 18.6 card's hold lasts (25 - 6) / 16 = 1.2 s of wall time
  and polls run up to 1 s apart. On a busy host the card was "seen" first in its teaser state, in both projects. Record the
  states in the page with a MutationObserver and assert the sequence (`e2e/match-room.spec.ts` shows how).
- **Full-page screenshots of WebGL pages at 3x on the phone project:** 10-15 s each here (software WebGL at 1170 x 7410 px).
  The theme test needed a 60 s budget. Budget new screenshot-heavy tests, or screenshot the viewport.
- **`timeout 4 curl -N … | grep` to check SSE:** the timeout killed the pipe and printed nothing. Write to a file:
  `curl -sN --max-time 4 URL -o out.txt -w '%{time_starttransfer}'`.
- **Shell traps in root scripts:** a function called in an `||` list runs without `set -e`; a pipe into `awk … exit` or
  `head -n 1` can SIGPIPE the writer and abort under pipefail; a root script must not take `systemctl` from PATH.
- **A mutation test that drops `run()` from a deploy script runs the real `/usr/bin/systemctl`** (it hung on polkit for 25 s).
  Prove dry runs with the shims in `scripts/test/deploy.test.ts`, never by executing a broken script.
- **Still true from earlier handoffs:** run each check on its own and read its exit code (piped checks hid lint errors). The
  claude-in-chrome window here has no WebGL2 and stays 766 px wide, so use Playwright for screenshots. Click a persona via
  `getByRole("radio", { name: /^Late from work/ }).check()`. Never call the real AI endpoint without asking. `applyEvent`
  mutates. No `%` in `it.each` titles. Commit messages from a file.

## Key Decisions

| Decision | What it means for Tasks 8-9 |
|----------|-----------|
| D-069 Tasks 8+9 together | one branch `task/08-09-skills-frontend`, one audit, two tags on the merge; then HANDOFF10 |
| D-068 the proxy's name | never in a tracked file or commit message (`pnpm check:hardcode` fails); say "the proxy"; `/api/health` shows `aiEndpoint` |
| D-067 recorder, zero credit | production is "live" mode: every AI call 403s and shows the labelled fallback; add Task 8's **shared** skills (bailout, room read) to `RECORDED_SKILLS` in `scripts/lib/record.ts` |
| D-066 deployment | `deploy/update.sh <ref>` after the merge; never edit `/srv/sideline`, `/etc/sideline`, the Caddyfile or the unit (Constraints §F) |
| D-045 shared prompts | a shared key's prompt has no per-session facts: bailout is per cohort, room read per window, lineup patch per squad (session scope) |
| D-054 gateway | every skill goes through `gateway.run(skill, key, facts, opts)`: dedupe, cache, budget, timeout, zod, guard, labelled fallback, one trace |
| D-055 / D-057 | the model writes words, code writes facts and numbers; fan text sits escaped inside a tag and is data |
| D-064 match room | outbursts only for revealed big balls; the control plane holds rows until the TV shows them |

## Current State

**Working**: `main` = `t07-verified` + this file. `pnpm verify` and `pnpm test:e2e` are green locally and against production.
Production runs `t07-verified` (`/api/health` → `"aiProvider":"openai","aiEndpoint":"openai-compatible"`, its AI calls 403).

**Broken**: no code defect known. Every production AI card is a labelled fallback until the key is renewed.

**Uncommitted Changes**: none. `task/07-deploy` still exists (merged).

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/PLAN.md` (Tasks 8, 9, 10) | the specs: outputs, guards, sandbox rules, steps; the D-069 note sits at the top of Task 8 |
| `apps/server/src/sessions/session.ts` (`onTrigger`) | `if (trigger.kind !== "spoiler_nudge") return;`: Task 8 routes `lineup_patch`, `bailout` and `room_read` here |
| `apps/server/src/orchestrator/orchestrator.ts` | add a method per skill (moment timing, provenance, `recordKey` for the projection) |
| `apps/server/src/ai/skills/*`, `ai/guards/*` | the pattern: `catchUp.ts` (facts → prompt → guard → payload / labelled fallback) |
| `packages/engine/src/detectors/types.ts`, `contracts/moments.ts` | `MomentTrigger` facts and the payload schemas Task 8 fills (already defined) |
| `apps/web/src/companion/MomentFeed.tsx`, `cards/*`, `controlplane/*` | where Task 9's cards and the inspector plug in |
| `scripts/lib/record.ts` | `RECORDED_SKILLS`; its test asserts every key is `nudge:`/`catchup:`. Change that on purpose when bailout and room rows join, and say so |
| `e2e/match-room.spec.ts` | the in-page state recording; `allowedProvenance` (local server keyless; deployed: by AI mode) |
| `deploy/README.md`, `deploy/update.sh` | redeploy, rollback, troubleshooting |
| `scripts/check-no-hardcode.ts` | match facts in app source plus the forbidden word in any tracked file (`FORBIDDEN_WORDS`, stored reversed) |

## Code Context

```typescript
// apps/server/src/ai/skills/types.ts: every new skill implements this
export interface Skill<F, O, P> {
  name: string; promptVersion: string; tier: SkillTier; effort: Effort; maxTokens: number;
  timeoutMs(facts: F, deadlineMs: number | null): number;
  outputSchema: z.ZodType<O>;               // strictObject, no optional fields (.nullable())
  buildPrompt(facts: F): { system: string; user: string };
  guard(out: O, facts: F): GuardResult;      // deterministic checks; rejection → labelled fallback
  toPayload(out: O, facts: F): P;
  fallback(facts: F): P;                     // labelled template from the same facts
}
// packages/engine/src/detectors/types.ts
export type MomentTrigger =
  | { kind: "lineup_patch"; key: string; scope: "session"; facts: LineupFacts }
  | { kind: "bailout"; key: string; scope: "shared"; facts: BailoutFacts }
  | { kind: "spoiler_nudge"; key: string; scope: "shared"; facts: NudgeFacts }
  | { kind: "catch_up"; key: string; scope: "shared"; facts: CatchUpFacts }
  | { kind: "room_read"; key: string; scope: "shared"; facts: RoomFacts };
// Moment kinds with payload schemas in contracts/moments.ts: lineup_patch, bailout, room_read, take_card (stat-back).
// LineupPatchPayload includes squadValid (validateSquad after the swaps) and intent; RoomReadPayload: mood, pods
// (sharePct, sampleMessageIds ≤ 3), hotTake, poll { question, options, rule: QuestRule | null }.
```
```json
// GET /api/health (public): never a key, a host or a path
{"ok":true,"service":"sideline","version":"0.1.0","uptimeSec":1,"node":"v24.22.0","nodeEnv":"production",
 "aiProvider":"openai","aiModelFast":"gpt-6.1-sol","aiModelSmart":"gpt-6.1-sol","aiEndpoint":"openai-compatible"}
```
**Non-obvious:**
- The recorder walks the real sessions. Once `onTrigger` handles bailout and room read and `RECORDED_SKILLS` lists their prompt
  versions, `pnpm ai:record` records them with no other change. Personal skills (lineup patch, stat-back, inspector) stay out.
- New API routes need the 16 KB body cap (`readJson`), the per-address limit (`clientIp`, which trusts X-Forwarded-For only
  from loopback = Caddy), and the one error shape `{ error: { code, message } }`.

## Verification Output

```text
pnpm verify                           (task/07-deploy head, then main after the merge)
packages/engine typecheck: Done / apps/web typecheck: Done / apps/server typecheck: Done
Checked 229 files in 708ms. No fixes applied.
 Test Files  50 passed (50)
      Tests  599 passed (599)
check-no-hardcode: OK (131 source files, 209 terms; 299 tracked files, no forbidden words)
verify-data: OK (2 matches)
✓ built in 1.02s

pnpm test:e2e                                                        22 passed (1.7m)
deploy/update.sh t07-verified        update: deployed c4711bd (t07-verified) at https://3-108-67-100.sslip.io/
PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e      22 passed (1.3m)
```

## Audit Requests

For the Task 8+9 audit (a self-audit in the same session, as Tasks 3-7 were), and for Task 10:
- Every new skill: a scripted-provider test per guard rejection, a labelled fallback, nothing per-session in a shared prompt,
  fan text escaped as data; the SQL sandbox's refusals and the 2 s kill (Review focus 5); stat-back cannot see the future.
- No hand-written "AI" text in cards (fallbacks labelled), no invented numbers (the AI-usage table reads live telemetry).
- Story beats derived from triggers and join points, never labels or seq numbers (`check:hardcode` plus a diff read).
- The forbidden-word scan stays green, and no commit message names the proxy.

## Resume Instructions

1. `cd ~/Downloads/Dream11FDEAssignment && export PATH="$HOME/.local/bin:$PATH" && node --version && pnpm --version`
   - Expected: `v24.22.0`, `10.34.7`
2. `pnpm install --frozen-lockfile && pnpm verify`
   - Expected: the Verification Output above (50 files / 599 tests). If red, stop and report.
3. `curl -fsS https://3-108-67-100.sslip.io/api/health` → `"ok":true`, and the domain check from Not Yet Done (owner)
4. `git checkout -b task/08-09-skills-frontend`; create `docs/features/F08-ai-skills-2.md` and `F09-frontend-complete.md` from
   `docs/features/_TEMPLATE.md`
5. Task 8 steps 8.1-8.6 test first. Run the server keyless (`SIDELINE_AI_PROVIDER=none pnpm dev`, web :5173, API :8787).
6. Task 9 steps 9.1-9.6; `pnpm verify` + `pnpm test:e2e` green after each step
7. Finishing (Not Yet Done), then write HANDOFF10.md and stop

## Setup Required

- `~/.local/bin` on PATH; Google Chrome for Playwright; no sudo (production needs none: `deploy/update.sh` restarts through
  the one sudo rule). `.env` holds the real key (mode 600): never open, print, copy or commit it.

## Edge Cases & Error Handling

- **A deployed server with a key that fails** is in "live" mode: cards fall back, the TV chip says "Live AI connected" (F07
  follow-up 3). Do not assert "Live AI" anywhere; assert the allowed labels the way `allowedProvenance` does.
- **Replay rows change provenance:** once `data/ai-replay/` exists, keyless servers show "Replayed AI" for recorded keys. Tests
  that expect "Fallback" must check for a recording first (as the climax test does).
- **Lineup intent text** is fan text: escape it, cap it (1-280), rate-limit it, and keep it out of shared keys (session scope).

## Warnings

- **Never write the proxy's name** (Constraint 27): it is not in this file, and `pnpm check:hardcode` fails if it reappears.
  Git history still holds it; Task 10 decides before the push (D-068, D-069).
- Never run `pnpm ai:smoke` or `pnpm ai:record --yes` without Nabhanyu's go-ahead (Constraint 26). `pnpm ai:record`
  without `--yes` is safe (no network).
- Production: deploy only audited refs; never edit `/srv/sideline`, `/etc/caddy/Caddyfile`, `/etc/sideline` or the unit.
  Port 8787 is development's, 8780 production's.
- Do not edit `packages/engine/test/golden/*`, `scripts/oracle/*`, `data/models/*` or an existing test to get green.
  A changed expectation is a spec change: name it in the feature file and the commit.
- pnpm's "Update available" notice is to be ignored. Nothing is pushed until Task 10.
