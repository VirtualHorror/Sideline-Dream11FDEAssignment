# Sideline

**The match, on your clock.** An AI-powered second-screen companion for live cricket, built as the
Dream11 Forward Deployed Engineer Intern assignment by Nabhanyu.

Sideline steps in at the four moments a live match usually loses a fan:

1. **Toss to lock:** a surprise playing XI benches a player you picked → *Lineup Patch*
2. **Early collapse:** your captain is out for nothing → *Bailout* comeback quest
3. **Joining late:** you open the app at over 14 → *Catch Me Up* reel, in plain English or F1 terms
4. **Climax:** your stream is 25 s behind the chat → *Hold the Spoiler* teasers, *Room Read* of the chat

A control plane shows what the system decided and what it cost: most events are handled by
deterministic code, the model is called only for high-entropy moments, and every AI result is
cached by moment so the cost scales with the match, not with the number of fans.

The demo replays **real ball-by-ball data** (Cricsheet) of India vs Pakistan at the 2022 T20 World
Cup, with the 2024 final as a second match to prove nothing is hardcoded.

**Live:** <https://sideline.nabhanyubm.tech/> (the owner's domain, D-070: its DNS points here; Caddy serves it
once `sudo deploy/install.sh` has run with it) and
<https://3-108-67-100.sslip.io/> (always): one EC2 host, Caddy with automatic HTTPS, the server under
systemd (`deploy/README.md`).

> Status: Tasks 1-9 complete and audited (Milestone A, the public link, at Task 7; Milestone B, the complete product, at Task 9): foundation; cricket core (Cricsheet timeline, match
> reducer, fantasy scoring, engine report); models (win probability, leverage and player priors
> trained on 3,093 real men's T20Is, rebuilt byte for byte by one script); the moments engine (TV
> clock and delay buffer, the four phase detectors, the entropy gate that keeps 233 of 266 events
> of the 2022 replay away from any model, quest resolution and a seeded synthetic crowd); the server
> runtime (a session per browser streamed over SSE, the AI gateway with moment-keyed caching, budgets
> and labelled fallbacks, spoiler teasers that never see the outcome, catch-up reels, a
> glossary-first explainer, telemetry with the scale projection); and the first UI: a floodlit landing
> page with a ghost-text wordmark and a persona picker, a match room folded on the fan's own delayed TV
> clock (big balls held under a dither veil until the fan's stream shows them, then revealed with a
> floodlight outburst; catch-up reels; questions; a simulated watch-along chat), a control plane that
> shows every decision and what it cost, and `/architecture`; and the deployment: Caddy and a
> sandboxed systemd unit on this host, one-command install and redeploy, a replay recorder for keyless
> demos, and the browser tests run against the live site; and the rest of the AI (Task 8): lineup patches for
> benched picks, comeback quests after a captain's cheap dismissal that the engine settles from real deliveries,
> room reads of the watch-along chat, stat-backs of a fan's take, and an inspector, both over a read-only SQL
> sandbox; and the complete product (Task 9): a card for every moment, the fan's own chat line, the inspector
> in the control plane, a guided story mode built from the match's own triggers ("Watch the story" on the
> landing page), and `/architecture` with the pipeline, a live count of what ran without AI and the build
> timeline. See `docs/PLAN.md` for the build sequence and status.

## Quick start

Requirements: Node 24.22 and pnpm 10.34 (`~/.local/bin` on this host), Google Chrome for E2E.

```bash
pnpm install --frozen-lockfile
pnpm verify          # typecheck, lint, unit tests, anti-hardcoding scan, data gate, build
pnpm test:e2e        # Playwright on system Chrome, desktop + 390 px mobile
pnpm dev             # web on http://127.0.0.1:5173 (proxies /api to the server on :8787)
SIDELINE_AI_PROVIDER=none pnpm dev   # the same without calling the AI provider in .env
pnpm build && pnpm start   # the production build on :8787 (the deployed server uses :8780, below)

# scorecard + fantasy points for a match, straight from the engine (--json for the oracle format)
node scripts/engine-report.ts data/raw/cricsheet/1298150.json \
  --players data/matches/1298150/players.json --rules data/rules/t20-fantasy.json

# rebuild data/models (win probability, leverage threshold, priors) from Cricsheet's T20I archive
node scripts/build-models.ts            # or --zip <saved t20s_male_json.zip> for an exact rebuild

# one real teaser call through the AI gateway with the provider in .env (spends a few thousand tokens)
pnpm ai:smoke

# the replay cache for keyless demos: the plan (sends nothing), then the recording (spends money)
pnpm ai:record
pnpm ai:record --yes

# deploy on this EC2 host (deploy/README.md): once with sudo, then redeploys and rollbacks without
deploy/install.sh --dry-run && sudo deploy/install.sh
deploy/update.sh                      # main; or a tag such as t07-verified to roll back
PLAYWRIGHT_BASE_URL=https://3-108-67-100.sslip.io pnpm test:e2e   # the browser tests, live
```

The API (Task 5): `GET /api/matches`, `POST /api/sessions`, `GET /api/sessions/:id/stream` (SSE),
`POST /api/sessions/:id/control`, `POST /api/sessions/:id/ask`, `GET /api/telemetry`; the flows are in
`docs/Flow.md` §7, §8 and §13.

Optional AI configuration: copy `.env.example` to `.env` and add an Anthropic key or an
OpenAI-compatible key (+ `OPENAI_BASE_URL` and model names for non-OpenAI endpoints). The provider
defaults to whichever key is present. Without a key Sideline runs on deterministic logic, and every
AI card falls back to a labelled template built from the same facts, or replays recorded AI output
(`pnpm ai:record`, `data/ai-replay/`).

For the demo round, `/architecture` presents this architecture, the live build plan and every
decision inside the app, rendered at build time from the same docs in this repository. Open
`/match/1298150?persona=late-from-work` to join the 2022 chase after 14 overs, or pick any fan on `/`.

## Repository

| Path | What |
| --- | --- |
| `packages/engine` | Pure, isomorphic TypeScript core (contracts, cricket timeline, fantasy, models, detectors) |
| `apps/server` | Node 24 + Hono API, SSE stream, sessions, AI gateway (runs `.ts` directly) |
| `apps/web` | React 19 + Vite 8 + Tailwind 4 client |
| `data/` | Real Cricsheet data, authored fixtures, rules, models (see `data/README.md`) |
| `scripts/` | data fetch/verify, anti-hardcoding scan, engine report, model build, independent Python oracle and the auditor's toolkit |
| `e2e/` | Playwright tests |
| `docs/` | Architecture, Decisions, Flow, Constraints, TEST_CHECKLIST, ROLLBACK, PLAN, DOMAIN, Bug_Feature register, design, features, bugs |

## How this was built

Claude Code (architect and auditor) designed the system, wrote the plan and Task 1, and audits each
task; OpenAI Codex implements tasks on branches (Claude implemented Tasks 3, 4, 5 and 6 while Codex
was unavailable). The process is documented as it happens:
`docs/Decisions.md` (why), `docs/Flow.md` (how execution travels), `docs/features/` (per-task
traces), `docs/TEST_CHECKLIST.md` (what proves it works), `docs/ROLLBACK.md` (how to undo it).

## Credits and licences

- Ball-by-ball data: [Cricsheet](https://cricsheet.org), Open Data Commons Attribution License 1.0.
- Typeface: Anek Latin by Ek Type (OFL-1.1), self-hosted via Fontsource.
- Markdown on `/architecture`: markdown-it (MIT).
- A concept prototype, not an official Dream11 product.

Made with 💖 by Nabhanyu for Dream11 - Forward Deployed Engineer Intern - Assignment
