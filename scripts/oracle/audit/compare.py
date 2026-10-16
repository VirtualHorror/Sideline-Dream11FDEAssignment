#!/usr/bin/env python3
"""
Auditor's comparator: `scripts/engine-report.ts --json` against `cricsheet_oracle.py --json`.

Usage: python3 -I scripts/oracle/audit/compare.py <raw.json> <engine.json> <oracle.json>

Compares innings totals and extras, every batting and bowling line (as id-keyed maps), the fall
of wickets (oracle names mapped to registry ids), fielding and every fantasy entry. Prints each
difference and exits 1 if there is any.

Two things are deliberately not failures:
  * Key order of the batters/bowlers maps. The engine report builds them with Object.fromEntries,
    and JavaScript lists all-digit keys (some Cricsheet ids are all digits) first. The reducer's
    own order of appearance is checked on the state by check_spec.py.
  * Fantasy entries the oracle creates for players outside both playing XIs (substitute
    fielders). DOMAIN.md section 3 says they score nothing; the oracle disagrees. Tracked as
    docs/bugs/BUG-001; reported on the summary line, not counted as differences.

Part of the auditor's toolkit (scripts/oracle/audit/README.md). Implementers never edit it.
"""
import json
import sys


def main():
    raw_path, engine_path, oracle_path = sys.argv[1:4]
    raw = json.load(open(raw_path, encoding="utf-8"))
    eng = json.load(open(engine_path, encoding="utf-8"))
    ora = json.load(open(oracle_path, encoding="utf-8"))
    reg = raw["info"]["registry"]["people"]
    xi = {reg[name] for team in raw["info"]["players"].values() for name in team}
    diffs = []
    bug001 = []

    def d(path, e, o):
        diffs.append(f"{path}: engine={e!r} oracle={o!r}")

    if len(eng["innings"]) != len(ora["innings"]):
        d("innings.length", len(eng["innings"]), len(ora["innings"]))
    for ei, oi in zip(eng["innings"], ora["innings"]):
        p = f"inn{oi['innings']}"
        for k in ("innings", "team"):
            if ei[k] != oi[k]:
                d(f"{p}.{k}", ei[k], oi[k])
        if ei["totals"] != oi["totals"]:
            d(f"{p}.totals", ei["totals"], oi["totals"])
        for section in ("batters", "bowlers"):
            for pid in sorted(set(ei[section]) | set(oi[section])):
                el, ol = ei[section].get(pid), oi[section].get(pid)
                if el is None or ol is None:
                    d(f"{p}.{section}.{pid}", el, ol)
                    continue
                for field in sorted(set(el) | set(ol)):
                    if el.get(field) != ol.get(field):
                        d(f"{p}.{section}.{pid}.{field}", el.get(field), ol.get(field))
        ofow = [
            {"wicket": f["wicket"], "runs": f["runs"], "label": f["label"],
             "player_id": reg.get(f["player"], f["player"]), "kind": f["kind"],
             "bowler_id": reg.get(f["bowler"], f["bowler"])}
            for f in oi["fall_of_wickets"]
        ]
        if ei["fall_of_wickets"] != ofow:
            d(f"{p}.fall_of_wickets", ei["fall_of_wickets"], ofow)
        if ei["fielding"] != oi["fielding"]:
            d(f"{p}.fielding", ei["fielding"], oi["fielding"])

    ef, of = eng.get("fantasy", {}), ora.get("fantasy", {})
    for pid in sorted(set(ef) | set(of)):
        if pid not in ef and pid in of and pid not in xi:
            bug001.append(pid)
            continue
        if pid not in ef or pid not in of:
            d(f"fantasy.{pid}", ef.get(pid), of.get(pid))
            continue
        if ef[pid]["total"] != of[pid]["total"]:
            d(f"fantasy.{pid}.total", ef[pid]["total"], of[pid]["total"])
        if ef[pid]["breakdown"] != of[pid]["breakdown"]:
            d(f"fantasy.{pid}.breakdown", ef[pid]["breakdown"], of[pid]["breakdown"])

    for line in diffs:
        print(line)
    n_bat = sum(len(i["batters"]) for i in ora["innings"])
    n_bowl = sum(len(i["bowlers"]) for i in ora["innings"])
    n_fow = sum(len(i["fall_of_wickets"]) for i in ora["innings"])
    status = "DIFF" if diffs else "IDENTICAL"
    note = f"; {len(bug001)} oracle-only non-XI fantasy entries (BUG-001)" if bug001 else ""
    print(f"{status}: {len(diffs)} differences; compared {len(ora['innings'])} innings, {n_bat} batter "
          f"lines, {n_bowl} bowler lines, {n_fow} wickets, {len(of) - len(bug001)} fantasy players{note}")
    sys.exit(1 if diffs else 0)


if __name__ == "__main__":
    main()
