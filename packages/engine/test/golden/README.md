# Golden fixtures

`<matchId>.oracle.json` is the output of the independent Python oracle
(`scripts/oracle/cricsheet_oracle.py`) on the committed raw Cricsheet file, with the committed
players and rules files. Its scorecards were spot-checked against the public scorecards of both
matches (see `docs/DOMAIN.md` §4).

Engine tests compare against these files. **Never edit them by hand, and never regenerate them to
make a failing engine test pass.** If the oracle and the engine disagree, the definitions in
`docs/DOMAIN.md` decide; record the investigation in `docs/bugs/`.

Regenerate only when the raw data, players or rules legitimately change (and say so in the
HANDOFF):

```
python3 -I scripts/oracle/cricsheet_oracle.py data/raw/cricsheet/<id>.json \
  --players data/matches/<id>/players.json --rules data/rules/t20-fantasy.json --json \
  > packages/engine/test/golden/<id>.oracle.json
```

A regenerated file can differ from the committed one in the key order of `fantasy` alone (the
oracle iterates a set; Python randomises string hashing per process), so compare as data, not
bytes. The engine tests already do.

Shape: `{ innings: [{ innings, team, totals: {runs, wickets, legal_balls, deliveries, extras},
batters: {<playerId>: {runs, balls, fours, sixes, dots, strike_rate, out}}, bowlers: {<playerId>:
{legal_balls, conceded, wickets, lbw_bowled, maidens, dots, wides, noballs, overs, economy}},
fall_of_wickets: [{wicket, runs, label, player, kind, bowler}], fielding: {...} }],
fantasy: {<playerId>: {total, breakdown}} }`. Names in `player`/`bowler` are Cricsheet names;
map them to ids through the raw file's `info.registry.people`.
