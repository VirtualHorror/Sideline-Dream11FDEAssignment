#!/usr/bin/env python3
"""
Survey a directory of Cricsheet match files for the edge cases that matter to the engine.

Usage: python3 -I scripts/oracle/audit/survey.py <dir-with-match-json> > survey.json

One record per match: id, date, teams, innings count, outcome and sorted flags such as
multi_bowler_over@<innings>:<over>, over_legal=7@..., target_overs=<x>, method=<m>,
players[<team>]=<n>, sub_fielder, kind=<rare dismissal>, penalty@..., nb+byes, multi_wide,
non_boundary, ro_indirect, c&b. Used to choose holdouts and to explain engine rejections.
"""
import json
import os
import sys

COMMON_KINDS = ("bowled", "caught", "lbw", "run out", "stumped", "caught and bowled")


def survey(path):
    raw = json.load(open(path, encoding="utf-8"))
    info = raw["info"]
    flags = []
    reg = info.get("registry", {}).get("people", {})
    for team, names in info.get("players", {}).items():
        if len(names) != 11:
            flags.append(f"players[{team}]={len(names)}")
    if any("super_over" in inn for inn in raw.get("innings", [])):
        flags.append("super_over")
    if info.get("outcome", {}).get("method"):
        flags.append(f"method={info['outcome']['method']}")
    for idx, inn in enumerate(raw.get("innings", []), 1):
        if inn.get("target") and inn["target"].get("overs") != 20:
            flags.append(f"target_overs={inn['target'].get('overs')}")
        if "penalty_runs" in inn:
            flags.append("innings_penalty_runs")
        if "absent_hurt" in inn:
            flags.append("absent_hurt")
        for over in inn.get("overs", []):
            legal = 0
            bowlers = []
            for dl in over["deliveries"]:
                ex = dl.get("extras", {}) or {}
                if ex.get("wides", 0) == 0 and ex.get("noballs", 0) == 0:
                    legal += 1
                if dl["bowler"] not in bowlers:
                    bowlers.append(dl["bowler"])
                if ex.get("penalty"):
                    flags.append(f"penalty@{idx}:{over['over']}")
                if ex.get("noballs") and (ex.get("byes") or ex.get("legbyes")):
                    flags.append("nb+byes")
                if ex.get("wides", 0) > 1:
                    flags.append("multi_wide")
                if dl["runs"].get("non_boundary"):
                    flags.append("non_boundary")
                if "replacements" in dl:
                    flags.append("replacement")
                for name in (dl["batter"], dl["non_striker"], dl["bowler"]):
                    if name not in reg:
                        flags.append(f"unregistered:{name}")
                for w in dl.get("wickets", []) or []:
                    kind = w["kind"]
                    if kind not in COMMON_KINDS:
                        flags.append(f"kind={kind}")
                    if kind == "caught and bowled":
                        flags.append("c&b")
                    for fielder in w.get("fielders", []) or []:
                        if fielder.get("substitute"):
                            flags.append("sub_fielder")
                        if not fielder.get("name"):
                            flags.append("nameless_fielder")
                        elif fielder["name"] not in reg:
                            flags.append(f"unregistered_fielder:{fielder['name']}")
                    named = [x.get("name") for x in (w.get("fielders") or []) if x.get("name")]
                    if kind == "run out" and len(named) >= 2:
                        flags.append("ro_indirect")
                    if kind == "run out" and not named:
                        flags.append("ro_nofielder")
                if len(dl.get("wickets", []) or []) > 1:
                    flags.append("two_wickets_one_ball")
            if len(bowlers) > 1:
                flags.append(f"multi_bowler_over@{idx}:{over['over']}")
            if legal > 6:
                flags.append(f"over_legal={legal}@{idx}:{over['over']}")
            if legal < 6 and over is not inn["overs"][-1]:
                flags.append(f"short_over={legal}@{idx}:{over['over']}")
    return {"id": os.path.basename(path)[:-5], "date": info["dates"][0], "teams": info["teams"],
            "innings": len(raw.get("innings", [])), "outcome": info.get("outcome", {}),
            "flags": sorted(set(flags))}


def main():
    folder = sys.argv[1]
    out = [survey(os.path.join(folder, name)) for name in sorted(os.listdir(folder)) if name.endswith(".json")]
    json.dump(out, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
