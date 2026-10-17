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

## What worked / what did not

## Decisions made

## Verification (paste real output)

## Follow-ups (out of scope, noted for later)

## Audit notes (filled by the auditor)
