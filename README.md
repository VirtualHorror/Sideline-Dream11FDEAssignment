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

> Status: Task 1 (foundation) and Task 2 (cricket core: Cricsheet timeline, match reducer, fantasy
> scoring, engine report) complete and audited. See `docs/PLAN.md` for the build sequence and status.

## Quick start

Requirements: Node 24.22 and pnpm 10.34 (`~/.local/bin` on this host), Google Chrome for E2E.

```bash
pnpm install --frozen-lockfile
pnpm verify          # typecheck, lint, unit tests, anti-hardcoding scan, data gate, build
pnpm test:e2e        # Playwright on system Chrome, desktop + 390 px mobile
pnpm dev             # web on http://127.0.0.1:5173 (proxies /api to the server on :8787)
pnpm build && pnpm start   # production: server on :8787 serving apps/web/dist

# scorecard + fantasy points for a match, straight from the engine (--json for the oracle format)
node scripts/engine-report.ts data/raw/cricsheet/1298150.json \
  --players data/matches/1298150/players.json --rules data/rules/t20-fantasy.json
```

Optional AI configuration: copy `.env.example` to `.env` and add an Anthropic key or an
OpenAI-compatible key (+ `OPENAI_BASE_URL` and model names for non-OpenAI endpoints). The provider
defaults to whichever key is present. Without a key Sideline runs on deterministic logic plus
recorded AI output (from Task 7).

For the demo round, `/architecture` (from Task 6) presents this architecture and the live build
plan inside the app, rendered from the same docs in this repository.

## Repository

| Path | What |
| --- | --- |
| `packages/engine` | Pure, isomorphic TypeScript core (contracts, cricket timeline, fantasy, models, detectors) |
| `apps/server` | Node 24 + Hono API, SSE stream, sessions, AI gateway (runs `.ts` directly) |
| `apps/web` | React 19 + Vite 8 + Tailwind 4 client |
| `data/` | Real Cricsheet data, authored fixtures, rules, models (see `data/README.md`) |
| `scripts/` | data fetch/verify, anti-hardcoding scan, engine report, independent Python oracle and the auditor's toolkit |
| `e2e/` | Playwright tests |
| `docs/` | Architecture, Decisions, Flow, Constraints, TEST_CHECKLIST, ROLLBACK, PLAN, DOMAIN, Bug_Feature register, design, features, bugs |

## How this was built

Claude Code (architect and auditor) designed the system, wrote the plan and Task 1, and audits each
task; OpenAI Codex implements tasks on branches. The process is documented as it happens:
`docs/Decisions.md` (why), `docs/Flow.md` (how execution travels), `docs/features/` (per-task
traces), `docs/TEST_CHECKLIST.md` (what proves it works), `docs/ROLLBACK.md` (how to undo it).

## Credits and licences

- Ball-by-ball data: [Cricsheet](https://cricsheet.org), Open Data Commons Attribution License 1.0.
- Typeface: Anek Latin by Ek Type (OFL-1.1), self-hosted via Fontsource.
- A concept prototype, not an official Dream11 product.

Made with 💖 by Nabhanyu for Dream11 - Forward Deployed Engineer Intern - Assignment
