# Bug / Feature register

One row per feature (task) and per bug, with its status and where the detail lives. Feature
detail is in `docs/features/FNN-*.md`, bug detail in `docs/bugs/BUG-NNN-*.md`. Every task and every
audit updates this page.

## Features

| Id | Feature | Status | Record |
| --- | --- | --- | --- |
| F01 | Foundation: toolchain, monorepo, contracts, real data, guards, oracle, docs, shell | audited, `t01-verified` | [F01](features/F01-foundation.md) |
| F02 | Cricket core: Cricsheet timeline, reducer, fantasy scoring, engine report CLI | audited and merged, `t02-verified` | [F02](features/F02-cricket-core.md) |
| F03 | Models: T20I archive pipeline, win probability, leverage threshold, player priors | audited and merged, `t03-verified` | [F03](features/F03-models.md) |
| F04 | Moments engine: clocks, delay buffer, commentary lines, phase detectors (lineup, collapse, nudge with the match-deciding ball, room), catch-up facts, entropy gate, quest resolver, synthetic crowd; Task 3 carry-overs (step 4.0) | audited and merged, `t04-verified` | [F04](features/F04-moments-engine.md) |
| F05 | Server runtime and AI layer: match bundles, SQLite, per-browser sessions on one ticker, SSE, the AI gateway (Anthropic and OpenAI-compatible providers, cache, budget, traces, replay rows, labelled fallbacks), orchestrator, spoiler teaser / catch-up / explainer skills with their guards, telemetry and the scale projection, `pnpm ai:smoke`; the `t04-verified` spot-check and its two pinned test gaps | audited and merged, `t05-verified` | [F05](features/F05-server-ai.md) |
| F06 | Frontend I: landing page (floodlit hero, ghost-text wordmark, persona picker), match room on the fan's TV clock (TV pane, companion with held spoilers, catch-up reels, the explainer, the simulated chat, control plane drawer), the four effects with fallbacks, `/architecture`; `GET /api/matches/:matchId`; the `t05-verified` spot-check and its four pinned test gaps; BUG-004 | audited and merged, `t06-verified` | [F06](features/F06-frontend-core.md) |
| F07 | Deploy (Milestone A): `deploy/install.sh` (Caddy, automatic TLS for the sslip.io name and the owner's domain, the sandboxed `sideline` unit from a deploy checkout, the root-only env file, one sudo rule), `deploy/update.sh` (redeploy, rollback), `pnpm ai:record` (the replay recorder; rows wait for a key with credit), the E2E against the public site; `/api/health` reports the endpoint's kind; the forbidden-word scan (D-068); the `t06-verified` spot-check and its three pinned test gaps | audited and merged, `t07-verified` | [F07](features/F07-deploy.md) |
| F08 | AI skills II: lineup patch (illegal swaps dropped, fan requests until the first ball), bailout (comeback quests the engine settles), room read, stat-back and the NL inspector over a read-only SQL sandbox (worker, in-memory views, SQLite's authorizer, 2 s kill); lineup-intent, chat and inspector routes; the TV chip follows the provider (D-071); the domain (D-070); Task 10's history scrub recorded (D-072) | audited and merged, `t08-verified` | [F08](features/F08-ai-skills-2.md) |
| F09 | Frontend II: a card for every moment (lineup ledger, comeback quest with its shareable banter card, room-read pods, take card), the fan's chat line and stat-back, the inspector in the control plane, story mode from the data (the engine's plan, a pure director, stops on the fan's TV clock), the `/architecture` polish (theses, pipeline SVG, live AI-usage table, timeline, credits), the landing performance pass (D-077) | audited and merged, `t09-verified` | [F09](features/F09-frontend-complete.md) |
| F10 | Final audit and submission: TEST_CHECKLIST §2 across the repository with a holdout (1512772) and the archive sweep, the security review (BUG-005: the sandbox's query now runs in a process killed at 2 s, D-078), the submission note and the demo script, the README's clone-and-run steps, the two copies of the repository (D-078) | audited, `t10-verified` | [F10](features/F10-final-audit.md) |

## Bugs

| Id | Summary | Severity | Status |
| --- | --- | --- | --- |
| [BUG-001](bugs/BUG-001-oracle-scores-substitute-fielders.md) | The oracle gave fantasy points to substitute fielders outside the playing XI. DOMAIN §3 says they score nothing, and the engine follows DOMAIN. | minor | fixed in the oracle (D-038) |
| [BUG-002](bugs/BUG-002-engine-rejects-cricsheet-edge-cases.md) | `buildTimeline` rejects some valid Cricsheet files: 31 of 230 in the World Cup archive, and 162 of the 3,255 T20Is that pass Task 3's filters (mid-over bowler change, seven-ball over, XI not 11, nameless fielder, `retired not out`) | minor for the product, major for Task 3 if unhandled | open: Task 3 excludes and counts them (162 of 3,255, by reason in `data/models/README.md`); engine support is backlog |
| [BUG-003](bugs/BUG-003-leverage-misses-two-planned-climax-balls.md) | PLAN 3.4 expected 1298150's 18.5 six and winning single to be big balls; the specified model scores them 0.093 and 0.019 against a 0.184 threshold (the 19.6 wide before the single carries the swing) | major for Task 3 acceptance | resolved by amending the plan (D-043, Nabhanyu); nothing tuned |
| [BUG-004](bugs/BUG-004-delayed-tv-never-reaches-the-result.md) | A fan whose TV runs further behind than the crowd's last reaction (25 s and 40 s personas in 1298150) never saw the last balls or the result: the session clock stopped when the ground was done | major | fixed in Task 6 (D-063, test first) |
| [BUG-005](bugs/BUG-005-sandbox-timeout-leaves-the-query-running.md) | The SQL sandbox answered "timeout" at 2 s while its worker thread, inside SQLite's native loop, kept computing (a core per query; the slot freed): reachable by anyone through the inspector | major | fixed in Task 10 (test first; D-078) |

Fixed while Task 2 was being implemented (logged in F02, no bug file):
- The result text used Cricsheet's team name instead of the authored display name. A regression test now covers it.
- The test fixture helper had a malformed template literal.
- A live-scoring test selected the wrong delivery.

Fixed while Task 3 was being implemented (logged in F03, no bug file):
- A winner without a margin read "X won by the match"; it now reads "X won" (F02 follow-up 7, test first).

Fixed in Task 4 step 4.0 (logged in F04, no bug file):
- `projectedPoints` took an inherited name (`toString`, `constructor`) for a priors entry and failed
  with a TypeError instead of "no priors for player" (test first).
- Two Task 3 behaviours were untested (a diagonal-only Hessian and leverage counting retired hurt as a
  wicket would both have passed); tests now pin them.

Fixed while Task 5 was being implemented (logged in F05, no bug file):
- The scale projection printed `100.0000%` for a saving of 99.9999991%; it now shows as many decimals
  as it takes not to round up to 100 (test first).
- A browser reconnecting to a session that had already stopped was not told; the stream now repeats the
  `session_failed` error after the snapshot (test first).
- A replay file line that was not JSON failed with a bare `SyntaxError`; it now names the file and line.

Closed by tests in Task 5 (the `t04-verified` spot-check, D-051, no bug file):
- Nothing pinned the room detector's ten-minute history minimum or an at-most dots quest settling on the
  ball that makes it certain; the merged code was right, and both edges now have tests.

Fixed while Task 6 was being implemented (logged in F06, no bug file):
- The scorebug read "Need 0 off 0" between the winning run and the innings end (test first).
- Playback buttons changed only when the server's clock came back, so a click looked ignored for a round
  trip; they now show the choice at once and the answered clock is applied immediately (test first).
- The floodlight was invisible on a tall hero (its blobs were offset by a share of the container's height
  but sized by its width), and the ghost-text sweep painted no fringes (the splat's energy scaled its
  velocity to almost nothing); both found in the visual review and tuned (VISUAL_REFERENCES "As built").

Fixed while Task 7 was being implemented (logged in F07, no bug file):
- The catch-up fallback reel said "1 balls without a run" and "From 15.1 to 15.1" for a one-ball scoreless spell,
  and could say "1 wickets" or "1 overs" (Nabhanyu, from the Task 6 screenshots; test first).
- Before anything ran with sudo, the deploy scripts' own review found three shell traps (a function called in an
  `||` list loses `set -e`; a pipe into a reader that exits early can abort under pipefail; `systemctl` taken from
  PATH by a root script) and the plan's port 8787 colliding with `pnpm dev` on the same host (D-066).

Closed by tests in Task 7 (the `t06-verified` spot-check, D-065, no bug file):
- Nothing pinned a teaser's trace staying held while its card only teases, a question's trace showing at once, or
  a seek past the end clamping to the crowd's last reaction; the merged code was right, and all three now have tests.
