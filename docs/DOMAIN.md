# Domain primer: T20 cricket, fantasy, and the two demo matches

This is the source of truth for every cricket and fantasy definition in the codebase. The
TypeScript engine (`packages/engine`) and the independent audit oracle
(`scripts/oracle/cricsheet_oracle.py`) both implement exactly these definitions. If they ever
disagree, this document decides, and the losing side gets fixed.

Written for builders with no cricket background (including the author of the project).

---

## 1. T20 cricket in five minutes

- Two teams of 11. Each team bats once (an **innings**) for at most **20 overs**.
- An **over** is 6 **legal** deliveries bowled by one bowler. A bowler may bowl at most 4 overs.
- The batting side scores **runs**. It loses a **wicket** when a batter is dismissed. Ten wickets
  ends the innings early ("all out").
- The team batting second is **chasing** a **target** (first-innings total + 1). It wins as soon
  as it reaches the target, otherwise the team that batted first wins.
- Two batters are at the crease. The one facing is the **striker**. The other is the **non-striker**.

### Deliveries and extras

| Term | Meaning | Counts as a legal ball? | Faced by batter? |
| --- | --- | --- | --- |
| Legal delivery | Normal ball | yes | yes |
| **Wide** (wd) | Too wide to hit. +1 run penalty (+ any runs run) | **no**, re-bowled | **no** |
| **No-ball** (nb) | Illegal delivery (overstep, waist-high full toss). +1 run penalty | **no**, re-bowled | **yes** |
| **Bye** (b) | Runs taken when the ball misses bat and body | yes | yes |
| **Leg-bye** (lb) | Runs taken off the batter's body | yes | yes |

- **Free hit**: the delivery after a no-ball. The batter cannot be out bowled or caught.
  If the free-hit delivery is itself a wide or no-ball, the free hit carries over to the next one.
- **Boundary**: the ball reaches the rope. **Four** (bounced) or **six** (on the full). Cricsheet
  marks the rare all-run four with `runs.non_boundary: true`. That is *not* a boundary.

### Scoreboard notation

- Score: `runs/wickets`, e.g. `159/8`.
- Overs: `completedOvers.legalBallsInCurrentOver`, e.g. `18.5`. There is no `.6` in a total:
  six legal balls make the next over (`19.0`). On a ball-by-ball list, the delivery that
  completes over 19 is labelled `18.6`.
- A wide or no-ball carries the number of the legal ball still to come. In the 2022 match's
  final over, the no-ball, the wide that followed it, and the 3 byes are all labelled `19.4`.
- **CRR** (current run rate) = runs / overs. **RRR** (required run rate) = runs needed / overs left.
- **Powerplay**: overs 1-6 (labels 0.1-5.6). **Death overs**: 16-20 (labels 15.1-19.6).

### Strike rotation (verified against both matches, 470 deliveries, 0 mismatches)

After a non-wicket delivery, the batters swap ends when the **runs actually run** are odd:

```
runsRun = runs.batter + byes + legbyes + max(wides - 1, 0)
```

(The 1-run wide/no-ball penalty is not run. Boundaries are 4 or 6, which are even.) At the end
of an over, they swap again. After a wicket, the next striker is unknown until the next
delivery: since October 2022 a new batter always takes strike after a catch.

---

## 2. Counting rules used by the engine

| Quantity | Definition |
| --- | --- |
| legal ball | delivery with `wides == 0 && noballs == 0` |
| ball faced (batter) | legal ball **or** no-ball (wides are not faced) |
| batter dot | ball faced with `runs.batter == 0` |
| bowler dot | legal ball with `runs.batter == 0` (byes/leg-byes do not spoil it) |
| runs conceded (bowler) | `runs.total - byes - legbyes - penalty` |
| maiden | complete over (6 legal balls) by one bowler with 0 runs conceded |
| team wickets | every dismissal except retired hurt (a retired-hurt batter may return) |
| bowler's wicket | every dismissal except run out, retired hurt/out, obstructing the field, handled the ball, hit the ball twice, timed out |
| catch credit | `caught`: the listed fielder. `caught and bowled`: the bowler |
| run-out credit | one fielder listed: direct hit. Two or more: indirect, credited to the last two listed |
| strike rate | `runs * 100 / ballsFaced`, 2 decimals |
| economy | `runsConceded * 6 / legalBalls`, 2 decimals |

---

## 3. Fantasy (Dream11-style)

A fan picks **11 players from both teams** before the match locks (at the first ball):

- Budget **100 credits**. Each player has a credit price (ours are illustrative, see `data/matches/*/players.json`).
- Roles: **WK** (wicket-keeper) 1-4, **BAT** 3-6, **AR** (all-rounder) 1-4, **BOWL** 3-6.
- At most **7** players from one real team.
- One **Captain** (points x2) and one **Vice-captain** (x1.5).
- Players score points from what they do in the real match. A player who is not in the announced
  **playing XI** scores nothing. That is the Phase 1 problem: picking a player who then sits out.

Points (our illustrative table, `data/rules/t20-fantasy.json`; values are data, not code):

| Action | Points |
| --- | --- |
| In the announced playing XI | +4 |
| Run | +1 |
| Boundary bonus (four) / six bonus | +4 / +6 |
| Milestones 25 / 50 / 75 / 100 runs (highest reached only) | +4 / +8 / +12 / +16 |
| Duck (dismissed for 0; WK, BAT, AR only) | -2 |
| Dot ball (bowler) | +1 |
| Wicket (not run out) / LBW or bowled bonus | +30 / +8 |
| 3 / 4 / 5 wicket haul (highest only) | +4 / +8 / +12 |
| Maiden | +12 |
| Catch / 3-catch bonus (once per match) | +8 / +4 |
| Stumping / run out direct / run out indirect | +12 / +12 / +6 |
| Economy (min 2 overs) | <5: +6, 5-5.99: +4, 6-7: +2, 10-11: -2, 11.01-12: -4, >12: -6 |
| Strike rate (min 10 balls; not BOWL) | >170: +6, 150.01-170: +4, 130-150: +2, 60-70: -2, 50-59.99: -4, <50: -6 |

Rates are rounded to 2 decimals before slab lookup. Values between slabs score 0.

Golden totals (computed by the oracle; the engine must match exactly):

- 1298150: Hardik 168, Kohli 150, Arshdeep 116, Iftikhar 105, Rizwan 32, Babar 16.
- 1415755: Kohli 128, Axar 127, Klaasen 124, Hardik 118, Bumrah 100, Pant 18.

Run `python3 -I scripts/oracle/cricsheet_oracle.py data/raw/cricsheet/<id>.json --players data/matches/<id>/players.json --rules data/rules/t20-fantasy.json` for every player.

---

## 4. The two demo matches (real data, Cricsheet ODC-By 1.0)

### 1298150: Pakistan vs India, T20 World Cup 2022, MCG, 23 Oct 2022 (primary demo)

Story beats with exact labels (innings 1 = Pakistan batting, innings 2 = India chasing 160):

| Phase | Beat | Label | What the data says |
| --- | --- | --- | --- |
| 1. Toss to lock | India win the toss and field. Rishabh Pant, Yuzvendra Chahal, Deepak Hooda, Harshal Patel benched (Karthik keeps). Fakhar Zaman (knee) sits out for Pakistan | pre-match | XI from Cricsheet `info.players`; bench = squad minus XI |
| 2. Early collapse | **Babar Azam lbw b Arshdeep, golden duck** (first ball he faced) | inn 1, 1.1 | 1/1 |
| 2. Early collapse | Rizwan c Bhuvneshwar b Arshdeep 4 (12) | inn 1, 3.6 | 15/2 |
| (recovery) | Shan Masood 52\* (42), Iftikhar 51 (34): three sixes in Axar's only over (6, 0, 6, 6, 0, 3) | inn 1, 11.1-11.6 | 159/8 final |
| 2. Early collapse | KL Rahul b Naseem 4, Rohit c Iftikhar b Rauf 4, Suryakumar 15, Axar run out 2 | inn 2, 1.5 / 3.2 / 5.3 / 6.1 | 31/4 |
| 3. Join late | After 14 overs: **90/4, need 70 off 36** (RRR 11.67) | inn 2, 14.0 | |
| 3. Join late | After 16: 106/4, need 54 off 24. After 18: 129/4, need 31 off 12 | inn 2 | |
| 4. Climax | **Kohli six, six off Haris Rauf** | inn 2, 18.5, 18.6 | 144/4, need 16 off 6 |
| 4. Climax | Final over (Nawaz): Hardik out (19.1), 1, 2, **no-ball six** (19.4), wide on the free hit (19.4), **3 byes off the free hit after Kohli is bowled** (19.4), Karthik stumped (19.5), wide (19.6), **Ashwin's single wins it** (19.6) | inn 2, 19.x | 160/6, India win by 4 wickets |

Scorecard (oracle): Pakistan 159/8 (126 deliveries, extras 12: 6 wd, 2 b, 4 lb). India 160/6
(125 deliveries, extras 11: 6 wd, 1 nb, 3 b, 1 lb). Kohli 82\* (53, 6x4, 4x6). Arshdeep 4-0-32-3.
Hardik 4-0-30-3 and 40 (37). Nawaz 4-0-42-2.

### 1415755: India vs South Africa, T20 World Cup 2024 Final, Bridgetown, 29 Jun 2024 (generalisation match)

| Phase | Beat | Label | Data |
| --- | --- | --- | --- |
| 1 | Yashasvi Jaiswal, Sanju Samson, Chahal, Siraj benched | pre-match | |
| 2 | **Rohit c Klaasen b Maharaj 9**, then **Pant c de Kock b Maharaj 0** in the same over | inn 1, 1.4 / 1.6 | 23/2 |
| (recovery) | Kohli 76 (59), Axar 47 (31, run out by a de Kock direct hit at 13.3) | | 176/7 |
| 3 | After 15 overs of the chase: **147/4, need 30 off 30** | inn 2, 15.0 | |
| 4 | Klaasen c Pant b Hardik 52 (27) | inn 2, 16.1 | 151/5 |
| 4 | After 18: 157/6, need 20 off 12. **Miller c Suryakumar b Hardik** (the boundary catch) | inn 2, 19.1 | India win by 7 runs |

Scorecard (oracle): India 176/7 (127 deliveries). South Africa 169/8 (124 deliveries).
Klaasen 52 (27, 5 sixes). Bumrah 4-0-18-2. Hardik 3-0-20-3.

Nothing in application code may name these players, teams or labels. They are data. Golden
tests may (that is their job). See `docs/Constraints.md` and `scripts/check-no-hardcode.ts`.

---

## 5. Product vocabulary (Dream11, verified 2026-10-16)

The Dream11 app is now "Dream11: Sports Watch Along": creator-hosted live streams, gifts and
shout-outs, a live prediction game called **Hit or Miss**, and a virtual currency, **DreamBucks**,
earned by watching. Sideline's quests pay out simulated DreamBucks and its micro-predictions
mirror Hit or Miss. The name "Rhea" and the quote "no sports fan should ever watch a match alone"
from the research notes could not be verified and are not used in the product.
