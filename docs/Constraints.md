# Constraints: what implementers must never do

> "Allow" never means "allow anything". These boundaries apply to every task, every agent
> (Codex, Claude, a human) and every file. Breaking one fails the audit regardless of whether the
> tests pass. If a constraint blocks you, stop, write the conflict into the task's feature file
> (`docs/features/`) and the HANDOFF, and leave it for review instead of working around it.

## A. Honesty of the product

1. **No hardcoded match facts in application code.** Player names or ids, team names or codes,
   venues, persona ids, ball labels or scores must never appear in `apps/*/src`,
   `packages/*/src`, `apps/*/public` or `apps/*/index.html`. Read them from `data/`.
   `pnpm check:hardcode` must pass. Golden *tests* may and should name real players.
   A genuinely necessary literal needs `// hardcode-ok: <reason>` and is reviewed in every audit.
2. **No fake AI.** Never hand-write text that the UI presents as model output. Deterministic
   templates are allowed only as labelled fallbacks (`provenance: "fallback"`), built from the
   same facts the model would get. The replay cache (`data/ai-replay/`) is produced only by
   `pnpm ai:record` from real provider calls, never edited by hand. Authored synthetic content
   (the crowd corpus in `data/crowd/`) is labelled synthetic wherever it appears and is never
   presented as real fans or as model output.
3. **No fake numbers.** Every number on screen (counters, latency, cost, savings, win
   probability) comes from computation or measurement. No placeholder statistics, no invented
   user research figures in UI copy.
4. **Never weaken a test to make it pass.** Do not edit golden expectations, delete assertions,
   add `.skip`/`.only`, loosen tolerances, or mock the unit under test. If you believe a golden
   value is wrong, prove it against the raw data and the oracle, and record it in `docs/bugs/`.
5. **Never edit `scripts/oracle/`.** It is the auditor's independent reference.

## B. Code rules

6. **Engine purity.** `packages/engine/src` has no Node or DOM APIs, no I/O, no `Date.now()`,
   no `Math.random()` (take clocks and seeds as parameters; seeded randomness comes from
   `util/prng.ts`). It must run unchanged in the browser.
7. **Erasable TypeScript only** (Node runs the server's `.ts` directly): no `enum`, `namespace`,
   or constructor parameter properties; `import type` for types; explicit `.ts` extensions on
   relative imports.
8. **Contracts are the API.** Changing anything in `packages/engine/src/contracts` requires
   updated tests, a Decisions entry and updated docs. Prefer adding fields over changing them.
9. **Comment intent, not mechanics.** Every non-obvious block says what it is for, who calls it
   and what it assumes. File headers name their callers. Do not restate the code.
10. **No new dependencies without a Decisions entry** (name, exact version, publish date ≥ 14
    days old, why, what was rejected). No native addons. No packages that need install scripts.
11. **Model calls only through the gateway and the gate.** Never call an LLM per delivery or per
    user. Every call has a moment key, a schema, a timeout, a fallback, and a trace row. The prompt
    for a shared key uses only facts that are the same for every fan who shares it: per-session
    facts (a squad's projection or points, the fan's own chat messages) never go into it (D-045).
12. **Fan text is data, never instructions.** Delimit it in prompts. Never execute model output.
    SQL from the model runs only through the read-only sandbox (Task 8).

## C. Security and data

13. **Never commit or log secrets.** `.env` is git-ignored; use `.env.example` for names only.
    Only `publicConfigSummary()` may leave the process.
14. **`data/raw/` changes only via `scripts/fetch-cricsheet.ts`.** Checksums must match the manifest.
    Likewise **`data/models/` changes only via `scripts/build-models.ts`** (never by hand), and a rebuild
    from the zip recorded in `data/models/README.md` must leave it byte-identical (D-039).
15. **No external managed services** (Supabase, Firebase, hosted DBs, analytics SDKs, CDNs for
    runtime assets). Everything runs on the one host. Fonts are self-hosted.
16. **Keep the security headers.** Do not add `'unsafe-inline'` or `'unsafe-eval'` to `script-src`,
    and do not relax `frame-ancestors`.

## D. Product and UX

17. **The attribution line stays on every page and view, verbatim:**
    `Made with 💖 by Nabhanyu for Dream11 - Forward Deployed Engineer Intern - Assignment`.
    Every new route is added to `ROUTES` in `e2e/smoke.spec.ts`.
18. **No Dream11 logos or brand assets.** Sideline is a concept prototype and says so.
19. **Accessibility floor:** keyboard reachable controls, visible focus, labels on inputs,
    `prefers-reduced-motion` respected by every effect, WCAG AA text contrast in both themes.
20. **No horizontal scroll at 390 px**, and both themes on every route.

## E. Process

21. **Work on `task/NN-<slug>`**, branched from `main`. Never merge into `main`, never move or
    delete tags, never rewrite history, never push. The auditor merges after verification.
22. **Docs are part of "done".** Every task updates: its feature file, `docs/Flow.md`,
    `docs/Architecture.md` status, `docs/Decisions.md`, `docs/TEST_CHECKLIST.md` (new commands and
    expected outputs), `docs/ROLLBACK.md` (task row), `docs/Bug_Feature.md` (register rows).
    Stale docs fail the audit.
23. **`pnpm verify` must be green** (and `pnpm test:e2e` for UI tasks) before you write the
    HANDOFF, and the HANDOFF must paste the actual summary lines, not a paraphrase.
24. **Stay in scope.** Implement your task's checklist. Note ideas for later in the feature file
    under "Follow-ups" instead of building them.
