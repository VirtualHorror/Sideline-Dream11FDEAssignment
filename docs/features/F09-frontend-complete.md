# F09: Frontend II (phases 1-2 UI, room read, inspector, personas, story mode, polish)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 9 in `docs/PLAN.md`
- **Branch:** `task/08-09-skills-frontend` (one branch with Task 8, D-069; Task 8 merged first, D-075)
- **Owner / session:** Claude (Codex unavailable), 2026-10-17/18, one session with Task 8 at Nabhanyu's request
- **Status:** audited and merged (`t09-verified`)

## Scope
The complete product: a card for every moment kind (the lineup ledger, the comeback quest with its shareable
banter card, room-read pods, the stat-back take card), the fan's own chat line and take, the inspector in the
control plane, the guided story mode, and the `/architecture` polish (the theses, the pipeline picture, the live
"when we don't call AI" table, the plan timeline, credits). Not in scope: new skills or contracts beyond what the
story and the inspector's views need (D-076), recording real replay rows (no credit on the key, D-067).

## Plan steps
- [x] **9.1** Card components render their payloads and provenance; quest predictions update to won/lost as events arrive
- [x] **9.2** Inspector UI shows the generated SQL, rows and errors; rejected SQL shows the reason
- [x] **9.3** Story director: the stop sequence derives from triggers; leaving the tour restores manual control
- [x] **9.4** E2E: full story mode on desktop and 390 px; `/architecture` with the diagram, the live AI-usage table (non-zero after a story run) and the timeline; no console errors; a reduced-motion run
- [x] **9.5** Polish: keyboard, focus order, polite `aria-live`, contrast, landing Lighthouse ≥ 90 (numbers recorded) *(accessibility 100 every run; on production after the deploy, performance 92 on the phone preset and 90 on desktop; locally 79-98 on this busy host: D-077)*
- [x] **9.6** `pnpm verify` + `pnpm test:e2e` green; docs

## Log (newest last)
- **9.1 cards.** One component per kind, each with its own shape (DESIGN_SYSTEM §7) and each held on the TV clock by
  a shared `HeldCard` (empty bars under the veil, nothing of the moment in the DOM). The lineup ledger takes the fan's
  request until the first ball on their TV. The quest's calls are settled in the browser by the engine's
  `resolveQuestRule` on the events the TV has shown (tests: Rizwan's wicket at legal ball 24 and no six in balls
  8-25, from the raw file). The banter card draws a 1080 px PNG on a canvas and shares it with the Web Share API (the
  file where the browser can share files, else the text), else downloads it. The store merges the fan's own chat
  lines (stamped on their TV clock) in time order; a first version of that test passed for the wrong reason (the
  missing action returned undefined and the helper fell back to a fresh state) and was tightened before the code.
  Bailout and room traces in the control plane now wait for their ball on the TV like teasers'.
- **9.2 inspector.** In the control plane: a question, the model's SQL in an editable box (or the fan's own), the
  rows, and every outcome in words (refused with the reason, stopped at 2 s, SQLite's error, busy, no query); the
  views come from `GET /api/inspector/views`.
- **9.3 story.** The plan is built in the engine from the personas and the gate's triggers (`buildStoryPlan`, served
  by `GET /api/matches/:matchId/story`), so the browser knows where to jump without knowing what happens there. The
  director is a pure state machine; its test drives it with a fake session on the real 2022 plan. Writing the
  overlay showed a bug the first test missed: continuing from the climax's teaser stop never resumed play; a test
  now pins the `play` after it.
- **9.4 E2E and /architecture.** `e2e/story.spec.ts` runs the whole story on desktop (2.0 min) and 390 px (1.6 min),
  stop by stop with each card on screen, then checks `/architecture`'s live table counts the run; a reduced-motion run
  leaves the tour and gets the controls back. `/architecture` renders the theses and credits from the files, the
  pipeline as an inline SVG (across, or down below 640 px), the live table and the timeline.
- **9.5 polish.** Keyboard: every new control is a native button, input or details element; focus moves to
  "Continue" at each story stop. `aria-live="polite"` on the feed, the story line, the inspector's result and the
  share status. Contrast: "Backed" in `--four` was 4.39:1 on white, now `--four-fill` (5.96:1 light, 8.52:1 dark).
  Lighthouse on the landing (D-077): accessibility 100 and best practices 96 from the start; performance 50 on the
  phone preset, traced to the floodlight's main-thread colour cycle, then raised by a compositor-only floodlight, the
  room loaded on demand, the wordmark's WebGL on the first pointer and the picker's reserved space. The same build
  scores 87-92 (phone) and 79-98 (desktop) on this busy host.

## What worked / what did not
- Worked: beats from the engine's own triggers made the story both data-driven and fast to test; measuring with
  reduced motion and with WebGL off found the floodlight's cost in two runs.
- Did not: a quarter-size floodlight scaled up and a stepped drift (no gain, reverted); hiding the "uses AI" section
  until the picker loaded (it moved the footer instead: CLS 0.42, reverted for the reserved height).

## Decisions made
D-076 (story mode and the Task 9 surfaces), D-077 (the landing's performance pass and its measurement).

## Verification (paste real output)
```
pnpm verify (task/08-09-skills-frontend at 5ae7eff)
packages/engine typecheck: Done / apps/web typecheck: Done / apps/server typecheck: Done
Checked 270 files in 867ms. No fixes applied.
 Test Files  59 passed (59)
      Tests  739 passed (739)
check-no-hardcode: OK (162 source files, 209 terms; 343 tracked files, no forbidden words)
verify-data: OK (2 matches)
✓ built in 828ms

pnpm test:e2e                                          26 passed (4.1m)

Lighthouse 13.5.0, landing behind a local Caddy with zstd/gzip (D-077)
phone:   performance 92, 92, 90 on quieter runs; 87-89 under load; accessibility 100; best practices 96
desktop: performance 98, 89, 88 on quieter runs; 79-86 under load; accessibility 100; best practices 96

deploy/update.sh t09-verified          update: deployed 6cdcb06 (t09-verified) at https://3-108-67-100.sslip.io/
production's stream (late-from-work)   "aiMode":"replay" in hello and telemetry (the key has no credit: D-071)
PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e      26 passed (3.8m)
Lighthouse on https://3-108-67-100.sslip.io/ (production's Caddy)
phone:   performance 92, accessibility 100, best practices 96 (FCP 2.1 s, LCP 2.3 s, TBT 230 ms, CLS 0)
desktop: performance 90, accessibility 100, best practices 96 (FCP 0.4 s, LCP 0.5 s, TBT 260 ms, CLS 0.007)
```

## Follow-ups (out of scope, noted for later)
1. Lighthouse's performance score swings about ten points on this shared host (production measured 92 and 90 after
   the deploy); Task 10 measures again, and prerendering the landing's HTML is the next step if a phone run falls
   under 90 (D-077).
2. On a phone the story's stop card can sit just below the fold (the room read under the 18.6 card); the overlay
   could scroll the card into view after moving focus to "Continue".
3. Fan picks in quests and polls live in the card's state for the session; a reload forgets them.

## Audit notes (filled by the auditor)
Self-audit (Claude implemented Task 9; Codex unavailable), 2026-10-18, CLAUDE.md protocol and TEST_CHECKLIST §2:
- **A. Anti-hardcoding:** `check:hardcode` caught one real finding during the audit: the chat composer's placeholder
  named a player ("Kohli"); now neutral. No `hardcode-ok`; the diff since `t08-verified` has no golden numbers and no
  comparison with a label, seq, over or id; story beats come from `buildStoryPlan` (personas and triggers).
- **B. Engine vs oracle:** no change to the timeline, reducer or scoring since the Task 8 audit (IDENTICAL on both
  matches and the holdout 1512773).
- **C. Holdout:** the story plan on 1512773 with the audit personas follows that match's own triggers: the lineup
  patch (the invented bench pick), no bailout (Samson 89, Seifert 52: none cheap), the late joiner's jump to 14 overs
  of the chase, the match-deciding ball at 2:18.6 and its room read, the result.
- **D. Test quality:** literals from the raw file (quest outcomes) and the real plan. Hand mutants (the long loop
  skipped at the owner's request): 10 of the Task 9 code; 8 killed at once, 2 survivors were test gaps (where the
  climax lands without a late joiner; the chat merge's reorder, which the test never exercised), both now pinned and
  killed: 10 of 10.
- **E. Docs:** F09, D-076, D-077, Flow §17, Architecture §3 and §9, DESIGN_SYSTEM statuses, VISUAL_REFERENCES as built,
  TEST_CHECKLIST (E2E 26, the Lighthouse row), ROLLBACK, the register, README, PLAN.
- **F. Security:** no key-shaped string in the bundle; the inspector UI only talks to the sandboxed route; CSP and
  headers unchanged; no new dependency (Lighthouse ran from a scratch directory).
- **G. UI:** screenshots reviewed at 1440 and 390 px in both themes (the landing with the reworked floodlight, the
  story's bailout and room-read stops); keyboard: native controls, focus to "Continue" at each stop; contrast fixed
  for "Backed"; `aria-live` polite on the feed, the story line and the inspector.
Accepted: `t09-verified`.
