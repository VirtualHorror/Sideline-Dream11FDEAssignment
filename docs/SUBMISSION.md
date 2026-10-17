# Submission

> The note for the assignment's form (at most 200 words, the links included), then what a reviewer needs
> beside it. Written for Task 10 (`docs/PLAN.md`); Nabhanyu reads and owns the wording.

## The note (184 words)

A live cricket match loses fans at four moments: a surprise playing XI benches your pick minutes before
lock, your captain falls cheaply in the powerplay, you join at over 14 to a cold scoreline, and your stream
runs 25 seconds behind a chat that spoils every big ball.

Sideline is a second-screen companion for exactly those moments: a Lineup Patch with legal swaps, a
Bailout comeback quest the engine settles from real deliveries, a Catch Me Up reel in your own lens, and
spoiler-free teasers released on your TV's clock, with a Room Read of the chat. It replays real
ball-by-ball data. Rules handle most events (233 of 266 in the 2022 replay); the model is called only at
high-entropy moments and cached by moment, so cost scales with the match, not the audience. Every output
is validated, every fallback labelled, and a control plane shows each decision and its cost.

AI tools: Claude Code was my architect and auditor and built most of it; OpenAI Codex built the cricket
core. The product calls models through a provider-agnostic gateway.

Live: https://sideline.nabhanyubm.tech/
Code: https://github.com/VirtualHorror/Sideline-Dream11FDEAssignment

## Links

| What | Where |
| --- | --- |
| The live app | <https://sideline.nabhanyubm.tech/> (also <https://3-108-67-100.sslip.io/>: the same server) |
| The guided demo | "Watch the story" on the landing page, or `/match/1298150?persona=babar-believer&story=1` |
| How it is built, inside the app | `/architecture`: the pipeline, a live count of what ran without AI, the build plan, every decision |
| The code | <https://github.com/VirtualHorror/Sideline-Dream11FDEAssignment> (`main` and the tags `t01-verified` to `t10-verified`) |
| A five-minute walkthrough and likely questions | `docs/DEMO_SCRIPT.md` |

## What a reviewer sees today

- **The AI cards (updated 2026-10-17, Task 11).** The guided story and both replays show recorded real answers ("Replayed
  AI"): 87 of the 91 shared moments, recorded through the AI chain (Groq's free tier; D-079), each row naming the model
  that wrote it. Everything else (a fan's question, lineup request, take, an inspector question, and the 4 moments whose
  answers the guards rejected) is answered live by the chain once production's env file has the Groq key (`sudo
  deploy/install.sh`, F11); until then, and whenever every link is down, those cards say "Fallback: AI unavailable": a
  template filled from the same facts the model would get, never text dressed up as model output (Constraint 2). The
  proxy's key behind the first submission still has no credit (D-067); it is now the chain's last link.
- **Everything else is live:** the real 2022 and 2024 matches, the fan's delayed TV clock, held and revealed spoilers,
  the comeback quests settled from real deliveries, the inspector's read-only SQL, the control plane's numbers.

## The submission zip

The archive is the repository at `t10-verified`, tracked files only (no `.env`, no `node_modules`, no runtime
database), made from the public repository with:

```bash
git archive --format=zip --prefix=Sideline-Dream11FDEAssignment/ -o Sideline-Dream11FDEAssignment.zip t10-verified
```

Its sha256 sits beside it in `Sideline-Dream11FDEAssignment.zip.sha256`: a file inside the archive cannot hold the
archive's own hash (D-078).
