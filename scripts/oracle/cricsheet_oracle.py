#!/usr/bin/env python3
"""
Independent reference implementation ("oracle") used to AUDIT the TypeScript engine.

Usage:
  python3 -I scripts/oracle/cricsheet_oracle.py <cricsheet.json> \
      [--players data/matches/<id>/players.json] [--rules data/rules/t20-fantasy.json] [--json]

Computes, straight from a raw Cricsheet file: innings totals and extras, batting and bowling
cards, fall of wickets, and per-player Dream11-style fantasy points (when --players/--rules
are given). It is written in a different language, from the rules text, without looking at
the engine's code, so an engine bug or a hardcoded shortcut shows up as a diff against it.

Definitions (mirrored in docs/DOMAIN.md, which is the source of truth for both sides):
  legal ball      : no wides and no no-balls on the delivery
  ball faced      : legal ball or no-ball (wides are not faced)
  batter dot      : ball faced with 0 runs off the bat
  bowler dot      : legal ball with 0 runs off the bat (byes/leg-byes do not spoil it)
  runs conceded   : total runs minus byes, leg-byes and penalty runs
  maiden          : a complete 6-legal-ball over by one bowler with 0 runs conceded
  boundary        : batter runs of 4 or 6 unless Cricsheet marks runs.non_boundary
  bowler wicket   : every dismissal except run out, retired hurt/out, obstructing the field,
                    handled the ball, hit the ball twice, timed out
  catch credit    : "caught" -> listed fielder; "caught and bowled" -> the bowler
  run-out credit  : one fielder listed -> direct hit; two or more -> indirect, last two listed

THIS FILE IS AN AUDIT TOOL. Implementers (Codex) must never edit it. See docs/Constraints.md.
Python stdlib only.
"""
import argparse
import json
import sys
from collections import OrderedDict

NOT_BOWLER_WICKETS = {
    "run out", "retired hurt", "retired out", "obstructing the field",
    "handled the ball", "hit the ball twice", "timed out",
}


def r2(x):
    return round(x + 1e-12, 2)


def analyse(raw):
    registry = raw["info"]["registry"]["people"]
    pid = lambda name: registry.get(name, name)  # noqa: E731
    innings_out = []
    for idx, inn in enumerate(raw["innings"], start=1):
        tot = {"runs": 0, "wickets": 0, "legal_balls": 0, "deliveries": 0,
               "extras": {"wides": 0, "noballs": 0, "byes": 0, "legbyes": 0, "penalty": 0}}
        batters = OrderedDict()
        bowlers = OrderedDict()
        fow = []
        fielding = {}
        for over in inn["overs"]:
            over_no = over["over"]
            over_legal = 0
            over_conceded = 0
            over_bowlers = set()
            for d in over["deliveries"]:
                tot["deliveries"] += 1
                ex = d.get("extras", {}) or {}
                wides, noballs = ex.get("wides", 0), ex.get("noballs", 0)
                byes, legbyes, penalty = ex.get("byes", 0), ex.get("legbyes", 0), ex.get("penalty", 0)
                for k, v in (("wides", wides), ("noballs", noballs), ("byes", byes),
                             ("legbyes", legbyes), ("penalty", penalty)):
                    tot["extras"][k] += v
                legal = wides == 0 and noballs == 0
                rb = d["runs"]["batter"]
                total = d["runs"]["total"]
                tot["runs"] += total
                if legal:
                    tot["legal_balls"] += 1
                    over_legal += 1
                b = batters.setdefault(pid(d["batter"]), {"name": d["batter"], "runs": 0, "balls": 0,
                                                          "fours": 0, "sixes": 0, "dots": 0, "out": None})
                batters.setdefault(pid(d["non_striker"]), {"name": d["non_striker"], "runs": 0, "balls": 0,
                                                           "fours": 0, "sixes": 0, "dots": 0, "out": None})
                if wides == 0:  # faced
                    b["balls"] += 1
                    if rb == 0:
                        b["dots"] += 1
                b["runs"] += rb
                non_boundary = d["runs"].get("non_boundary", False)
                if rb == 4 and not non_boundary:
                    b["fours"] += 1
                if rb == 6 and not non_boundary:
                    b["sixes"] += 1
                bw = bowlers.setdefault(pid(d["bowler"]), {"name": d["bowler"], "legal_balls": 0, "conceded": 0,
                                                           "wickets": 0, "lbw_bowled": 0, "maidens": 0, "dots": 0,
                                                           "wides": 0, "noballs": 0})
                conceded = total - byes - legbyes - penalty
                bw["conceded"] += conceded
                over_conceded += conceded
                over_bowlers.add(pid(d["bowler"]))
                bw["wides"] += wides
                bw["noballs"] += noballs
                if legal:
                    bw["legal_balls"] += 1
                    if rb == 0:
                        bw["dots"] += 1
                for w in d.get("wickets", []) or []:
                    kind = w["kind"]
                    out_id = pid(w["player_out"])
                    if kind not in ("retired hurt",):
                        tot["wickets"] += 1
                    batters.setdefault(out_id, {"name": w["player_out"], "runs": 0, "balls": 0,
                                                "fours": 0, "sixes": 0, "dots": 0, "out": None})
                    batters[out_id]["out"] = kind
                    label_ball = over_legal if legal else over_legal + 1
                    fow.append({"wicket": tot["wickets"], "runs": tot["runs"], "label": f"{over_no}.{label_ball}",
                                "player": w["player_out"], "kind": kind, "bowler": d["bowler"]})
                    if kind not in NOT_BOWLER_WICKETS:
                        bw["wickets"] += 1
                        if kind in ("lbw", "bowled"):
                            bw["lbw_bowled"] += 1
                    names = [f.get("name") for f in (w.get("fielders") or []) if f.get("name")]
                    if kind == "caught" and names:
                        fielding.setdefault(pid(names[0]), {"catches": 0, "stumpings": 0, "ro_direct": 0, "ro_indirect": 0})["catches"] += 1
                    elif kind == "caught and bowled":
                        fielding.setdefault(pid(d["bowler"]), {"catches": 0, "stumpings": 0, "ro_direct": 0, "ro_indirect": 0})["catches"] += 1
                    elif kind == "stumped" and names:
                        fielding.setdefault(pid(names[0]), {"catches": 0, "stumpings": 0, "ro_direct": 0, "ro_indirect": 0})["stumpings"] += 1
                    elif kind == "run out" and names:
                        if len(names) == 1:
                            fielding.setdefault(pid(names[0]), {"catches": 0, "stumpings": 0, "ro_direct": 0, "ro_indirect": 0})["ro_direct"] += 1
                        else:
                            for n in names[-2:]:
                                fielding.setdefault(pid(n), {"catches": 0, "stumpings": 0, "ro_direct": 0, "ro_indirect": 0})["ro_indirect"] += 1
            if over_legal == 6 and over_conceded == 0 and len(over_bowlers) == 1:
                bowlers[next(iter(over_bowlers))]["maidens"] += 1
        for b in batters.values():
            b["strike_rate"] = r2(b["runs"] * 100 / b["balls"]) if b["balls"] else 0
        for bw in bowlers.values():
            bw["overs"] = f"{bw['legal_balls'] // 6}.{bw['legal_balls'] % 6}"
            bw["economy"] = r2(bw["conceded"] * 6 / bw["legal_balls"]) if bw["legal_balls"] else 0
        innings_out.append({"innings": idx, "team": inn["team"], "totals": tot, "batters": batters,
                            "bowlers": bowlers, "fall_of_wickets": fow, "fielding": fielding})
    return innings_out


def slab_points(rate, slabs):
    rate = r2(rate)
    for s in slabs:
        lo, hi = s["min"], s["max"]
        if (lo is None or rate >= lo) and (hi is None or rate <= hi):
            return s["points"]
    return 0


def fantasy(raw, innings, players, rules):
    pts = rules["points"]
    role = {p["id"]: p["role"] for p in players["players"]}
    registry = raw["info"]["registry"]["people"]
    xi = {registry[n] for team in raw["info"]["players"].values() for n in team}
    score = {pid: {"total": pts["playingXI"], "breakdown": {"playingXI": pts["playingXI"]}} for pid in xi}

    def add(pid, key, value):
        if value == 0:
            return
        entry = score.setdefault(pid, {"total": 0, "breakdown": {}})
        entry["total"] += value
        entry["breakdown"][key] = entry["breakdown"].get(key, 0) + value

    bat, bowl, field = pts["batting"], pts["bowling"], pts["fielding"]
    for inn in innings:
        for pid, b in inn["batters"].items():
            add(pid, "runs", b["runs"] * bat["run"])
            add(pid, "boundaryBonus", b["fours"] * bat["boundaryBonus"])
            add(pid, "sixBonus", b["sixes"] * bat["sixBonus"])
            reached = [m for m in bat["milestones"] if b["runs"] >= m["runs"]]
            if reached:
                if bat["milestoneMode"] == "highest":
                    add(pid, "milestone", max(reached, key=lambda m: m["runs"])["bonus"])
                else:
                    add(pid, "milestone", sum(m["bonus"] for m in reached))
            if b["out"] and b["out"] != "retired hurt" and b["runs"] == 0 and role.get(pid) in bat["duckRoles"]:
                add(pid, "duck", bat["duck"])
            sr = pts["strikeRate"]
            if b["balls"] >= sr["minBalls"] and role.get(pid) not in sr["exemptRoles"]:
                add(pid, "strikeRate", slab_points(b["runs"] * 100 / b["balls"], sr["slabs"]))
        for pid, bw in inn["bowlers"].items():
            add(pid, "dotBall", bw["dots"] * bowl["dotBall"])
            add(pid, "wicket", bw["wickets"] * bowl["wicket"])
            add(pid, "lbwBowledBonus", bw["lbw_bowled"] * bowl["lbwBowledBonus"])
            hauls = [h for h in bowl["hauls"] if bw["wickets"] >= h["wickets"]]
            if hauls:
                if bowl["haulMode"] == "highest":
                    add(pid, "haul", max(hauls, key=lambda h: h["wickets"])["bonus"])
                else:
                    add(pid, "haul", sum(h["bonus"] for h in hauls))
            add(pid, "maiden", bw["maidens"] * bowl["maiden"])
            eco = pts["economy"]
            if bw["legal_balls"] >= eco["minBalls"]:
                add(pid, "economy", slab_points(bw["conceded"] * 6 / bw["legal_balls"], eco["slabs"]))
        for pid, f in inn["fielding"].items():
            add(pid, "catch", f["catches"] * field["catch"])
            add(pid, "stumping", f["stumpings"] * field["stumping"])
            add(pid, "runOutDirect", f["ro_direct"] * field["runOutDirect"])
            add(pid, "runOutIndirect", f["ro_indirect"] * field["runOutIndirect"])
    # three-catch bonus is per match, not per innings
    catches = {}
    for inn in innings:
        for pid, f in inn["fielding"].items():
            catches[pid] = catches.get(pid, 0) + f["catches"]
    for pid, n in catches.items():
        if n >= 3:
            add(pid, "threeCatchBonus", field["threeCatchBonus"])
    return score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("--players")
    ap.add_argument("--rules")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    raw = json.load(open(args.raw, encoding="utf-8"))
    innings = analyse(raw)
    result = {"innings": innings}
    names = {}
    if args.players and args.rules:
        players = json.load(open(args.players, encoding="utf-8"))
        rules = json.load(open(args.rules, encoding="utf-8"))
        names = {p["id"]: p["shortName"] for p in players["players"]}
        result["fantasy"] = fantasy(raw, innings, players, rules)
    if args.json:
        json.dump(result, sys.stdout, indent=1, default=list)
        print()
        return
    for inn in innings:
        t = inn["totals"]
        legal = t["legal_balls"]
        print(f"== Innings {inn['innings']} {inn['team']}: {t['runs']}/{t['wickets']} "
              f"({legal // 6}.{legal % 6} ov, {t['deliveries']} deliveries) extras={t['extras']}")
        for b in inn["batters"].values():
            if b["balls"] == 0 and not b["out"]:
                continue
            print(f"   BAT {b['name']:<22} {b['runs']:>3} ({b['balls']:>2})  4s={b['fours']} 6s={b['sixes']} "
                  f"dots={b['dots']} SR={b['strike_rate']} out={b['out']}")
        for bw in inn["bowlers"].values():
            print(f"   BOWL {bw['name']:<21} {bw['overs']:>4}-{bw['maidens']}-{bw['conceded']:>2}-{bw['wickets']} "
                  f"econ={bw['economy']} dots={bw['dots']} wd={bw['wides']} nb={bw['noballs']}")
        print("   FOW " + ", ".join(f"{f['runs']}-{f['wicket']} ({f['player']}, {f['label']})" for f in inn["fall_of_wickets"]))
    if "fantasy" in result:
        print("== Fantasy points (rules: %s)" % args.rules)
        for pid, s in sorted(result["fantasy"].items(), key=lambda kv: -kv[1]["total"]):
            print(f"   {names.get(pid, pid):<14} {s['total']:>6}  {s['breakdown']}")


if __name__ == "__main__":
    main()
