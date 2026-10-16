#!/usr/bin/env python3
"""
Generate throwaway holdout fixtures (players.json + context.json) for one Cricsheet match.

Usage: python3 -I scripts/oracle/audit/gen_fixtures.py <raw.json> <out-dir>

Writes <out-dir>/players.json and <out-dir>/context.json in the shapes of the engine's
PlayersFileSchema and MatchContextFileSchema. Roles cycle WK, BAT x4, AR x2, BOWL x4 down each
listed XI so the role-dependent rules (duck roles, strike-rate exemption) are exercised; credits
are a flat 8; team codes are initials (multi-word names) or the first three letters. Output goes
to a scratch directory, never data/ (fixtures there feed the anti-hardcoding deny-list).
"""
import json
import os
import sys

ROLES = ["WK", "BAT", "BAT", "BAT", "BAT", "AR", "AR", "BOWL", "BOWL", "BOWL", "BOWL"]


def code_for(name):
    words = [w for w in name.replace("-", " ").split() if w.isalpha()]
    if len(words) > 1:
        code = "".join(w[0] for w in words)[:4].upper()
    else:
        code = "".join(ch for ch in name if ch.isalpha())[:3].upper()
    return code if len(code) >= 2 else (code + "X")


def main():
    raw_path, out_dir = sys.argv[1], sys.argv[2]
    raw = json.load(open(raw_path, encoding="utf-8"))
    mid = os.path.basename(raw_path)[:-5]
    info = raw["info"]
    reg = info["registry"]["people"]
    teams = info["teams"]
    codes = [code_for(t) for t in teams]
    if codes[0] == codes[1]:
        codes = [codes[0][:3] + "A", codes[1][:3] + "B"]
    players = []
    for team, code in zip(teams, codes):
        for i, name in enumerate(info["players"][team]):
            players.append({
                "id": reg[name], "cricsheetName": name, "displayName": name, "shortName": name,
                "team": code, "role": ROLES[i] if i < len(ROLES) else "BOWL", "credits": 8,
            })
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "players.json"), "w", encoding="utf-8") as fh:
        json.dump({"matchId": mid, "creditsNote": "audit holdout fixture", "players": players}, fh, indent=1)
    with open(os.path.join(out_dir, "context.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "matchId": mid, "title": f"{teams[0]} vs {teams[1]}", "competition": "audit holdout",
            "stage": "audit holdout",
            "teams": [{"code": c, "name": t, "cricsheetName": t, "color": "#123456", "colorAlt": "#654321"}
                      for t, c in zip(teams, codes)],
            "notes": [],
        }, fh, indent=1)


if __name__ == "__main__":
    main()
