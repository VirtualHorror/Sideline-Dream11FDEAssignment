# F01: Foundation

- **Task:** 1 in `docs/PLAN.md`
- **Branch:** `main` (initial commit of a new repository), tagged `t01-verified`
- **Owner / session:** Claude Code (Opus 5.5), 2026-10-16
- **Status:** audited and merged (`t01-verified`)

## Scope

Everything later tasks stand on: a working toolchain on a bare host without sudo, the monorepo and
its quality gates, the cross-package contracts, real match data with provenance, the anti-hardcoding
and data guards, an independent oracle for audits, the web/server skeletons with the design tokens
and attribution, and the full documentation system. No match simulation, AI or real UI yet.

## Log (newest last)

1. **Host survey.** Ubuntu 24.04.5, 4 vCPU / 15 GiB, git/curl/python3 present; no Node, ffmpeg,
   sqlite3 or compiler; `sudo` needs a password. Decided: user-space installs (D-005), no native
   addons (D-009).
2. **Toolchain.** Node v24.22.0 tarball (SHA256 verified), pnpm 10.34.7 via corepack (pnpm 12 is
   latest but 10.x is maintained and better known; D-005), ffmpeg 7.0.2 static (md5 verified).
3. **Reference media.** Extracted frames and contact sheets with ffmpeg, sampled colours from raw
   pixels, wrote `docs/design/VISUAL_REFERENCES.md`. Findings: reference 1 = bottom light cone
   whose palette drifts blue → violet → pink plus a cursor-driven RGB-split "ghost" text;
   reference 2 = 4×4 Bayer dither of a warp-noise field that appears and fades; reference 3 =
   blurred conic halo around a dark input.
4. **Domain research.** Cricsheet match ids 1298150 and 1415755 found in the T20 World Cup archive;
   scorecards checked against public records; squads (incl. Fakhar Zaman's inclusion, Shan
   Masood's head blow, the 70% rain forecast) verified via web sources (URLs in `context.json`);
   Cricsheet match data licence changed to ODC-By 1.0 on 2026-10-07 (attribution added).
   Dream11 official points page returned 502, so the points table is illustrative data (D-012).
   Verified Dream11 vocabulary: Watch Along, Hit or Miss, DreamBucks (D-030).
5. **Runtime probe.** Confirmed Node 24 runs `.ts` directly through a pnpm-style symlink and that
   `node:sqlite` works without warnings, then chose no-build server execution (D-006). TypeScript
   7.0.2 adopted for type-checking only; probed that it reports type errors and blocks `process`
   inside the engine (D-008).
6. **Contracts (TDD).** Wrote 17 invariant tests first (a wide marked legal, totals that don't add
   up, mislabelled balls, names in id fields, …), watched them fail on the missing module,
   implemented the zod contracts, then a mutation check: removing the `isLegal` refinement made
   exactly the intended test fail.
7. **Squad validator (TDD).** 7 failing tests on a hand-built 22-player pool → `validateSquad`.
8. **Data.** `fetch-cricsheet.ts` reproduces the raw files from the official zip and records sha256
   in the manifest; authored players (with registry ids resolved from the people register; the
   ambiguous "Mohammad Wasim" resolved by cricinfo id), context notes and personas. Fixture tests
   (written first) prove every XI player maps to the right id, squads are 15, the bench is exactly
   the known bench, and every persona squad is legal.
9. **Server and web skeletons (TDD).** Config (provider detection, secret-free summary), Hono app
   (health, JSON 404 for unknown API routes, static + SPA fallback, traversal-safe, CSP). Web shell
   with tokens, Anek Latin, theme logic that survives throwing storage and missing `matchMedia`,
   Auto/Light/Dark control, attribution footer.
10. **Guards (TDD).** `check-no-hardcode.ts` (comment-aware, whole-word, deny-list built from
    data; 209 terms) and `verify-data.ts`, each with CLI tests on tampered copies of `data/`.
11. **Oracle.** `scripts/oracle/cricsheet_oracle.py` written from the DOMAIN definitions; its
    scorecards match the public scorecards of both matches; outputs frozen as golden fixtures.
    Verified the strike-rotation rule on 470 deliveries (0 mismatches) before putting it in the plan.
12. **Visual check.** Chrome: dark (Auto) and light themes, persistence across reload, no console
    errors or CSP violations; Anek tabular figures measured equal-width at 75/100/125% widths.
13. **Docs.** Architecture, Decisions (D-001…D-031), Flow, Constraints, TEST_CHECKLIST, ROLLBACK,
    PLAN (Tasks 2-10 with interfaces and oracle-derived test values), DOMAIN, design system,
    visual references, templates, AGENTS.md (Codex) and CLAUDE.md.

## What worked / what did not

- Worked: user-space toolchain; native TS on Node 24; TS 7 for checks; `node:sqlite`; Playwright
  with the system Chrome; deriving every golden value from raw data or the oracle.
- Did not work: resizing the Chrome window for mobile checks (RDP keeps it maximised). Replaced by
  Playwright mobile projects (D-028).
- Did not work: framing the app in an iframe to fake a phone viewport (our own
  `frame-ancestors 'none'` blocked it, which confirmed the header works).
- Caught during plan self-review: a "single bailout" expectation that the data contradicts
  (Rizwan, the persona's vice-captain, also falls cheaply at 3.6), so the rule became "one quest
  at a time" (`quest_active`). Also pinned population vs sample standard deviation for the
  catch-up anomaly (z = 3.04 vs 2.92).
- Biome 2.5 deprecated `recommended: true` (now `preset: "recommended"`) and needs
  `tailwindDirectives` for Tailwind 4 CSS.
- `pkill -f "<pattern>"` killed its own shell because the pattern was in its own command line;
  harmless here, but use the background task id or `fuser` next time.

## Decisions made

D-001 to D-031 in `docs/Decisions.md`.

## Verification (fresh run before commit)

```
pnpm verify
packages/engine typecheck: Done
apps/server typecheck: Done
apps/web typecheck: Done
Checked 64 files in 99ms. No fixes applied.
 Test Files  9 passed (9)
      Tests  65 passed (65)
check-no-hardcode: OK (25 source files, 209 terms)
  1298150  Pakistan vs India  sha256 ok  30 players  5 notes  3 personas
  1415755  India vs South Africa  sha256 ok  30 players  2 notes  3 personas
verify-data: OK (2 matches)
✓ built in 297ms
verify exit=0

pnpm test:e2e
  8 passed (14.0s)   (desktop + 390 px mobile: attribution, no errors, no horizontal scroll, theme)

grep -rnE "\.(skip|only)\(" … → none
node scripts/fetch-cricsheet.ts --check → ok ×2 (fresh download matches recorded sha256)
python3 -I -m py_compile scripts/oracle/cricsheet_oracle.py → compiles
```

## Follow-ups

- Task 2 starts from `main` (after `t01-verified` plus the post-Task-1 docs commit); the first
  Codex handoff is `HANDOFF2.md`, written with `/handoff:create`.
- Resolved after Task 1 (2026-10-16): Nabhanyu approved D-002/D-011/D-012/D-015 (D-032), chose
  dual-provider AI via `.env` using the Codex key (a proxy OpenAI-compatible endpoint, probed and
  documented in D-033; local `.env` created, mode 600, git-ignored), and asked for the shareable
  `/architecture` page (D-034, Tasks 6 and 9).
