"""Builds a scratch data directory with one holdout match added, for whole-session audits.

Usage (from the repo root; the raw file in its own fresh directory, the output outside the repo):
    python3 -I scripts/oracle/audit/holdout_data.py <raw-dir>/<id>.json <scratch-dir>

Copies the repository's data/ (raw files, matches, rules, models, crowd corpus, glossary) to
<scratch-dir>/data and adds the match: the raw file with its sha256 in the manifest; players.json and
context.json from gen_fixtures.py; one invented bench player per team (audit only, so a squad can hold a
pick outside both XIs and the lineup detector fires); two audit personas (a pre-match fan whose captain
and vice-captain are the two innings' first strikers, with one bench pick; a late joiner after 14 overs
of the chase); priors at the demo match's role means with no appearances. The repository itself is never
written. holdout_sessions.ts then drives the server's modules over it (TEST_CHECKLIST §2C).
"""

import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]


def main() -> None:
    raw_path = pathlib.Path(sys.argv[1]).resolve()
    out = pathlib.Path(sys.argv[2]).resolve()
    if ROOT in out.parents or out == ROOT:
        sys.exit("holdout_data: write outside the repository")
    match_id = raw_path.stem
    data = out / "data"
    if data.exists():
        shutil.rmtree(data)
    data.mkdir(parents=True)
    for part in ("raw", "matches", "rules", "models", "crowd"):
        shutil.copytree(ROOT / "data" / part, data / part)
    shutil.copy(ROOT / "data" / "glossary.json", data / "glossary.json")

    shutil.copy(raw_path, data / "raw" / "cricsheet" / f"{match_id}.json")
    raw = json.loads(raw_path.read_text())
    manifest_path = data / "raw" / "cricsheet" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["matches"].append(
        {
            "id": match_id,
            "file": f"{match_id}.json",
            "sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
            "role": manifest["matches"][-1]["role"],
            "description": f"audit holdout: {' v '.join(raw['info']['teams'])}, {raw['info']['dates'][0]}",
        }
    )
    manifest_path.write_text(json.dumps(manifest, indent=2))

    fixtures = out / "fixtures"
    fixtures.mkdir(exist_ok=True)
    subprocess.run(
        [sys.executable, "-I", str(ROOT / "scripts" / "oracle" / "audit" / "gen_fixtures.py"), str(raw_path), str(fixtures)],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    players = json.loads((fixtures / "players.json").read_text())
    context = json.loads((fixtures / "context.json").read_text())
    for index, team in enumerate(t["code"] for t in context["teams"]):
        players["players"].append(
            {
                "id": f"0000aa0{index}",
                "cricsheetName": f"Audit Bench {team}",
                "displayName": f"Audit Bench {team}",
                "shortName": f"Bench {team}",
                "team": team,
                "role": "BAT",
                "credits": 8,
            }
        )
    match_dir = data / "matches" / match_id
    match_dir.mkdir(parents=True, exist_ok=True)
    (match_dir / "players.json").write_text(json.dumps(players, indent=2))
    (match_dir / "context.json").write_text(json.dumps(context, indent=2))

    # A legal squad: the first strikers as captain and vice-captain, the first team's bench pick, then
    # each role filled from both XIs (gen_fixtures gives every player 8 credits).
    by_name = {p["cricsheetName"]: p for p in players["players"]}
    first = [innings["overs"][0]["deliveries"][0]["batter"] for innings in raw["innings"]]
    captain, vice = by_name[first[0]]["id"], by_name[first[1]]["id"]
    squad = [captain, vice, "0000aa00"]
    need = {"WK": 1, "BAT": 4, "AR": 2, "BOWL": 4}
    roles = {"WK": 0, "BAT": 0, "AR": 0, "BOWL": 0}
    teams: dict[str, int] = {}
    for pid in squad:
        p = next(x for x in players["players"] if x["id"] == pid)
        roles[p["role"]] += 1
        teams[p["team"]] = teams.get(p["team"], 0) + 1
    for p in players["players"]:
        if len(squad) == 11:
            break
        if p["id"] in squad or p["id"].startswith("0000aa") or roles[p["role"]] >= need[p["role"]]:
            continue
        if teams.get(p["team"], 0) >= 6:
            continue
        squad.append(p["id"])
        roles[p["role"]] += 1
        teams[p["team"]] = teams.get(p["team"], 0) + 1
    if len(squad) != 11:
        sys.exit(f"holdout_data: could not fill a squad ({roles})")
    personas = {
        "matchId": match_id,
        "personas": [
            {
                "id": "audit-pre",
                "label": "Audit pre-match",
                "blurb": "Audit persona: pre-match, first strikers as captain and vice-captain, one bench pick.",
                "affinity": "neutral",
                "lens": "casual",
                "delayMs": 25000,
                "joinAt": {"kind": "pre_match"},
                "squad": {"playerIds": squad, "captainId": captain, "viceCaptainId": vice},
            },
            {
                "id": "audit-late",
                "label": "Audit late joiner",
                "blurb": "Audit persona: joins after 14 overs of the chase.",
                "affinity": "neutral",
                "lens": "analyst",
                "delayMs": 15000,
                "joinAt": {"kind": "over", "innings": 2, "afterOvers": 14},
                "squad": None,
            },
        ],
    }
    (match_dir / "personas.json").write_text(json.dumps(personas, indent=2))
    demo_priors = json.loads((data / "models" / "priors-1298150.json").read_text())
    role_mean = demo_priors["roleMean"]
    priors = {
        "matchId": match_id,
        "asOf": raw["info"]["dates"][0],
        "source": "audit-only priors: role means, no appearances",
        "k": demo_priors["k"],
        "roleMean": role_mean,
        "players": {
            p["id"]: {"role": p["role"], "appearances": [], "projected": role_mean[p["role"]]}
            for p in players["players"]
        },
    }
    (data / "models" / f"priors-{match_id}.json").write_text(json.dumps(priors, indent=2))
    print(f"holdout_data: {data} (match {match_id}; captain {first[0]}, vice-captain {first[1]})")


if __name__ == "__main__":
    main()
