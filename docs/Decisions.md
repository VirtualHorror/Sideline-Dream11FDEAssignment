# Decisions log

> Why the code is the way it is. One entry per meaningful decision: context, the choice, the
> alternatives we rejected, and the consequences we accepted. Newest last. Never delete an entry;
> supersede it with a new one that links back ("Supersedes D-0xx").
>
> Format: **D-NNN — title** (date, task, decided by).

---

### D-001 — Build "Sideline": four live-match phases plus a control plane (2026-10-16, T1, Nabhanyu)
- **Context:** Assignment: one AI-powered artifact solving a real fan problem during a live match.
  Research (Gemini) identified four friction zones and chose a unified companion.
- **Decision:** One product, four phases (lineup surprise, early collapse, joining late, climax
  spoilers + chat firehose) plus an observability "control plane". Cricket first.
- **Alternatives:** a single-feature artifact (simpler, but loses the "knows when to call AI" story).
- **Consequences:** Larger scope, so the plan orders work as vertical slices with a deployable
  milestone after Task 7 (see D-026).

### D-002 — Multi-sport: analogy lens now, football adapter only as a stretch (2026-10-16, T1, Claude)
- **Context:** The brief mentions an F1/football toggle. A second sport needs a second data model,
  simulator and UI.
- **Decision:** Keep the engine's contracts sport-shaped where cheap, ship cross-sport *lenses*
  (F1, football, engineer analogies) for explanations, and defer a football adapter (StatsBomb
  open data) to stretch task S1.
- **Alternatives:** Build F1/football simulators in parallel (halves the depth of everything).
- **Consequences:** The "sampling fan from another sport" problem is still solved (lens), with a
  clear path to a second sport. Recorded in PLAN.md.
- **Status:** approved by Nabhanyu on 2026-10-16 (see D-032).

### D-003 — Real ball-by-ball data from Cricsheet; two matches (2026-10-16, T1, Claude)
- **Context:** A simulated match must feel real and must not be hand-written (that would be the
  ultimate hardcoding).
- **Decision:** Cricsheet JSON (match data under ODC-By 1.0 since 2026-10-07), match 1298150
  (PAK v IND, 2022) as the primary demo and 1415755 (IND v SA, 2024 final) as a second match.
  Raw files are reproducible via `scripts/fetch-cricsheet.ts` and pinned by sha256 in
  `data/raw/cricsheet/manifest.json`.
- **Alternatives:** Paid live feeds (keys, cost, no history); synthetic events (not credible).
- **Consequences:** Attribution required (footer, data/README.md). Every engine test runs on both
  matches, so logic cannot be tuned to one game.

### D-004 — TypeScript end to end, with an isomorphic engine package (2026-10-16, T1, Claude)
- **Context:** The same cricket logic is needed on the server (detectors) and in the browser (the
  fan's delayed TV view must fold the same events).
- **Decision:** pnpm monorepo: `packages/engine` (pure TS, no I/O), `apps/server`, `apps/web`.
  The engine's tsconfig exposes no Node or DOM types, so impurity is a compile error.
- **Alternatives:** Python backend + TS frontend (logic duplicated in two languages).
- **Consequences:** One implementation of every rule; the Python oracle (D-018) is the deliberate
  second implementation used only for auditing.

### D-005 — Node 24 LTS, installed in user space (2026-10-16, T1, Claude)
- **Context:** Fresh Ubuntu 24.04 host, no passwordless sudo, nothing installed.
- **Decision:** Node v24.22.0 (LTS "Krypton") from the official tarball, SHA256-verified, into
  `~/.local/share/node`, symlinked into `~/.local/bin`. pnpm 10.34.7 via corepack. Static ffmpeg
  7.0.2 (md5-verified) for inspecting reference videos.
- **Alternatives:** NodeSource apt repo (needs sudo); nvm (shell-init dependent, awkward for
  systemd); Node 26 (not LTS yet).
- **Consequences:** `~/.local/bin` must be on PATH for any process (systemd unit will set it, T7).

### D-006 — The server runs TypeScript directly (no build step) (2026-10-16, T1, Claude)
- **Context:** Node 24 strips TypeScript types natively; verified here, including through the
  pnpm workspace symlink and `node:sqlite`, with no warnings.
- **Decision:** `node apps/server/src/index.ts` in dev and prod. No tsx, tsup or bundler on the server.
- **Constraints this creates:** erasable syntax only (no `enum`, `namespace`, parameter
  properties; enforced by tsconfig `erasableSyntaxOnly` and Biome), explicit `.ts` extensions on
  relative imports, `import type` for type-only imports.
- **Consequences:** Fewer moving parts and no build drift. The web app is still built by Vite.

### D-007 — Supply-chain guard: 14-day minimum release age, no install scripts (2026-10-16, T1, Claude)
- **Decision:** `minimumReleaseAge: 20160` in `pnpm-workspace.yaml`; every direct dependency was
  chosen as the newest version at least 14 days old; `onlyBuiltDependencies: []`.
- **Consequences:** New dependencies must be justified here with version and age. If a package
  genuinely needs a build script, add it to the list with a reason.

### D-008 — TypeScript 7.0.2 (native compiler) for type-checking only (2026-10-16, T1, Claude)
- **Context:** TS 7 is the Go port; no JS API, ~10x faster checks. Nothing here needs the TS API:
  Vite/Vitest transpile, Biome lints, Node strips types.
- **Decision:** `typescript@7.0.2`, used only as `tsc --noEmit`. Verified it reports type errors
  and blocks Node globals in the engine.
- **Fallback:** `typescript@6.0.3` (last JS-based) if a tool later needs the TS API (ROLLBACK.md).

### D-009 — node:sqlite instead of better-sqlite3 (2026-10-16, T1, Claude)
- **Context:** No C/C++ toolchain on the host and no sudo to install one; native addons are a risk.
- **Decision:** Node's built-in `node:sqlite` (`DatabaseSync`) for the AI cache, traces and the
  analytics tables (T5). Verified working on Node 24.22.
- **Consequences:** No statement interrupt; the NL inspector therefore runs queries in a worker
  thread with a hard timeout (T8).

### D-010 — Hono + Server-Sent Events + REST (2026-10-16, T1, Claude)
- **Decision:** Hono on `@hono/node-server` 2.x. Server→client: SSE (one stream per session).
  Client→server: small JSON POSTs. No WebSockets.
- **Why:** Fan-out push is one-directional; SSE auto-reconnects, passes through Caddy, and mirrors
  how a real stadium feed would be pushed. `app.request()` makes routes testable without sockets.

### D-011 — Each browser gets its own simulated session and clock (2026-10-16, T1, Claude)
- **Context:** Reviewers open the link at random times; a shared global match clock would drop
  them mid-match with no control.
- **Decision:** Server-side session per browser (persona, stadium clock with play/pause/speed/
  seek, TV delay, lens), evicted after idle TTL.
- **Consequences:** "Shared" moments are shared via the *cache*, not by broadcast: session B
  reaching the same ball as session A gets A's result as a cache hit. The control plane shows it.
- **Status:** approved by Nabhanyu on 2026-10-16 (see D-032).

### D-012 — Fantasy rules are data; values are illustrative (2026-10-16, T1, Claude)
- **Context:** Dream11's official points page returned HTTP 502 on 2026-10-16 and public sources
  disagree.
- **Decision:** `data/rules/t20-fantasy.json` holds team rules and the points table (commonly
  cited 2023-2025 Dream11 T20 values), with a disclaimer; the engine reads it.
- **Consequences:** Swapping in official values is a data change. Golden totals in DOMAIN.md are
  tied to this file; the oracle reads the same file.
- **Status:** approved by Nabhanyu on 2026-10-16 (see D-032).

### D-013 — Credits authored, projections derived (2026-10-16, T1, Claude)
- **Decision:** Player credits (7.5-10.5) are authored per match as illustrative data (Dream11 sets
  credits editorially, so authoring them is honest). Expected points ("projections") are derived
  in T3 from each player's trailing T20I form in the Cricsheet archive, using the same scoring engine.

### D-014 — Provider-agnostic AI gateway, structured outputs, replay mode (2026-10-16, T1, Claude)
- **Decision:** One gateway with adapters: Anthropic (`@anthropic-ai/sdk`, default
  `claude-opus-5-5`, per-skill `output_config.effort`, refusal handling with server-side
  `fallbacks: "default"` where the SDK supports it), OpenAI (`openai`, model from env), `replay`
  (recorded outputs) and `scripted` (tests). Output schemas are zod `strictObject`s converted with
  `z.toJSONSchema()` and re-validated with zod after the call. Provider chosen by env
  (`SIDELINE_AI_PROVIDER`, else key detection; see `apps/server/src/config.ts`).
- **Why:** The account's API keys are the owner's choice; the demo must also work with no key
  (replay) and degrade honestly (fallback).
- **Notes for implementers:** Claude Opus 5.5 rejects forced `tool_choice` (any/tool) and
  `budget_tokens`; thinking is adaptive and cannot be disabled; control depth with `effort`.
- **Update:** provider configuration refined by D-033 (both providers via `.env`, OpenAI-compatible
  base URL, the current key is an OpenAI-compatible proxy's key).

### D-015 — Moment keys and cohort keys for caching (2026-10-16, T1, Claude)
- **Decision:** Cache AI results by moment key: `nudge:<match>:<eventId>`,
  `catchup:<match>:<innings>:<fromOver>-<toOver>:<lens>`, `bailout:<match>:<eventId>:<role>:<tone>`,
  `lineup:<match>:<squadHash>:<intentHash>`, `room:<match>:<windowEnd>`. Personal moments are keyed
  by cohort, never by user id.

### D-016 — Fallbacks are deterministic and always labelled (2026-10-16, T1, Claude)
- **Decision:** Each skill ships a template fallback computed from the same deterministic facts.
  It is used on timeout, refusal, schema/guard failure, budget exhaustion or missing key, and the
  moment's `provenance` is `"fallback"`. The UI shows provenance on every AI card.

### D-017 — Anti-hardcoding: three independent checks (2026-10-16, T1, Claude)
- **Context:** The implementer (Codex) could pass tests by special-casing the demo match.
- **Decision:** (1) `scripts/check-no-hardcode.ts` scans application source for any term derived
  from data (209 terms today: names, ids, teams, venues, persona ids). (2) Every engine test runs
  on both matches. (3) Audits run the engine and the Python oracle on a third, unseen Cricsheet
  match and diff the results.

### D-018 — An independent Python oracle (2026-10-16, T1, Claude)
- **Decision:** `scripts/oracle/cricsheet_oracle.py` (stdlib only) computes scorecards and fantasy
  points from raw Cricsheet. It was written from DOMAIN.md, not from the engine, and its outputs
  match the public scorecards of both matches. Implementers must never edit it.

### D-019 — React 19 + Vite 8 + Tailwind 4; own effects instead of effect libraries (2026-10-16, T1, Claude)
- **Decision:** No component kit. The four reference effects are implemented in-house (CSS for the
  glow and the input halo, small WebGL2 shaders for the ghost text and the dither), with CSS
  fallbacks and reduced-motion handling.
- **Why:** Bundle size, licence clarity, and exact control over the look.

### D-020 — Typography: Anek Latin, one variable family (2026-10-16, T1, Claude)
- **Decision:** Anek Latin variable (Ek Type, a Mumbai foundry; OFL-1.1), self-hosted via
  `@fontsource-variable/anek-latin`. Width axis (75-125%) is the expressive axis: condensed for the
  scorebug, normal for text, expanded for display. Tabular figures verified in Chrome at all widths.
- **Alternatives:** Inter/Geist (generic), Barlow Condensed (broadcast cliché), two families.

### D-021 — Theme: data-theme attribute set by a pre-paint script file (2026-10-16, T1, Claude)
- **Decision:** `public/theme-init.js` (a file, because the CSP forbids inline scripts) applies the
  saved or OS theme before first paint; `ThemeControl` (Auto / Light / Dark radios) keeps it in
  sync and follows live OS changes in Auto. Storage access is guarded everywhere.

### D-022 — Strict security headers from day one (2026-10-16, T1, Claude)
- **Decision:** CSP `default-src 'self'` without inline scripts, `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, nosniff, strict referrer policy. Inline *styles* allowed (CSS custom
  properties for team colours). Verified in tests and in Chrome (no violations).

### D-023 — Git workflow: task branches, audited merges, tags (2026-10-16, T1, Claude)
- **Decision:** `main` holds only audited work. The implementer works on `task/NN-<slug>` and
  never merges. The auditor (Claude) verifies, merges with `--no-ff`, and tags `tNN-verified`.
  Local only: no remote is configured and nothing is pushed unless Nabhanyu asks.

### D-024 — Win probability: a logistic model trained on real T20Is (2026-10-16, T1, Claude; built in T3)
- **Decision:** Fit a logistic regression on Cricsheet men's T20I second-innings states (runs
  needed, balls left, wickets left), excluding both demo matches, with held-out Brier score
  recorded in the model file. A first-innings model compares projected total to a data-derived par.
- **Why:** Leverage and Phase 4 thresholds should rest on a calibrated model, not magic numbers.

### D-025 — Self-hosted deployment: Caddy + sslip.io + systemd (2026-10-16, T1, Claude; built in T7)
- **Decision:** Caddy terminates TLS with an automatic certificate for `<public-ip>.sslip.io`
  (no domain purchase), proxies to the Node server, and systemd keeps it alive. Needs one sudo
  run by Nabhanyu and AWS security-group rules for 80/443; an Elastic IP keeps the URL stable.

### D-026 — Vertical-slice order with a public link after Task 7 (2026-10-16, T1, Claude)
- **Decision:** Engine → server + AI (phases 3-4) → UI → **deploy (Milestone A, submittable)** →
  phases 1-2 → polish → final audit. Each task leaves the app runnable.

### D-027 — Plan and spec live in the user's doc convention (2026-10-16, T1, Claude)
- **Decision:** The implementation plan is `docs/PLAN.md` and the design spec is
  `docs/Architecture.md` (the user's documentation habits), not the superpowers default folders.

### D-028 — Playwright drives the installed Google Chrome (2026-10-16, T1, Claude)
- **Context:** No sudo for Playwright's browser dependencies; the RDP Chrome window cannot be
  resized for mobile checks.
- **Decision:** `@playwright/test` 1.63.0 with `channel: "chrome"`, desktop (1440 px) and mobile
  (390 px) projects, screenshots in `test-results/` for visual review.

### D-029 — Personas instead of accounts (2026-10-16, T1, Claude)
- **Decision:** Reviewers pick a fan persona (squad, affinity, lens, stream delay, join point)
  from data. No login, no personal data stored.

### D-030 — Only verified Dream11 vocabulary in the product (2026-10-16, T1, Claude)
- **Decision:** Use "Watch Along", "Hit or Miss", "DreamBucks" (verified on the App Store listing).
  Do not use "Rhea" or quotes that could not be verified. No Dream11 logos; the footer says
  "A concept prototype, not an official Dream11 product."

### D-031 — Biome instead of ESLint + Prettier (2026-10-16, T1, Claude)
- **Decision:** Biome 2.5 (`preset: recommended`), CSS parser with Tailwind directives, wider line
  width for `data/` so fixtures stay one player per line.

### D-032 — Owner approval of the three architectural calls (2026-10-16, after T1, Nabhanyu)
- Approved: **D-002** cross-sport explanation styles instead of extra sport simulators (the UI calls
  the `engineer` lens "Systems"); **D-012** fantasy points configurable in data; **D-011 + D-015**
  per-reviewer replay isolation with per-moment AI caching.

### D-033 — Both AI providers via .env; the current key is an OpenAI-compatible proxy (2026-10-16, after T1, Nabhanyu + Claude)
- **Context:** Nabhanyu asked for OpenAI (`OPENAI_API_KEY`) and Anthropic (`ANTHROPIC_API_KEY`)
  support through `.env`, defaulting to whichever key is present, and to use the key Codex uses.
  Codex is configured (`~/.codex/config.toml`) with a custom provider, **an OpenAI-compatible proxy**
  (Responses API, model `gpt-6.1-sol`; its base URL is in `.env`), key in an environment variable set in `~/.bashrc`.
- **Decision:** config reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` (any
  OpenAI-compatible endpoint), `SIDELINE_MODEL_FAST` / `SIDELINE_MODEL_SMART`, and an optional
  `SIDELINE_AI_PROVIDER` override. Auto-detection: Anthropic if its key is set, else the
  OpenAI-compatible provider, else none. The local `.env` (git-ignored, mode 600) was created from
  the key Codex uses (from `~/.bashrc`), with the proxy's `OPENAI_BASE_URL` and `gpt-6.1-sol` for both tiers.
- **Probe findings (2026-10-16):** `/v1/models` lists `gpt-5.5, gpt-5.6-luna, gpt-5.6-sol,
  gpt-5.6-terra, gpt-6-astra, gpt-6-luna, gpt-6-sol, gpt-6.1-sol`. Responses API with a strict
  `json_schema` format works. Tiny calls take 4-8.5 s. Every request reports about 4,440 input tokens
  even for a 30-token prompt (a hidden prompt is added upstream; 0 cached tokens). `gpt-6.1-sol` and
  `gpt-6-luna` returned identical answers and both self-identify as "GPT-5", so model names probably
  route to one backend.
- **Consequences:** cost accounting uses *reported* usage, with configurable per-token prices for
  models without a built-in price (shown as estimates); fast/smart tiers are not relied on with this
  endpoint; teasers are only promised at 1-2x speed (latency budget); catch-up needs a visible
  thinking state; prompts and fan questions go to a third party (no personal data is sent; revisit
  for production). Adding an Anthropic key later switches the default (or set `SIDELINE_AI_PROVIDER`).
  The spoiler linter must allow neutral counts: the probe's own spoiler-free teaser was
  "Six balls, 16 to find, and a set batter facing the final over."

### D-034 — A shareable in-app architecture and plan page, `/architecture` (2026-10-16, after T1, Nabhanyu)
- **Decision:** a route for the demo round that presents the architecture and the live build plan.
  It renders the repository's own docs (`docs/Architecture.md`, the `docs/PLAN.md` checklist,
  `docs/Decisions.md`) at build time through Vite `?raw` imports and a markdown renderer with raw
  HTML disabled, so the page can never drift from the docs. Basic route in Task 6 (ships with the
  public link); designed pipeline diagram and live "when we don't call AI" table in Task 9.
  Replaces the earlier `/how-it-works` idea.

### D-035 — Deterministic stadium timing by stable event id (2026-10-16, T2, Codex)
- **Context:** the timeline needs plausible gaps for a live clock while remaining identical during
  browser replay, server replay, and seek/refold.
- **Decision:** timing constants live in `DEFAULT_TIMING`; delivery gaps vary by legality, boundary,
  wicket, and over completion. A small integer-second jitter comes from `fnv1a32(event.id)`, never
  from a wall clock or unseeded randomness. Every resulting event still passes `MatchEventSchema`.
- **Why:** stable ids make every timestamp reproducible across processes and runs, while outcome-based
  gaps preserve a readable match pace without making timing part of cricket scoring.
- **Alternatives:** evenly spaced deliveries (too uniform) and `Math.random` (non-replayable).

### D-036 — Retain bowler-conceded runs in over state (2026-10-16, T2, Codex)
- **Context:** a maiden depends on runs charged to the bowler, while `BallMark.runs` is the team total
  for that delivery and does not retain each extras amount.
- **Decision:** `OverSummary` carries both team `runs` and `runsConceded`; the reducer accumulates the
  latter using `total - byes - leg-byes - penalty` and uses it for maiden classification.
- **Why:** reducing an over from only its display marks can misclassify a penalty delivery that also
  contains batter runs. The additional state field preserves the domain calculation without changing
  the meaning of the existing `runs` field.

### D-037 — Task 2 audit: accept, exclude archive rejections explicitly, commit the auditor's toolkit (2026-10-16, T2 audit, Claude)
- **Context:** the audit swept all 230 matches of the T20 World Cup archive. The engine matched the
  oracle on every match it accepts. It rejects 31 valid files on contract limits (BUG-002), and 9 of
  those fall inside Task 3's training filters. Separately, the oracle scores substitute fielders that
  DOMAIN §3 excludes (BUG-001).
- **Decision:** accept Task 2 as built. Task 3's archive loader excludes rejected matches explicitly:
  reason, `excludedMatchIds`, counts in `data/models/README.md`, never a silent skip. Widening the
  contracts waits: engine support for missing or fractional targets and split overs is backlog
  (Constraint 8 applies when it lands). The auditor's comparator, fixture generator, spec
  re-derivation, survey and mutant table live in `scripts/oracle/audit/`, read-only for implementers
  under Constraint 5, so later audits (Task 3's holdout trajectory, Task 10) re-run the same sweep.
- **Why:** the demo matches are unaffected and the rejections fail loudly. A contract change for
  about 4% of archive matches is not worth making before the models exist. Committed tools make audit
  evidence reproducible instead of leaving it in a session scratchpad.
- **Alternatives:** fix BUG-002 inside Task 2 (scope creep into a contract change); keep single-match
  holdouts (the 1273712 holdout hit none of the rejection classes or the substitute discrepancy);
  keep the auditor's tools out of the repo (evidence that cannot be repeated).
- **Open:** BUG-001 waits for Nabhanyu: fix the oracle to follow DOMAIN §3, or change DOMAIN.

### D-038 — Substitute fielders score no fantasy points; the oracle now agrees (2026-10-16, after T2, Nabhanyu)
- **Context:** BUG-001. The oracle gave catch and run-out points to substitute fielders outside
  both announced XIs; the engine follows DOMAIN.md §3 and gives them nothing. This resolves the
  open item in D-037.
- **Decision:** option A: keep the DOMAIN rule (only the announced XI scores) and fix the oracle's
  `add()` to skip anyone outside the XIs. DOMAIN.md §3 now names substitute fielders explicitly.
- **Why:** a one-line fix in the reference, with no engine or test churn. It matches the product's
  "your player isn't playing" Phase 1 story and Dream11's published guidance (an ICC-Dream11 guide:
  substitute fielders earn no points for catches or run-outs). Golden files are unchanged (equal as
  data).
- **Alternatives:** option B, change DOMAIN so substitutes score. That needs new engine logic and
  tests, report and UI handling for players outside the squad file, and a priors rule for
  substitute-only appearances, and it diverges from Dream11.
- **Not covered:** concussion substitutes (full replacements who can bat and bowl). Dream11 scores
  them; Sideline does not model them yet.

### D-039 — Archive pipeline: every match accounted for, generated files reproducible (2026-10-16, T3, Claude)
- **Context:** Task 3 trains on Cricsheet's men's T20I archive, which Cricsheet republishes as
  matches are added, and the engine rejects about 5% of the files that pass the PLAN filters
  (BUG-002). The audit must be able to rebuild the committed files and get the same bytes.
- **Decision:** `scripts/lib/archive.ts` plus `node scripts/build-models.ts [--zip <path>]`.
  Matches are visited in numeric id order. Demo matches (read from the manifest) are set aside
  first, then the PLAN filters run in a fixed order and the first failing one is the reason. The
  rest go through synthesized fixtures, `buildTimeline` and `foldEvents`, and any error becomes a
  named BUG-002 reason (or `<stage>: <message>`, never a silent skip). The script throws unless
  used + filtered + demo + rejected equals the file count. `excludedMatchIds` lists the demo and
  engine-rejected ids. Filter exclusions are counted per reason in the generated
  `data/models/README.md`. All four outputs (`winprob-v1.json`, `priors-<id>.json`, `README.md`) are
  generated and byte-reproducible: fixed key order, weights and threshold at full precision
  (metrics rounded to 6 decimals, priors to 2), and `retrievedAt` kept when the zip's sha256 equals
  the committed one (otherwise today's UTC date for a download, the zip's mtime date for `--zip`).
  `data/models` is excluded from Biome, which would reflow the arrays `JSON.stringify` writes.
- **Alternatives:** formatting the files after writing them (breaks the byte-identical rebuild);
  listing the 370 filtered ids (derivable from the zip and the rules); stamping the clock's date
  (a rebuild would never be identical).
- **Consequences:** a new archive changes counts, weights and threshold in one reviewable diff.
  On the 2026-10-16 archive a download run and three `--zip` runs gave identical files.

### D-040 — Win-probability model as built (2026-10-16, T3, Claude; refines D-024)
- **Decision:** PLAN Task 3's two logistic models with its features exactly, rows and labels as
  specified (a tie labels both sides 0), test split `fnv1a32(matchId) % 5 === 0` (stable across
  archive versions because it hashes the id). Newton/IRLS from zero weights with a ridge penalty
  `(l2/2)·Σw²` on every weight, intercept included, at `l2 = 1e-4·n` (that shifts the mean
  residual by about 5e-4), Cholesky solve, and a thrown error on non-convergence. Test metrics:
  Brier, log loss (p clipped to [1e-15, 1 − 1e-15]) and ten equal-width calibration bins (empty
  bins omitted). `winProbability`: null before the first innings; the first-innings model during
  innings 1 and through the break (its training rows include the innings' last ball); in the chase
  the terminal rules first (target reached 1, all out or out of balls 0, level 0.5), then the model.
- **Result (2026-10-16 archive):** 3,093 matches, 2,486 train / 607 test; chase Brier 0.1215 (log
  loss 0.3712), within 0.05 of the observed rate in every calibration bin; first-innings Brier
  0.2099 (0.6061), but overconfident at the extremes (its 0.8-1.0 bins are about 0.10 too high), a
  documented limit and a follow-up.
- **Alternatives:** gradient descent (slower, tolerance-dependent); an unpenalised intercept
  (needs a "feature 0 is the bias" convention for no measurable gain); a random split (not stable
  across rebuilds).

### D-041 — The leverage threshold comes from the test split (2026-10-16, T3, Claude)
- **Decision:** leverage exactly as PLAN Task 3 defines it, with two clarifications: the `wicket`
  term counts a team wicket (retired hurt is not one, DOMAIN §2), and `leverage()` throws when the
  two states have different batting sides. `nudgeThreshold` is the nearest-rank 95th percentile (an
  observed value) of the leverage of every legal delivery in the test split, stored at full
  precision so that rounding can never flip a borderline ball: 0.18437 over 134,049 deliveries, of
  which 5.00% are at or above it. The weights are the PLAN defaults, written by the build script.
- **Alternatives:** an interpolated percentile (differs by less than 1e-4 here); a threshold over
  every match (it would be set on training data).
- **Consequences:** close finishes have about twice the archive's rate of big balls (8.76% of
  1298150's deliveries, 9.56% of 1415755's). The climax list is D-043.

### D-042 — Player priors as built; each entry carries the player's role (2026-10-16, T3, Claude)
- **Context:** `projectedPoints(playerId, priors)` must apply `roleMean[role]`, and the PLAN's entry
  shape (`appearances`, `projected`) had no role, which would have made the zero-appearance test
  tautological.
- **Decision:** each `players` entry is `{ role, appearances, projected }` (additive; the role is our
  fixture's). An appearance is any archive match, not only one that passes the training filters,
  with the player in an announced XI and accepted by the engine, strictly before the demo date, most
  recent first. It is scored by `fantasyPoints` with the player's own role and everyone else `BAT`.
  `roleMean` is pooled over the squad's appearances per role (2 decimals), falling back to the
  squad's overall mean for a role nobody has played (none today). `projected =
  round2(Σ/(n + k) + k/(n + k)·roleMean)`: the PLAN formula, written so that n = 0 gives exactly
  the role mean. The build stores it, and an unknown player throws.
- **Result:** 1298150: 29 of 30 players have 10 appearances (Naseem Shah 8); 1415755: 27 of 30
  (Baartman 6, Coetzee 6, Rickelton 3), as the pre-Task-3 survey found. Neither demo match is an
  appearance in the other's priors.

### D-043 — PLAN 3.4's climax list amended to the balls the model can see (2026-10-16, after T3 implementation, Nabhanyu)
- **Context:** BUG-003. With the specified features, weights and percentile, 1298150's 18.5 six
  (0.093) and winning single (0.019) stay below the 0.18437 threshold. Every other step 3.4 check
  passes. The implementer may not tune (PLAN 3.4), so the options went to Nabhanyu.
- **Decision:** amend the list: drop 18.5 and the final 19.6, and add the 19.6 wide (0.2611), which
  the model flags. The model, features, weights and threshold are unchanged. Downstream PLAN steps
  follow: 4.5 now expects the five listed balls, and 5.6 uses 18.6 instead of 18.5.
- **Why:** the model is calibrated and the threshold principled; the list was an expectation. These
  two balls are where a per-ball win-probability measure disagrees with hindsight: 18.5 matters
  because of the six after it, and the winning single follows a wide after which the data put the
  win at 99%.
- **Alternatives:** report only and leave Task 3 unmerged; a decisive-ball rule (fixes only the
  final ball); training on super-over ties (removes the 1-off-1 bias but changes the filters);
  re-weighting (per-ball tuning).
- **Follow-ups:** (1) the filters drop ties that went to a super over, so in training a chase
  needing one off the last ball nearly always wins (26 of 27): revisit when the engine supports
  super overs. (2) Task 4: the match-deciding delivery is the biggest spoiler of all, so the nudge
  detector may want a decisive-ball trigger; that is a Task 4 design decision.

### D-044 — Task 3's deferred minors become Task 4 step 4.0 (2026-10-16, before T4, Nabhanyu)
- **Context:** Task 3 was implemented and audited by the same agent (F03), with five deferred minors
  in its audit notes. Codex was still unavailable for Task 4.
- **Decision:** Nabhanyu asked for an independent spot-check of `t03-verified` in a fresh session and
  for the minors to be folded into Task 4 as step 4.0: `Object.hasOwn` in `projectedPoints`, `round2`
  for role means, no dead symmetrisation loop in `fitLogistic`, a "keep the archive" recipe in the
  generated `data/models/README.md`, and a test that kills the diagonal-only-Hessian mutant. The
  spot-check found one more survivor (leverage counting retired hurt as a wicket), added to 4.0.
- **Consequences:** `data/models/README.md` changed, regenerated by `scripts/build-models.ts` from the
  recorded zip (Constraint 14); the three JSON files are byte-identical. The PLAN gained step 4.0.

### D-045 — Detectors are stateless; the gate keeps the session's memory (2026-10-16, T4, Claude)
- **Context:** One detector object serves every session (`lineupDetector` and friends are objects,
  PLAN Task 4), yet two rules need history: "one comeback quest at a time" and "once per key". The
  room rule needs the chat, which `DetectorInput` did not carry.
- **Decision:** detectors are pure functions of `DetectorInput`. History is recomputed from
  `events` (only `seq <= event.seq` is read, so passing the whole timeline cannot leak the future)
  and the persona's join point (`joinSeq`, `cricket/join.ts`): a dismissal from before the fan
  joined holds no quest open. The gate owns the only per-session memory, its counters and the set
  of keys already asked for; a repeat key is recorded as `suppressed: duplicate_key`.
  `DetectorInput` gains an optional `chat`, and the room detector reads only messages with
  `t <= event.t` and `fromYou: false`. Facts are new plain objects (a test checks they do not change
  as later events are applied) with ids and display names; team codes stand for teams.
- **Shared keys, personal facts:** two facts are per-session although their keys are shared:
  `BailoutFacts.projection` (the cohort key is match, event and armband; the projection depends on the
  whole squad) and `CatchUpFacts.squadImpact`. Both are documented as such; the prompt for a shared
  key must leave them out and the UI renders them beside the AI text (Tasks 5 and 8, Constraint 11).
- **Alternatives:** per-session detector instances (one object per session; the PLAN asks for shared
  objects); quest windows tracked by the gate (collapse logic in the gate).

### D-046 — The ball that decides the match always gets a teaser (2026-10-16, T4, Nabhanyu)
- **Context:** D-043 follow-up 2. Leverage can miss the match-deciding ball when the result was
  already near-certain: 1298150's winning single scores 0.019 and 1415755's last ball 0.0003, against
  a 0.18437 threshold. That ball is the biggest spoiler (celebrations, notifications, "X WIN!").
- **Decision:** Nabhanyu asked for match-ending deliveries to be handled alongside the threshold.
  The nudge detector also triggers on the delivery that makes the chase terminal (target reached,
  tenth wicket, or out of balls), reason and `why` `match_decided`, which wins over `big_ball` when
  both hold. The threshold, weights and model are unchanged (D-041).
- **Consequences:** one extra teaser per match (23 in 1298150, 25 in 1415755; the holdouts' finishes,
  Brathwaite's fourth six and Dhoni's last-ball run out, are flagged too). `why` and `outcome` are
  reveal-side facts: a teaser must not say the next ball decides the match.

### D-047 — The synthetic crowd: authored corpus, rates as data, seeded per event (2026-10-16, T4, Claude)
- **Decision:** `data/crowd/corpus.json` holds 303 hand-written lines (English, Hinglish and Hindi)
  across 16 triggers, 40 made-up handles, and per-trigger rates (messages per firing, exponential
  reaction delay). Lines use placeholders only (`{batter}`, `{battingTeam}`, ...), a `side` (whose fan
  says it) and a `stance` (pro-batting, pro-bowling, neutral, tactics, nerves, banter, celebration,
  heartbreak) the room read can count. `simulateCrowd` seeds a generator per event from the seed and
  the event id (`mulberry32`, `seedFrom` = FNV-1a), so a prefix of the timeline gives exactly the same
  messages for those events, and draws a burst's lines without replacement. Every message is
  `synthetic: true`.
- **Room rate:** the spike rule (last minute above mean + 2 SD of the per-minute counts, PLAN Task 4)
  is measured over this innings' minutes, needing at least ten: counted from the session start, the
  quiet pre-match half hour made the first ball of the match look like a spike. Spikes then land on
  hot moments (innings 1's three-sixes over, the chase's 20-run over, the 19.4 no-ball).
- **Alternatives:** a generated corpus (would be AI text presented as fans); one generator for the
  whole match (seeking would change the room); team names in lines (they are data).
- **Open for Task 5:** the PLAN seeds each session's crowd with the session id, but room keys are
  shared per match and over; a cached room read would cite another session's message ids. Recommended:
  seed the crowd per match (every fan sees the same synthetic room, as in a real watch-along).
- **Update:** resolved by D-050 (Nabhanyu, before T5): one crowd per match, seeded with the match id.

### D-048 — Quest rules settle from deliveries, as early as the outcome is certain (2026-10-16, T4, Claude)
- **Decision:** positions are 1-based legal balls; a wide or no-ball belongs to the legal ball still
  to come (the 19.4 no-ball of a chase that has bowled 117 legal balls is position 118). A wicket is a
  team wicket (retired hurt is not), a dot is DOMAIN's bowler dot (a leg bye is a dot), over runs
  include extras, a boundary off a no-ball counts. A rule is decided as soon as it is certain: a
  count reached (gte) or exceeded (lte), a window or deadline passed, the batter out, too few balls
  left, or the innings over; otherwise "pending".
- **Why:** the bailout quest's predictions (Task 8) should flip to won or lost the moment the fan's TV
  shows the deciding ball, and the engine, not the model, decides them.

### D-049 — Smaller Task 4 choices (2026-10-16, T4, Claude)
- `stadiumAt` floors elapsed wall time at 0: a browser clock behind the server's would otherwise run
  the match backwards briefly (the PLAN formula, otherwise unchanged).
- Join points are found from the events (`seqAfterOvers`, `joinSeq`): after N overs means after the
  over's sixth legal ball, and 0 overs means the innings' start. Task 5's `jump` can reuse them.
- Lineup: `lineup:<match>:<8-hex FNV-1a of sorted ids, C, VC>:none`; a benched captain or vice-captain
  hands the armband to the replacement, so every listed swap passes `validateSquad`; ties by id.
- Collapse "after" projection swaps the dismissed player's projection for their points so far
  (multiplied); the quest window is the next 18 legal balls, capped at the innings' last ball.
- Catch-up windows are whole overs of the innings in progress; a finished innings counts its last
  over; with no complete missed over yet, the previous innings' missed overs are the window.
- Room reads: five-minute window, up to 60 messages deduplicated by text (latest kept); an innings
  that ends mid-over in the death overs closes that over's read.

### D-050 — One synthetic crowd per match, seeded with the match id (2026-10-16, before T5, Nabhanyu)
- **Context:** D-047's open question. PLAN Task 5 seeded each session's crowd with the session id,
  but room-read keys are shared per match and over (`room:<match>:<innings>:<over>`, D-015), so a
  cached room read (Task 8) would cite message ids and quote lines that other fans never saw.
- **Decision:** Nabhanyu approved the recommendation: one crowd per match, `simulateCrowd({ …,
  seed: matchId })`, computed once per match and shared by every session. Every fan in a match sees
  the same synthetic watch-along room, as in a real watch-along, and the per-over room-read cache key
  is honest: the messages it cites exist in every fan's chat. The PLAN's sessions rule carries an
  amendment note; D-047's open question is closed.
- **Consequences:** a seek or jump re-reads the same crowd (it is prefix-stable per seed, D-047);
  the crowd costs one simulation per match instead of one per session. Fans' own messages (Task 9)
  stay per session and never enter shared prompts (Constraint 11).
- **Alternatives:** per-session seeds (the room read would need a per-session key, so one model call
  per fan per over, against thesis 1); a seed per room window (rooms would disagree across windows).

### D-051 — Spot-check of `t04-verified`: accepted, two test gaps pinned in Task 5 (2026-10-16, before T5, Claude)
- **Context:** Task 4 was implemented and audited by the same agent; Nabhanyu asked for an independent
  check in a fresh session before Task 5 (F05 log). Verify, E2E, the oracle diff, `mutate.py`, a Python
  re-derivation of the teaser counts and catch-up facts, and two never-examined holdout matches all
  agree with the Task 4 record. 16 of 18 fresh hand mutants were killed.
- **Decision:** the two survivors are test gaps, not defects, so `t04-verified` stands and the gaps are
  closed with tests on the Task 5 branch (no engine source change): nine minutes of chat history are
  not enough for a spike (pins the ten-minute minimum of D-047), and an at-most dots quest settles as
  won on the ball that makes it certain (pins D-048's "as early as certain" at its boundary). Each new
  test fails on its mutant and passes on the merged code.

### D-052 — The provider SDKs: `@anthropic-ai/sdk` 0.131.0 and `openai` 7.27.0 (2026-10-16, T5, Claude)
- **Context:** PLAN Task 5 adds both providers (D-014, D-033). pnpm's `minimumReleaseAge` (D-007)
  allows only versions published at least 14 days ago (on or before 2026-10-02).
- **Decision:** `@anthropic-ai/sdk` **0.131.0** (published 2026-09-30) and `openai` **7.27.0**
  (published 2026-10-01), exact pins in `apps/server/package.json`, the newest versions old enough.
  New transitive packages: `json-schema-to-ts` 3.1.1, `ts-algebra` 2.0.0, `standardwebhooks` 1.1.1,
  `@stablelib/base64` 1.0.1, `fast-sha256` 1.3.0 (Anthropic SDK); `openai` takes the existing
  `undici` and `zod` as optional peers. No install scripts, no native code.
- **Why these SDKs:** typed requests and errors (`Anthropic.RateLimitError`, `APIUserAbortError`, …,
  never message matching), `AbortSignal` support, and the types for the features the PLAN names:
  0.131.0 types `output_config: { effort, format: { type: "json_schema" } }`, `stop_reason:
  "refusal"`, and on `client.beta.messages` the `fallbacks: "default"` parameter with the
  `server-side-fallback-2026-07-01` beta; 7.27.0 types the Responses API's strict `json_schema`
  text format, `output_text` and `usage.input_tokens/output_tokens`.
- **Alternatives:** raw `fetch` against both HTTP APIs (we would re-implement retries, error classes
  and types); the Anthropic SDK's `zodOutputFormat` helper and `messages.parse()` (provider-specific;
  the gateway already converts zod 4 with `z.toJSONSchema()` and re-validates, so both providers share
  one path); Vercel's AI SDK or LangChain (a large abstraction over two calls, and more supply chain).

### D-053 — `AICallTrace` gains `costEstimated` and `detail` (2026-10-16, T5, Claude)
- **Context:** PLAN Task 5 says a model without a built-in price has its cost "flagged `estimated` in
  traces and shown as 'est.' in the UI", but `AICallTraceSchema` had no such field. And the PLAN asks
  each failure path (timeout, refusal, invalid output, guard, no provider, budget) for "a matching
  trace outcome" from a fixed enum of seven, where an invalid output and a network error both read
  `error`, and a guard rejection and a missing provider both read `fallback`: the control plane could
  not say why a card is a fallback.
- **Decision (Constraint 8):** two required fields, added rather than changing any: `costEstimated:
  boolean` and `detail: string | null` (at most 300 characters; null for a clean result). Outcomes
  stay as the enum defines them; `detail` carries the specifics ("no answer within 9000 ms",
  "invalid output: …", "guard: …", "no provider configured", "daily budget of $3.00 spent"). No
  trace had been produced before Task 5, so nothing else changes. Contract tests pin both fields.
- **Alternatives:** keep the reason only in SQLite (the control plane could not show it); new outcome
  values (a breaking change to an enum the UI will switch on).

### D-054 — The AI gateway and providers as built (2026-10-17, T5, Claude)
- **Order (PLAN Task 5):** in-flight dedupe by prompt version and key → cache → budget → provider call
  (an `AbortController` at the skill's timeout, and the call raced against it, so a provider that
  ignores its signal cannot hang a run) → zod → the skill's guard → cache write. Every run writes one
  `ai_calls` row and updates the counters; a run that joined another's in-flight call writes its own
  trace (`cache: hit` when the shared result was usable, tokens and cost 0).
- **One validation point:** providers return parsed JSON and the reported usage, and the gateway
  validates with the skill's zod schema (the PLAN's `complete<T>` returned a typed `T`, which would
  have put validation in every provider and in none of the tests of the gateway). The request carries
  `meta: { skill, key }` for logs and the scripted provider; real providers never send it.
- **What providers see:** `z.toJSONSchema()` of the skill's schema without `$schema`, length, count,
  range and pattern keywords (strict structured-output modes reject several); zod enforces every
  limit on the answer and the prompts state the limits in words.
- **Outcomes:** timeout → `timeout`; refusal → `refused`; non-JSON, truncated or schema-invalid →
  `error`; guard rejection → `fallback`; no provider → `fallback` with provider `none`; budget →
  `budget`; any other provider error → `error` with the error class, the HTTP status and the body's
  machine-readable error code, never the provider's message (`provider error: InternalServerError
  (503, service_unavailable)`: an outage or an exhausted account reads from the trace alone). `detail`
  says which (D-053). Fallbacks are never cached.
- **Cache:** rows hold the validated *output*, keyed by key, prompt version and model; a live row
  answers only for the configured model; recorded replay rows (Task 7) answer for any model and with
  no key; a live row wins over a replay row.
- **Budget:** daily spend starts from today's `ai_calls` rows (UTC), so a restart keeps it; the cap is
  checked before a call, so the day's last call may overshoot by one call. A session's cap counts the
  provider calls it started. Costs use reported usage; a call cut off by the timeout has none to
  report and is recorded at 0 (it may still be billed).
- **Pricing:** the PLAN's three models plus `claude-opus-5` and `claude-opus-4-8` (5/25), the targets
  Anthropic's server-side fallback can serve a claude-opus-5-5 request with; any other model uses the
  configured prices and is flagged `costEstimated`.
- **Anthropic:** `client.beta.messages.create` with `output_config: { effort, format: json_schema }`,
  `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` (the installed SDK types accept
  both, so the PLAN's condition holds); no `thinking`, `budget_tokens` or `tool_choice`;
  `stop_reason` checked before content; the served model reported. **OpenAI-compatible:** the
  Responses API with a strict `json_schema` format named after the skill, `output_text`, no
  `reasoning`. Both: `maxRetries: 0` (the gateway owns timeouts; a failed moment is retried by the
  next fan's request), explicit base URLs so no stray `*_BASE_URL` variable redirects them.
- **Alternatives:** validation inside providers; caching payloads instead of outputs (a payload change
  would invalidate recorded rows); SDK retries (a retry inside a teaser's budget is usually too late).

### D-055 — Teasers: the model writes only the teaser; the reveal is the scorecard (2026-10-17, T5, Nabhanyu + Claude)
- **Context:** PLAN Task 5 gives the teaser skill an output of `{ nudge, reveal }`, but the reveal
  states what happened, and Nabhanyu's instruction for this task is that outcomes are never passed to
  teaser prompts (also D-045, D-046 and F04 follow-up 2).
- **Decision:** the model's output is `{ nudge }` and sees only the ball's label, the pre-ball
  situation, the batters and bowler, the free hit, team names and the pre-ball win chance (an
  allow-list a test pins on every teaser of both matches). The payload's `reveal` is built by code
  from `NudgeFacts.outcome`: the commentary line and where the innings stands after the ball. The model
  cannot spoil what it was not told, the reveal cannot hallucinate a result, and `spoilerLint`
  (outcome phrases, "decides it"-style phrasing, the score after the ball, the striker's possible runs
  after it and the runs still needed after it, each only when it is not also a pre-ball number) checks
  the teaser anyway.
- **Timing:** `nudgeAt = ball − 6 s`, `revealAt = ball`. The budget is the wall time until the fan's TV
  reaches the nudge: `(ball − 6 s + delay − stadium now) / speed`, at least 0, recorded on the trace and
  the payload. The call's timeout is `min(15 s, max(budget − 1 s, 9 s))`: the PLAN's
  `min(15000, budgetMs − 1000)` goes negative at high speed, and a call cut short is wasted for
  everyone, while a late answer still serves the next fans from the cache. If the answer is ready
  only after the fan's TV passed the nudge time, the moment goes out with `nudgeAt: null` (Review
  focus 3) and the trace shows `latencyMs > budgetMs`.
- **Alternatives:** a second, post-ball call for the reveal (one more call per big ball); passing the
  outcome and trusting the linter (the owner ruled it out).

### D-056 — Sessions, catch-ups and moments as built (2026-10-17, T5, Claude)
- A session starts at its persona's join point (`joinSeq`, D-049), playing at 1x with the persona's
  delay and lens unless the request overrides them; the events before it are folded without the gate.
  Each tick folds the events the stadium clock reached through the session's own gate (D-045) with the
  match's shared crowd (D-050); only teaser triggers reach the orchestrator until Task 8.
- Seek and jump refold from the timeline and send a snapshot. Skipped events never pass the gate (the
  fan did not watch them); a jump that skips at least 12 legal balls the fan never saw starts a
  catch-up for them (the furthest point seen is remembered, so re-watching earns none). Produced
  moments are kept and sent only once the clock is past their time: a jump back hides them, a jump
  forward brings them back once, and the gate's remembered keys make re-watching free.
- A catch-up reel reveals when the fan's TV reaches the point they joined at (`revealAt = createdAt =`
  the join time), because its window ends at the stadium's join point and the last balls are still in
  the fan's delay; the PLAN's literal key (`catchup:1298150:2:0-14:casual`) is kept.
- The clock stops at the end of the match and its crowd. A session whose tick throws is stopped alone
  and every stream, including a reconnecting one, is told (`error: session_failed`). Idle means no open
  stream and no request for the TTL; at the cap the least recently active idle session makes room,
  else creation answers 503.
- Telemetry: every gate result and trace is counted per session and globally (an evicted session's
  numbers stay global). The projection counts shared keys once and personal ones (a lineup patch keyed
  by squad, a fan's model-answered question) per viewer at the observed rate: the conservative
  reading. Its formula shows enough decimals never to round a saving below 100% up to "100.0000%".

### D-057 — The explainer: glossary first, the fan's TV as the facts (2026-10-17, T5, Claude)
- `data/glossary.json` (46 authored terms, DOMAIN's definitions, optional analogies per lens) answers
  any question that just names a term, after trimming filler words ("what's a …", "explain the …"),
  as a `deterministic` moment with no model call.
- Anything else goes to the model with facts folded to the fan's **TV time** (never the stadium's head
  start, so a question cannot spoil a ball still in the delay): teams, the situation on screen and the
  last six commentary lines, plus the definition of a glossary term the question mentions. The key is
  `explain:<match>:<seq on TV>:<lens>:<hash of the question>`, so everything in the prompt is in the
  key (Constraint 11). The question sits inside `<fan_question>` with `&`, `<` and `>` escaped, and the
  system prompt says to treat it as data. The fallback (provenance `fallback`) is the mentioned term's
  definition, else where the match stands on the fan's screen; its `source` stays `ai` (the path), and
  provenance says it is not model text.
- **Residual risk:** a model that recognises a famous match may know its result; every prompt tells it
  to use only the facts, and the teaser linter rejects outcome statements, but the explainer has no
  outcome linter (its legitimate answers use words like "win").

### D-058 — Smaller Task 5 choices (2026-10-17, T5, Claude)
- **Config:** the model variables are shared by both providers, so a non-Claude name with the Anthropic
  provider fails the boot (today's `.env` names gpt-6.1-sol; adding an Anthropic key must not send that
  to Anthropic). Two existing config tests gained the model names the OpenAI provider now requires;
  their assertions did not change.
- **HTTP:** JSON bodies are read with a 16 KB cap enforced while reading (413), so a 10,000-character
  question is refused by its schema (400) as Review focus 5 expects. Questions are rate-limited per
  address before anything else (token bucket, 12 a minute, burst 4, `Retry-After`); X-Forwarded-For is
  trusted only from a loopback peer (the reverse proxy of Task 7). Errors keep the one
  `{ error: { code, message } }` shape. `GET /api/matches` returns personas' id, label, blurb, lens and
  delay only. `GET /api/telemetry` defaults to the global scope and 10,000,000 viewers.
- **Bundles:** loaded from the manifest, every persona's join point checked at boot; the match's crowd
  is simulated once per match.
- **Engine:** `situationOf` is exported (the explainer's facts); no contract changed except D-053.
- **Smoke:** `pnpm ai:smoke` uses an in-memory database, so its call never lands in the app's traces or
  daily budget.

### D-059 — Spot-check of `t05-verified`: accepted, four test gaps pinned in Task 6 (2026-10-17, before T6, Claude)
- **Context:** Task 5 was implemented and audited by the same agent; Nabhanyu asked for an independent
  check in a fresh session before Task 6 (F06 log). Verify, E2E, the oracle diff, `mutate.py` (18/18) and
  a keyless live run of the API the UI will consume all agree with the Task 5 record. 17 of 21 fresh hand
  mutants of the server code were killed.
- **Decision:** the four survivors are test gaps, not defects, so `t05-verified` stands and the gaps are
  closed with tests on the Task 6 branch (no server source change): a jump back then playing forward
  streams the held teasers again, once each (Review focus 1); no event or chat line is streamed before the
  stadium clock reaches it; the clock keeps running after the match ends until the crowd's last reaction;
  `/ask` on a session an internal error stopped answers 409 `session_failed`. Each new test fails on its
  mutant and passes on the merged code.

### D-060 — The match room reads players, rules and the model from `GET /api/matches/:matchId` (2026-10-17, T6, Claude)
- **Context:** PLAN Task 6 has the browser call `describeDelivery`, `winProbability` and (for the catch-up's
  squad impact, F05 follow-up 1) `fantasyPoints`/`squadPoints`, which need the players, the win-probability
  model and the fantasy rules. Task 5's API sends none of them: `/api/matches` lists summaries and
  personas, and `hello` carries the summary and the fan's persona.
- **Decision:** one read-only route, `GET /api/matches/:matchId` → `{ match, players, rules, winprob }`
  straight from the match bundle (404 JSON for an unknown id), validated in the browser with the engine's
  own schemas (`MatchSummarySchema`, `PlayerSchema`, `FantasyRulesSchema`, `WinProbModelSchema`). It is
  public match data and model weights; personas stay out (the stream's `hello` brings the session's).
  No contract changes: the response is composed of existing schemas.
- **Alternatives:** adding the fields to `hello` (a contract change, and the same 40 KB resent on every
  reconnect); importing `data/` into the web bundle at build time (match data baked into the client, a
  rebuild per match, and every match shipped to every fan).

### D-061 — `/architecture` renders the docs with `markdown-it` 15.0.2, as React elements (2026-10-17, T6, Claude)
- **Context:** D-034 and PLAN Task 6 need a markdown renderer with raw HTML disabled, added with a
  Decisions entry and a version published at least 14 days ago (D-007; pnpm enforces it).
- **Decision:** `markdown-it` **15.0.2** (published 2026-09-11; MIT; ships its own types), exact pin in
  `apps/web/package.json`. New transitive packages: `argparse` 3.0.2 (2026-09-10), `linkify-it` 6.1.0,
  `mdurl` 2.1.0, `uc.micro` 3.0.0 (2026-07-22) and `punycode.js` 2.3.1 (2023-10-30); `entities` 8.1.0 was
  already in the lockfile. None has an install script; nothing native. It runs with `html: false` (raw
  HTML stays text). `src/lib/markdown.ts` walks its token stream and builds React elements from a fixed
  tag list, so no HTML string is ever injected (`dangerouslySetInnerHTML` is not used anywhere): web
  links open in a new tab, in-page anchors stay, repository paths become plain text, wide tables and code
  blocks scroll inside their own box. The page is a separate chunk (`React.lazy`), so the landing page
  and the match room do not carry the docs or the parser.
- **Alternatives:** `marked` (no switch to disable raw HTML; needs an escaping renderer and a sanitiser
  for its HTML string); `react-markdown` with `remark-gfm` (safe by default, but about 50 packages);
  `micromark` (safe, but tables need extensions); a hand-written parser (the PLAN asks for a library, and
  CommonMark has many edge cases).

### D-062 — A 60-line router instead of a routing library (2026-10-17, T6, Claude)
- **Context:** Task 6 brings three routes (`/`, `/match/:matchId`, `/architecture`); the server already
  answers every non-API path with `index.html` (Flow §2).
- **Decision:** `src/router.tsx`: `parseRoute(pathname)`, `useRoute()` (`useSyncExternalStore` over
  `popstate` and a custom navigate event), `navigate(to, { replace })` and `Link` (modified clicks and
  new tabs left to the browser). Match ids must look like Cricsheet ids (`MatchIdSchema`), anything else
  is "not found". The persona travels as `?persona=<id>`, so a match link without one shows the picker.
- **Alternatives:** React Router or TanStack Router (a dependency and its supply chain for three routes,
  D-019's "no kit" spirit); hash routing (ugly shareable links for the demo round).

### D-063 — The session clock stops when the fan's TV has shown the end (2026-10-17, T6, Claude; amends D-056)
- **Context:** BUG-004. D-056 stopped a session's clock "at the end of the match and its crowd", at
  stadium time; a fan whose TV runs further behind than the crowd's last reaction (25 s and 40 s
  personas in 1298150) never saw the last balls or the result.
- **Decision:** the stadium clock runs on to `endT + delayMs` and pauses there, so the fan's TV reaches
  the end first; seeks and jumps still clamp to `endT`. Two Task 5 expectations that encoded the old
  rule now add the fan's delay (named in BUG-004); the new test fails on the old code.
- **Alternatives:** letting the browser run its TV clock past a paused server clock (the client would
  invent time the server never had); stopping at `endT` and treating "paused at the end" as "show
  everything" in the UI (a TV that jumps 25 s at the end, and every other consumer of the clock would
  still be wrong).

### D-064 — The match room as built: TV clock, spectacle rules, held control plane, layout (2026-10-17, T6, Claude)
- **TV clock:** the browser folds the stream's events to `tvTimeAt(clock, now)`, re-read every 100 ms
  while playing (and on `visibilitychange`), not every animation frame: state changes only when the TV
  passes an event, a chat line or a card's times, seconds apart even at 32x; the effects run their own
  frame loops. A snapshot replaces everything and bumps an epoch that the fold and the outburst watcher
  start again from (Review focus 1). The store applies the clock a control request answers with at once,
  and the controls show the fan's choice before it arrives, dropping the guess on failure.
- **Spectacle:** the floodlight outburst and the ghost-text headline fire only for events newly released
  on the TV clock during play, and only for a ball with a spoiler teaser (the gate's big-ball rule) or the
  result. Every six and wicket stays in the dot matrix and commentary; only the balls that swung the match
  light the stadium ("spend boldness in one place", DESIGN_SYSTEM §1). A seek is not a moment.
- **Spoiler safety beyond the cards:** a held card renders empty bars under the veil, never the hidden
  text; the control plane shows a gate decision once the TV reaches its event and a trace once its moment
  is revealed, because trace details can quote the outcome (a guard's "score after the ball").
- **Layout:** two columns from 960 px (the design's desktop starts at 1200 and phone below 768; the
  in-between is closer to a tablet in landscape, which the two columns serve), tabs below; the TV screen is
  a night picture in both themes (`.surface-night`); the landing hero is the wordmark with the floodlight
  rising from its bottom edge, and the picker follows it (the reference's composition; the sketch's picker
  inside the hero buried the cone under the persona cards).
- **Persona in the URL:** `/match/<id>?persona=<id>` creates the session in the room, so a link works on
  its own and a reload starts a fresh session; without a persona the room shows that match's picker.
- **Alternatives:** an animation-frame TV clock (60 renders a second for nothing); outbursts on every six
  and wicket (a dozen spectacles a match, against the design's restraint); the control plane at stadium time
  (a reviewer watching the drawer would be spoiled); a single responsive grid with CSS-only tabs (the tab
  roles would be wrong on desktop and hidden panels would still mount the TV's effects).

### D-065 — Spot-check of `t06-verified`: accepted, three test gaps pinned in Task 7 (2026-10-17, T7 step 7.0, Claude)
- **Context:** Task 6 was implemented and audited by the same agent; Nabhanyu asked for an independent check in
  a fresh session before Task 7 (as D-051 and D-059 did). Verify (47 files / 569 tests), E2E (22), the oracle diff
  (identical on both matches) and `mutate.py` (18 killed) all agree with the Task 6 record; 11 of 14 fresh hand
  mutants of the Task 6 code were killed.
- **Decision:** the three survivors are test gaps, not defects, so `t06-verified` stands and the gaps are closed
  with tests on the Task 7 branch (no source change): a teaser's trace stays held in the control plane while its
  card only teases; a trace with no card and no ball to wait for (a fan's question) shows at once; a seek past the
  end clamps to the crowd's last reaction, not to the fan's delayed TV (D-063). Each fails on its mutant.

### D-066 — The deployment as built: a deploy checkout, port 8780, the environment file, one sudo rule (2026-10-17, T7, Claude; builds D-025)
- **Deploy checkout:** production runs from `/srv/sideline`, a clone of the repository detached at the deployed
  commit (default `main`), never from the working copy: on this host the working copy is also the development
  machine, and `pnpm verify` empties `apps/web/dist` under a server that keeps `index.html` in memory (a blank
  public page), tests share `data/runtime`, and `update.sh <ref>` would otherwise switch the developer's branch.
- **Port:** the server listens on `127.0.0.1:8780`, not the PLAN's 8787, which `pnpm dev`, its Vite proxy and the
  developer's `.env` use on the same host. `install.sh`'s `PORT` is the one source (Caddyfile, unit, env file);
  `update.sh` reads it back from the installed Caddyfile.
- **Environment file:** `scripts/deploy-env.ts` parses `.env` with Node's own parser (what `pnpm dev` reads),
  copies only the variables the server reads (`SERVER_ENV_NAMES`, exported by config.ts), forces HOST, PORT and
  NODE_ENV (an EnvironmentFile overrides the unit's Environment= lines), leaves the data and web paths at the
  checkout's defaults, writes systemd's double-quoted form (checked against systemd 255) and validates with
  `loadConfig`; root-owned, mode 600; names printed, never values. `--keyless` leaves the AI keys out.
- **Unit:** runs `node apps/server/src/index.ts` as the developer with `ProtectSystem=strict`,
  `ProtectHome=read-only`, write access to `data/runtime` only, no capabilities, an address-family filter (with
  AF_NETLINK for glibc's resolver) and the other `Protect*`/`Restrict*` options (`systemd-analyze security` 3.2).
- **Caddy:** from its official apt repository (the documented key and source); the site block only compresses
  static files and proxies to the server; no `trusted_proxies`, so a client's own X-Forwarded-For is replaced
  (spoofing checked end to end, D-058). SSE is flushed as written.
- **One sudo rule:** `/etc/sudoers.d/sideline` lets the developer run `/usr/bin/systemctl restart sideline`
  without a password (validated with `visudo`), so `deploy/update.sh` (and an agent) can redeploy without the
  owner's terminal. Nothing else is allowed; the Caddyfile and env file still need `sudo deploy/install.sh`.
- **Scripts:** every change goes through `run()`, so `--dry-run` prints the plan; files are installed through a
  validated temporary file next to the target; idempotent; ufw opened only if it is filtering (it is not here).
- **Alternatives:** the working copy as WorkingDirectory (above); a user-level unit (cannot read a root-only env
  file); polkit instead of sudoers (less familiar, same effect); a hardcoded build-and-swap of `dist` (deferred,
  F07 follow-up 5).

### D-067 — The replay recorder, and production on a key with no credit (2026-10-17, T7, Nabhanyu + Claude)
- **Recorder:** `pnpm ai:record` walks every persona of both matches through the server's own sessions (play from
  the join point to the end; each one-click jump of the room: the phase rail's 0, 6 and 15 overs per innings and
  the jump control's 2nd innings after 18), so its keys are exactly what a live server asks for: 67 today (48
  teasers, 19 catch-up reels). Calls go one at a time on a hand-moved clock at 1x with the 60 s maximum delay, so
  each teaser gets the full 15 s timeout (the PLAN's 32x would give 9 s). Rows already recorded answer first
  (D-054), so a second run only fills gaps; explainer answers are never recorded. Without `--yes` it plans with no
  provider and sends nothing; `--provider scripted` (tests) refuses `data/ai-replay` as its output.
- **Owner's call (this session):** the key's account has no credit; keep the key as it is, in `.env` and in
  production, and do not block Task 7 on recording. Production therefore runs in "live" mode: every AI moment
  tries the provider, gets a 403 and shows the labelled fallback, and live AI resumes by itself once the account
  has credit. Recording and the real replay check wait for that (F07 follow-up 1); the mechanism is proven with
  scripted rows in a scratch data directory, through the real UI ("Replayed AI" on the reel and the 18.6 card).
- **Tests:** the E2E's local server is forced keyless (`SIDELINE_AI_PROVIDER=none`), so no test can spend money;
  the 18.6 card's expected provenance follows the server (exactly "Fallback" or "Replayed AI" locally, by whether
  a recording exists; what the AI mode allows on a deployed server).

### D-068 — The AI proxy's name leaves the repository; `/api/health` reports the endpoint's kind; the owner's domain (2026-10-17, T7, Nabhanyu)
- **Name:** the name of the OpenAI-compatible proxy behind today's key appears in no tracked file (code, tests,
  docs, handoffs, `.env.example`); it is "the proxy". Its base URL lives only in `.env` and
  `/etc/sideline/sideline.env`, still read as `OPENAI_BASE_URL`. `pnpm check:hardcode` gains a pass over every
  tracked file that fails on the name in any case, with no opt-out (the word list is stored reversed, the tests
  build it from parts). Git history keeps the old text: it is not rewritten (D-023); Task 10's push decides.
- **Health:** `publicConfigSummary` (and so `/api/health`, the boot line, `ai:smoke`, `ai:record`) reports
  `aiEndpoint`: `anthropic`, `openai` (api.openai.com) or `openai-compatible` for any other base URL, instead of
  `aiEndpointHost`. A custom host is configuration, not something to publish.
- **Domain:** `sideline.nabhanyubm.xyz` (an A record to the Elastic IP) is served next to the sslip.io name;
  `install.sh --domain` changes or drops it. The domain is checked but never required: the sslip.io name must
  answer, the domain only warns, and Caddy gets its certificate once the name resolves here. *Amended by D-070:
  the owner's domain is `sideline.nabhanyubm.tech`.*

### D-069 — Tasks 8 and 9 in one session; Task 10 pushes to GitHub (2026-10-17, after T7, Nabhanyu)
- **Decision:** the next fresh session implements Task 8 (AI skills II) and Task 9 (frontend II) together in one
  pass on one branch, `task/08-09-skills-frontend`, then writes HANDOFF10 for Task 10: the final audit and the push
  of the repository to GitHub (the first remote; until then nothing is pushed). The audit protocol is unchanged:
  the auditor verifies before merging and tags `t08-verified` and `t09-verified` on the merge commit.
- **Open for Task 10:** old commits contain the proxy's name (D-068); pushing them needs the owner's decision
  (push as is, or a fresh history), recorded then.

### D-070 — The owner's domain is `sideline.nabhanyubm.tech` (2026-10-17, T8-9, Nabhanyu; amends D-068)
- **Context:** D-068 named `sideline.nabhanyubm.xyz`, which never resolved (NXDOMAIN at the `.xyz` registry).
  Nabhanyu confirmed the final name at the start of the Task 8-9 session, overriding every earlier spelling.
- **Decision:** `deploy/install.sh` serves `sideline.nabhanyubm.tech` by default next to the sslip.io name;
  `scripts/test/deploy.test.ts`, the deploy README, the README, Architecture and the PLAN name it. Checked at
  the time: `dig +short A sideline.nabhanyubm.tech @1.1.1.1` prints `3.108.67.100` (Cloudflare's name servers,
  DNS only), while the installed Caddyfile still lists only the sslip.io name, so the HTTPS handshake for the
  domain fails until Nabhanyu runs `sudo deploy/install.sh` once (Constraint 25: the Caddyfile changes only
  through that script). Historical records (HANDOFF9, the F07 log, D-068's own text) keep the old spelling, with
  a pointer here where they are still read.
- **Alternatives:** keeping `.xyz` as the default (it does not exist); making the domain required (the
  sslip.io name must keep working on its own, D-068).

### D-071 — The AI mode follows the provider's last answer (2026-10-17, T8-9, Nabhanyu + Claude; F07 follow-up 3)
- **Context:** with a key whose account has no credit, production's gateway reported "live" (a provider is
  configured and the budget holds), so the TV's chip said "Live AI connected" while every card was a labelled
  fallback. Nabhanyu asked for the chip to say what is really happening.
- **Decision:** the gateway remembers the provider's last answer: a call that ends in a provider error (a bad
  key, no credit, an outage: the `provider error:` trace detail) turns `mode()` to "replay" until a later call
  gets any answer (valid, invalid, rejected by a guard or refused all count as answers); a timeout says nothing
  either way. Calls are still made, so live AI comes back by itself (D-067). A restart starts from the last
  answer on record: migration 2 adds `ai_calls.called` (filled in for older rows from the shape of the
  gateway's traces), and `TraceSink.lastProviderAnswer()` seeds the gateway at boot. The mode now also rides
  on every `telemetry` stream message (an optional `aiMode`, a contract addition), so an open TV's chip
  follows it within five seconds. The E2E reads whether a key is configured from `/api/health`
  (`aiProvider`), not from the chip, since a failing key's server still makes calls.
- **Alternatives:** a circuit breaker that stops calling a failing provider for a while (faster fallbacks, but
  it changes behaviour and hides recovery behind a timer); a fourth AI mode, "failing" (a contract change
  every consumer must learn, for a chip whose replay wording already says the truth: recorded answers or
  labelled fallbacks); a health probe at boot (spends money on every restart, Constraint 26).

### D-072 — Task 10 may scrub the forbidden word from git history and re-point the tags (2026-10-17, T8-9, Nabhanyu; for Task 10, amends D-023 and D-068)
- **Context:** D-068 removed the AI proxy's name from every tracked file but left old commits holding it, and
  D-069 left the push decision (push as is, or a fresh history) open for Task 10.
- **Decision (owner, explicit):** in Task 10, before the first push to GitHub, Nabhanyu approves rewriting the
  repository's history so that no commit (content or message) contains the forbidden word, while keeping the
  commit trail (every commit, its author, date and message otherwise intact, merges and all) and re-pointing
  the tags `t01-verified` to `t10-verified` at the rewritten commits. The pushed GitHub history must be 100%
  clean. This is the one exception to "never rewrite history, never move tags" (Constraint 21, ROLLBACK), and it
  applies only to that Task 10 step, done by Claude with Nabhanyu, after a backup of the unrewritten repository
  (a bundle or a mirror clone) and a check that the rewritten tree of every tag equals the original's apart from
  the scrubbed word.
- **Alternatives:** pushing the history as is (the word would be public in old commits); a fresh single-commit
  history (loses the audited trail and the tags' meaning).

### D-073 — The inspector and the fan's chat line as built (2026-10-17, T8, Claude)
- **Inspector:** `POST /api/sessions/:id/inspector` takes `{ question }` (the inspector skill, `fast`/`low`, writes
  one query) or `{ sql }` (the operator writes it), a new contract (`InspectorRequest`, `InspectorResult` in
  `contracts/inspector.ts`). Either way the query runs in the sandbox (D-074) over `visible_deliveries` (what this
  fan's TV has shown), `players` and `ai_calls`, and the result carries the SQL, the rows (at most 200) or the
  refusal, timeout or SQLite error with its reason, never a 500. The model's SQL is not guarded before the sandbox,
  so a refused query is shown with its reason (PLAN 9.2). `ai_calls` here has no `session_id` (a session id controls
  a session), no `moment_key` and no `detail` (they can name a ball this fan's TV has not shown). The SQL's key is
  the question's hash (`inspect:<hash>`), shared; the rows are the session's. Inspector questions are not moments
  and not in the scale projection (an operator's tool), but their calls are traced and counted.
- **Why the operator's own SQL:** production has no working key (D-067), so without it the inspector could never
  show a row there; and the sandbox, not the model, is the security boundary, so the operator's SQL takes the very
  path a model's does (Review focus 5 is tested through it).
- **Chat:** `POST /api/sessions/:id/chat { text, statBack? }` posts the fan's line stamped on their TV clock (shown at
  once; a stadium stamp would hold their own words back by their delay), to their own stream and snapshots only (the
  room read never reads it, D-045), hidden by a jump back to before it and sent again when play passes it, like a
  moment. With `statBack: true` the line is also a take checked against the match (D-075).
- **Limits:** lineup-intent, chat and inspector each take a token from their own per-address bucket (the ask rate,
  12 a minute, burst 4) before reading the body, so refused bodies count too.
- **Alternatives:** the inspector over the server's live database with a column deny list (one missed column leaks a
  session id or the future); a guard that refuses bad SQL before the sandbox (the UI could not show what was refused);
  questions only (a dead key means a dead inspector).

### D-074 — The SQL sandbox as built (2026-10-17, T8, Claude)
- **Decision:** `sql/validate.ts` checks the text: one statement (a trailing semicolon is fine), starting SELECT or
  WITH, no comments, at most 2000 characters, none of the PLAN's words (ATTACH, PRAGMA, INSERT, UPDATE, DELETE, DROP,
  ALTER, CREATE, REPLACE, VACUUM, RECURSIVE, load_extension) nor DETACH, REINDEX, ANALYZE or transaction control; a word
  inside a string literal is refused too. `sql/sandbox.ts` then starts a fresh worker thread (`sql/worker.ts`, 64 MB
  heap) that builds an in-memory database from the views it is handed (`sql/views.ts`: rows copied per query, so a
  query can never read past them), sets `PRAGMA query_only = ON`, installs SQLite's authorizer (SELECT, reads of those
  tables and 23 plain functions such as count, sum, round and coalesce; everything else denied), runs
  `SELECT * FROM (\n<sql>\n) LIMIT 200` and posts the rows back; the worker is terminated if it has not answered after
  2 s. Two queries may run at once; a third is "busy". `node:sqlite`'s `setAuthorizer` (Node 24.22) made the PLAN's
  "read-only connection" an allow-list: SQLite runs a self-referencing CTE without the RECURSIVE keyword, and the
  authorizer stops it where the word list cannot.
- **Views:** `visible_deliveries` (25 documented columns, from the bundle's events with the engine's leverage and win
  probability, cut at the fan's TV time), `players`, and for the inspector `ai_calls` (D-073). The same definitions
  feed the prompts, the worker and the UI.
- **Alternatives:** a read-only connection to the server's own database file (tests run on `:memory:`, the base
  tables would hold the future and session ids, and WAL readers interact with the writer); a SQL parser to whitelist
  identifiers (a dependency and still weaker than the authorizer); running the query on the main thread with a timeout
  (a synchronous query cannot be interrupted).

### D-075 — Task 8's skills as built: repair, yes-or-no rules, shared facts, the recorder (2026-10-17, T8, Claude)
- **Repair before guard:** skills may define `repair(out, facts)`, run after zod and before the guard; the lineup
  patch's drops a swap that is not one of the detector's listed swaps, repeats a benched pick or a replacement, or
  breaks a squad rule once the swaps before it are in. The trace's outcome is `repaired` (already in the contract)
  with what was dropped; it is a live answer, so telemetry no longer counts it as a fallback. The guard then needs a
  legal swap left, a valid squad and two different armbands on members of an XI.
- **Lineup requests:** `lineupKey(match, squad, intent)` hashes the request (normalised like a question) into the
  intent slot; allowed from the second XI until the fan's TV shows the first ball (DOMAIN §3: teams lock then); 409
  otherwise (`not_yet`, `no_squad`, `all_playing`, `locked`).
- **Rules the engine settles:** bailout predictions and room-read polls are yes-or-no: exactly two options, the first
  if the rule comes true; the model writes a rule as one flat object with nulls (`questRules.ts`) that must parse as a
  `QuestRule`, inside the quest window and after the wicket (bailout) or about balls still to come (poll), and not be
  decided already. Rewards are 100 simulated DreamBucks per correct call (a game parameter, not a statistic).
- **Shared facts:** the bailout's squad projection is split off before the prompt (`bailoutSkillFacts`), as the
  catch-up's squad impact is; the room read's facts never hold the fan's own lines.
- **Stat-back:** two calls on one personal key (`statback:<match>:<TV seq>:<hash>`): the query (the sandbox is its
  guard) and the verdict, whose guard accepts only numbers that appear in the rows (as is, rounded to 0-2 places, or a
  share of 1 as a percentage) or in the take. Every failure is a labelled card that says what happened.
- **Recorder:** bailouts and room reads are shared, so `pnpm ai:record` records them (91 planned calls); its sessions
  run without the lineup detector, so it never pays for a personal patch it would not record.
- **Order of the session (owner, this session; amends D-069):** Task 8 is audited, merged and tagged `t08-verified` on
  its own before Task 9, still on the one branch `task/08-09-skills-frontend`; Task 9 merges again for `t09-verified`.
- **Alternatives:** an all-or-nothing lineup guard (one bad swap would discard a good patch, against PLAN 8.1);
  multi-option predictions (one rule can only say yes or no); a discriminated union in the model's schema (strict
  structured-output modes handle unions unevenly).

### D-076 — Story mode and the Task 9 surfaces as built (2026-10-18, T9, Claude)
- **Story plan:** the engine's `buildStoryPlan` (contract `StoryPlan`, `contracts/story.ts`) picks the story's fan as
  the first pre-match persona with a team and the catch-up point as the first late joiner's join point; every other
  beat is a trigger the gate raises (all four detectors, the match's crowd) when that fan watches the whole match:
  the lineup patch (lead-in: the toss), the first bailout before the catch-up point (lead-in: two deliveries
  before), the catch-up jump, the first teaser of the last innings' death overs from the catch-up point on (lead-in:
  one delivery), the first room read from that ball on, and the end. `GET /api/matches/:matchId/story` serves it,
  built once per bundle; it names beats by event id and time, never what happens. On 2022: Babar's 1.1, the jump to
  14 overs of the chase, the 18.6 teaser and room read; on 2024: Rohit's 1.4, 15 overs, 16.1, the 16.6 room read.
- **Director:** a pure state machine in the browser (`story/director.ts`): steer (the beat's jump and pace: 32x
  between beats, the climax at 2x with the 25 s OTT delay so the hold is visible, 8x to the room read, 16x to the
  result), watch the fan's TV for the beat's moment, pause there with a one-line callout written by code, continue.
  The climax stops at its teaser (when it came in time) and its reveal. The room's own controls are off while the
  tour steers; "Leave the tour" ends its commands and gives them back. Lead-ins come from the plan, so a live model
  gets the teaser's full budget at 2x (at 16x or 32x it would be late, Review focus 3).
- **Cards:** each kind has its own shape: the lineup ledger (benched pick, replacement, credits after; the fan's
  request until the first ball), the comeback quest (calls settled by `resolveQuestRule` on the TV's events, simulated
  DreamBucks, trivia, the banter card drawn to a PNG on a canvas and shared with the Web Share API or downloaded), the
  room pods (shares as one bar, real chat lines), the take card (verdict, evidence, SQL and rows). Each is held on the
  TV clock until the picture shows what triggered it, with nothing of it in the DOM; the control plane holds bailout
  and room traces the same way. The fan's own chat lines are merged in time order.
- **Inspector UI and `/architecture`:** the inspector sits in the control plane (a question, the model's SQL in an
  editable box, the rows, every failure with its reason, the views from `GET /api/inspector/views`). `/architecture`
  adds, above the docs: the three theses (Architecture.md's section), the pipeline as an inline SVG drawn across or
  down for phones, the live AI-usage table from `GET /api/telemetry?scope=global`, the PLAN checklist as a timeline,
  and the credits (README.md's section). No new prose: the page renders the files.
- **Personas:** the story's fan comes from `personas.json`; the room says "Watching as <persona>". No persona editor
  (no PLAN step asks for one).
- **Alternatives:** a client-only director that waits for moments as they come (it cannot know where the big balls
  are, so it would play minutes of death overs at 2x, or run fast and make a live teaser late); story beats in a data
  file (hand-picked moments, the opposite of beats from triggers); the diagram as a raster image (no theme colours, no
  text alternative); a separate route for the story (the room is the story; `story=1` keeps links shareable).

### D-077 — The landing's performance pass, and how it was measured (2026-10-18, T9 step 9.5, Claude)
- **Measured first:** Lighthouse 13.5.0 (published 2026-09-18, run with `npx` from a scratch directory, not a
  dependency) on the landing page served the way production serves it (the built app behind a local Caddy with
  the production site block's `encode zstd gzip`): accessibility 100, best practices 96, performance 50 on the
  phone preset (1.2 s of blocking time) before the pass. Runs with reduced motion forced and with WebGL disabled
  showed the cost was the floodlight's colour cycle, a registered custom property animated on the main thread
  that repainted four 48 px blurs every frame (software raster in a GPU-less Chrome).
- **Decision:** (1) each floodlight blob is four fixed-colour tints cross-faded with `opacity`, stepped twenty
  times a second, and drifted with `translate`, all compositor work, with the same colours, order, phases and
  cycle (VISUAL_REFERENCES "As built"); (2) the match room is loaded on demand like `/architecture`, so the
  landing ships 358 kB of script instead of 442 kB (110 kB compressed); (3) the landing's wordmark makes its
  WebGL context when a pointer first enters it, so a page nobody points at compiles no shader; (4) the start
  section keeps the persona picker's height while the matches load (the arriving picker pushed the page down: a
  layout shift of 0.12). A quarter-size floodlight scaled up, and stepping the drift, were tried and measured: no
  gain, reverted.
- **Result, honestly:** the same build scores differently from run to run on this host (a remote desktop and other
  sessions keep its load average near 4 on 4 vCPUs): phone performance 87-92 (blocking 170-380 ms, first paint
  2.3 s, layout shift 0.007), desktop 79-98; accessibility 100 and best practices 96 in every run (the 4 points: a
  content-security-policy note in Chrome's Issues panel with no detail; no console error). The PLAN's "≥ 90" is met
  on a quiet run of each form factor, not reliably on this busy host; Task 10 measures again (F09 follow-up 1).
  *After the deploy (2026-10-18, `t09-verified`, production's own Caddy, load average 5-6):* phone performance 92
  (first paint 2.1 s, blocking 230 ms, layout shift 0), desktop 90 (0.4 s, 260 ms, 0.007), accessibility 100 and best
  practices 96 on both.
- **Alternatives:** dropping the floodlight's animation on GPU-less browsers (it would also hide it from the headless
  visual review); prerendering the landing's HTML (a build step and duplicated markup, for about a second of
  simulated first paint on a slow phone).

### D-078 — Task 10 as built: the sandbox's query in a killed process, two copies of the repository, the submission (T10, Claude; the copies: Nabhanyu; amends D-074, and D-072's last step)
- **The sandbox (the final security review, BUG-005):** a worker thread inside SQLite's native query loop does not
  stop for `worker.terminate()`, so the 2 s timeout answered while the query went on using a core until SQLite
  finished (960 ms of CPU in the second after the answer, in the test), its slot freed, and the process could not
  exit. Anyone can send such SQL through the inspector. Now `sql/sandbox.ts` forks `sql/worker.ts` as a child process
  per query, with an empty environment (the server's keys are never inside it), V8's heap capped at 64 MB as before
  and structured-clone IPC, and kills it with `SIGKILL` after its answer or at 2 s; a query settles, and its slot
  frees, only when the process has exited. Cost: about 120 ms per query to start a process (measured), against
  seconds for a model call. Test: "leaves nothing computing once a query is killed" (`sql.test.ts`) reads the CPU
  of the test process and its children in `/proc` (Linux only, like the deployment).
- **Two copies of the repository (Nabhanyu):** the working copy, with `.env`, its unrewritten history and the deploy
  checkout's `origin`, moves to `~/Downloads/SidelineProd-Dream11FDEAssignment` (`/srv/sideline`'s `origin` is
  re-pointed there, since `deploy/update.sh` deploys only from its own repository). The public repository is a fresh
  clone at `~/Downloads/Sideline-Dream11FDEAssignment`, with nothing untracked in it, whose history is scrubbed of the
  forbidden word as D-072 says (every commit, author, date and merge kept; the ten tags re-pointed); it alone is pushed
  to GitHub. This replaces D-072's "point the working copy at the scrubbed history": the working copy keeps its own
  history and is never pushed.
- **Not run (Nabhanyu):** the live AI smoke and the replay recording (PLAN 7.3 and Task 10): the proxy's account still
  has no credit, so both are skipped and recorded as skipped (F10); production keeps the key and goes live by itself
  once the account has credit (D-071).
- **The zip and the push follow the tag:** the zip is `git archive` of `t10-verified` from the public repository
  (tracked files only), its sha256 beside it in a `.sha256` file, since a file inside an archive cannot hold the
  archive's own hash; `docs/SUBMISSION.md` gives the command. A tagged tree cannot record its own push either: the
  PLAN's push item stays open in it.
- **Alternatives:** (sandbox) SQLite's progress handler or interrupt (`node:sqlite` exposes neither), a limit on joins
  in the validator (a CTE repeats a table without naming it again), a smaller row limit (a `count(*)` reads every row
  anyway); (copies) rewriting the working copy too (the deploy checkout and every local branch would follow it for no
  gain, and the unrewritten history never leaves this host).
