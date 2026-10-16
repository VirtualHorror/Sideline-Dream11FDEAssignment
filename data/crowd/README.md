# data/crowd

`corpus.json` is the **synthetic** watch-along chat behind Sideline's simulated crowd (PLAN Task 4,
D-047). It was written by hand for this prototype. No real fan wrote these lines, no handle
belongs to a real account, and the app labels every message "Simulated crowd".

## What is in it

| Field | What |
| --- | --- |
| `handles` | 40 made-up cricket-flavoured handles (`cover_drive_09`, `yorker_queen`, ...) |
| `rates` | For each trigger: how many messages one firing produces (`min`..`max`) and how fast fans react (exponential delay with `meanDelayMs`, capped at `maxDelayMs`) |
| `lines` | 303 lines (English, Hinglish and a few in Hindi), each with a `trigger`, a `stance` the room read can count, and a `side` (whose fan says it) |

Triggers: `ambient`, `toss`, `playing_xi`, `innings_start`, `dot`, `runs`, `four`, `six`, `wicket`,
`wide`, `noball`, `freehit`, `over_end`, `pressure` (a live chase in the death overs), `innings_end`
(the innings break) and `match_end`. A delivery fires one main reaction (wicket, six, four, no-ball,
wide, dot or runs) plus any of `noball`, `freehit` (a no-ball just gave one), `over_end`, `pressure`
and `ambient`.

## Rules for editing

- **Placeholders only.** Names and teams are never written into a line. Use `{batter}`, `{bowler}`,
  `{nonStriker}`, `{playerOut}`, `{fielder}`, `{catcher}` (caught dismissals only),
  `{battingTeam}`, `{bowlingTeam}`, `{score}`, `{runsRequired}`, `{ballsRemaining}` (a live chase
  only), `{tossWinner}` and `{winner}`. The engine fills them from `players.json` (short names) and
  team codes; a line whose placeholder has no value for an event is skipped.
- `side: "winner"` / `"loser"` only for `match_end`; `toss`, `playing_xi` and `ambient` lines are
  `side: "any"` (there may be no innings yet).
- No player, team or venue names from any `data/matches/*` file, nothing offensive, no gendered
  pronouns for players. `packages/engine/test/crowd.test.ts` checks the names and the schema;
  `CrowdCorpusSchema` (in `packages/engine/src/crowd/simulate.ts`) rejects unknown placeholders,
  duplicate ids and a trigger with no line.

## How it is used

`simulateCrowd({ events, players, corpus, seed })` turns a match timeline into chat messages. Each
event draws from its own generator seeded with the seed and the event id, so the same seed always
gives the same crowd, and simulating part of a timeline gives exactly the same messages for those
events. The server seeds each session (Task 5); the room detector reads only these shared messages.
