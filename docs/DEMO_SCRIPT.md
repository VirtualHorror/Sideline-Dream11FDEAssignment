# Demo script: five minutes, then questions

> For the virtual demo round (Task 10, `docs/PLAN.md`). Every number below comes from the app, the docs or the
> raw data; say where it comes from if asked. The guided tour does the driving, so the talk can follow the
> product instead of the mouse.

**Before the call:** open <https://sideline.nabhanyubm.tech/> and `/architecture` in two tabs; `curl -fsS
https://sideline.nabhanyubm.tech/api/health` should say `"ok":true`. The tour runs the 2022 T20 World Cup match,
India v Pakistan at the MCG (India won by 4 wickets), as **Captain Babar**: a fan who made Babar Azam captain and
watches a stream 25 s behind the stadium. If the AI provider has no credit, the TV's chip says "No live AI" and the
AI cards are labelled fallbacks: say so up front, it is part of the design (questions below).

## The walkthrough

| Time | Where | What to show | What to say |
| --- | --- | --- | --- |
| 0:00 | Landing page | The four moments, "Watch the story" | "A live match loses fans at four moments. Sideline meets each one, on real ball-by-ball data." |
| 0:30 | Stop 1: the playing XIs | The lineup patch card | "Code diffs the announced XI against the fan's squad and lists only legal swaps; the model writes the why; the squad validator re-checks whatever it proposes." |
| 1:00 | Stop 2: Babar lbw to Arshdeep, the first ball of the second over, for 0 | The comeback quest and its banter card | "The captain is gone: the fan's team feels dead. A three-over quest of yes-or-no calls, settled by the engine from the real deliveries, not by the model." |
| 1:40 | Stop 3: the chase after 14 overs, as "Late from work" | The catch-up reel | "Someone opening the app now gets the story so far from facts the engine ranked, told in their own lens: plain English, an F1 fan's terms, and others." |
| 2:15 | Stop 4: the chase's 18.6 | The teaser held under the veil | "The stadium has seen this ball; this fan's stream has not. The teaser was written without the outcome in its prompt, so it cannot spoil what it was never told." |
| 2:40 | Stop 5: the reveal | Kohli's six off Haris Rauf, the floodlight outburst | "The card opens when the fan's own TV shows the ball. The broadcast delay is the AI's latency budget." |
| 3:00 | Stop 6: the room read | The chat clustered into pods (with live AI, also a hot take and a poll) | "A firehose of chat becomes a few debates. The chat is synthetic and labelled so." |
| 3:20 | Stop 7: the result | "That's the match." | Then open the control plane in the room. |
| 3:30 | Control plane | Decisions with reasons, AI traces with provenance (live, cache, replay, fallback), cost, the spoiler budget, the scale projection | "Most events never reach a model: the counters show the deterministic share live. Every AI call has a key, a schema, a timeout, a fallback and a trace." |
| 4:00 | The inspector (control plane) | Your own SQL (or, with live AI, a question the model turns into SQL), the rows; then `DELETE FROM ai_calls` refused | "Model-written SQL runs read-only in a sandbox: one SELECT, a deny list, SQLite's authorizer, 200 rows, killed after 2 s." |
| 4:30 | `/architecture` | The pipeline, the live "when we don't call AI" table, the build plan, the decisions | "The design, the plan and every decision live in the repository and render here, so the page cannot drift from the code." |

## Likely questions

**When does Sideline not call AI?** Score, overs and run rates (the reducer), fantasy points and squad legality,
win probability and leverage (a logistic model trained on 3,093 real men's T20Is), the XI diff and legal swaps,
holding spoilers, settling predictions, glossary terms and every routine delivery. On the 2022 replay that is 233 of
266 events. The model is called for a cheap captain's dismissal, a high-leverage or match-deciding ball, a late
join, a fan's own request and a chat spike (`docs/Architecture.md` §5).

**How does it scale to millions of fans?** Calls scale with moments, not fans. A shared moment has one key (a
teaser is keyed by match and ball), so the first fan's call is everyone else's cache hit; personal moments are keyed
by cohort or squad. The control plane projects it from live counters: for a Captain Babar replay of 2022, a naive
call per event per fan at 10 million viewers is 2,660,000,000 calls; Sideline is its shared keys plus one personal
lineup patch per viewer, about 99.6% fewer, and 99.999999% fewer with no personal moments (§6).

**What does it cost?** Each call's cost comes from the tokens the provider reports, priced from `.env`; the control
plane adds it up live. Two caps hold it: a global daily budget (`SIDELINE_AI_DAILY_BUDGET_USD`, $3 by default) and
80 model calls per session; past either, cards fall back, labelled. Questions are rate-limited per address.

**What happens with no key, a failing key or a slow model?** No key: recorded answers (`pnpm ai:record`) or labelled
fallbacks; nothing spins. A failing key (today's case): the TV's chip turns to "No live AI" after the provider's
error and back to live on its first answer, with no restart (D-071). A slow model: if a teaser arrives after the
fan's TV has passed the ball, it is dropped, the card reveals normally and the trace records the miss.

**How do you know the cricket is right?** The engine's scorecards and fantasy points match an independent Python
oracle on both demo matches, on a match no code ever saw (the final audit's: the 2026 semi-final, India v England)
and on 199 of the 230 matches in the ICC men's T20 World Cup archive; the other 31 are documented rejections, never
wrong answers (`docs/bugs/BUG-002`). A scan fails the build on any match fact written into the code.

**What about hostile input?** Questions over 280 characters are refused (400), bodies over 16 KB too (413), floods
get 429; fan text sits escaped inside its own tag in every prompt; SQL from the model or the inspector runs only in
the sandbox. The final audit's security review found that the sandbox's 2 s stop left the query computing in the
background; it now runs in a separate process that is killed outright (D-078).

**What would you build next?** A live data feed in place of the replay (the engine already folds events as they
arrive); creator watch-along sync, holding a creator's reactions to each fan's TV clock (PLAN Stretch S2); a football
adapter through the same contracts (S1); the follow-ups listed in `docs/features/`.
