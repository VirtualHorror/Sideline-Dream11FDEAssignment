# F09: Frontend II (phases 1-2 UI, room read, inspector, personas, story mode, polish)

> One file per feature or task, start to finish. Anyone (human or AI) should be able to read this
> cold and pick up exactly where it stopped.

- **Task:** 9 in `docs/PLAN.md`
- **Branch:** `task/08-09-skills-frontend` (one branch with Task 8, D-069; Task 8 merged first, D-075)
- **Owner / session:** Claude (Codex unavailable), 2026-10-17/18, one session with Task 8 at Nabhanyu's request
- **Status:** in progress

## Scope
The complete product: a card for every moment kind (the lineup ledger, the comeback quest with its shareable
banter card, room-read pods, the stat-back take card), the fan's own chat line and take, the inspector in the
control plane, the guided story mode, and the `/architecture` polish (the theses, the pipeline picture, the live
"when we don't call AI" table, the plan timeline, credits). Not in scope: new skills or contracts beyond what the
story and the inspector's views need (D-076), recording real replay rows (no credit on the key, D-067).

## Plan steps
- [ ] **9.1** Card components render their payloads and provenance; quest predictions update to won/lost as events arrive
- [ ] **9.2** Inspector UI shows the generated SQL, rows and errors; rejected SQL shows the reason
- [ ] **9.3** Story director: the stop sequence derives from triggers; leaving the tour restores manual control
- [ ] **9.4** E2E: full story mode on desktop and 390 px; `/architecture` with the diagram, the live AI-usage table (non-zero after a story run) and the timeline; no console errors; a reduced-motion run
- [ ] **9.5** Polish: keyboard, focus order, polite `aria-live`, contrast, landing Lighthouse ≥ 90 (numbers recorded)
- [ ] **9.6** `pnpm verify` + `pnpm test:e2e` green; docs

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

## Follow-ups (out of scope, noted for later)
1. Lighthouse's performance score swings about ten points on this shared host; measure on a quiet machine or with
   PageSpeed Insights against the public URL (an external service: ask the owner), and prerender the landing's HTML
   if the phone score stays under 90 (D-077).
2. On a phone the story's stop card can sit just below the fold (the room read under the 18.6 card); the overlay
   could scroll the card into view after moving focus to "Continue".
3. Fan picks in quests and polls live in the card's state for the session; a reload forgets them.

## Audit notes (filled by the auditor)
