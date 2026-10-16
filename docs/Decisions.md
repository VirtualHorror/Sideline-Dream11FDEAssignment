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
  base URL, the current key is a proxy proxy key).

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
  Codex is configured (`~/.codex/config.toml`) with a custom provider, **proxy**
  (`https://api.proxy.pro/v1`, Responses API, model `gpt-6.1-sol`), key in `proxy_API_KEY`.
- **Decision:** config reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` (any
  OpenAI-compatible endpoint), `SIDELINE_MODEL_FAST` / `SIDELINE_MODEL_SMART`, and an optional
  `SIDELINE_AI_PROVIDER` override. Auto-detection: Anthropic if its key is set, else the
  OpenAI-compatible provider, else none. The local `.env` (git-ignored, mode 600) was created from
  `proxy_API_KEY` with `OPENAI_BASE_URL=https://api.proxy.pro/v1` and `gpt-6.1-sol` for both tiers.
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
