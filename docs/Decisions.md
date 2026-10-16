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
