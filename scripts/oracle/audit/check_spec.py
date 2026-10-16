#!/usr/bin/env python3
"""
Independent re-derivation of the Task 2 timeline rules (docs/PLAN.md) and reducer rules
(docs/DOMAIN.md) from raw Cricsheet files, checked against what the engine produced.

Usage: python3 -I scripts/oracle/audit/check_spec.py <dump-dir> <raw-dir> <fixtures-dir>

Reads every <id>.dump.json written by dump_engine.ts and recomputes, without engine code: event
order, ids and every timestamp (DEFAULT_TIMING + FNV-1a jitter of the event id), each delivery's
fields (label, legality, free hit, boundary, wickets, ids), innings_start/innings_end/match_end
(targets, reasons, result text, player of the match), and after every delivery the live situation
(strike rotation formula, rates, chase numbers, free hit next), innings totals and partnership;
at the end the batting/bowling order of appearance, every over summary and maiden, the result,
and the fold spot check. Prints one line per check category; exits 1 on any mismatch.

Also reports a data property, not a pass/fail check: how often DOMAIN.md section 1's strike
rotation rule predicts the next delivery's batter (it is a rule, the data has rare exceptions).

Part of the auditor's toolkit (scripts/oracle/audit/README.md). Implementers never edit it.
"""
import collections
import json
import os
import sys

NON_BOWLER = {"run out", "retired hurt", "retired out", "obstructing the field",
              "handled the ball", "hit the ball twice", "timed out"}
T = dict(noteSpacingMs=60_000, tossAtMs=600_000, xiAfterTossMs=60_000, firstBallAtMs=1_800_000,
         deliveryGapMs=34_000, extraGapMs=22_000, boundaryExtraMs=18_000, wicketExtraMs=50_000,
         overEndExtraMs=55_000, inningsEndAfterMs=30_000, inningsBreakMs=900_000,
         firstBallAfterInningsStartMs=60_000, matchEndAfterMs=15_000, jitterMs=3_000)

checks = collections.Counter()
fails = collections.defaultdict(list)
strike = collections.Counter()
strike_examples = []


def fnv1a32(text):
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def jitter(event_id):
    sec = T["jitterMs"] // 1000
    return ((fnv1a32(event_id) % (2 * sec + 1)) - sec) * 1000


def r2(x):
    return round(x + 1e-12, 2)


def check(cat, ok, detail):
    checks[cat] += 1
    if not ok:
        fails[cat].append(json.loads(json.dumps(detail)))


def main():
    dump_dir, raw_dir, fx_dir = sys.argv[1:4]
    for fname in sorted(os.listdir(dump_dir)):
        if not fname.endswith(".dump.json"):
            continue
        dump = json.load(open(os.path.join(dump_dir, fname), encoding="utf-8"))
        mid = dump["id"]
        raw = json.load(open(os.path.join(raw_dir, mid + ".json"), encoding="utf-8"))
        players = json.load(open(os.path.join(fx_dir, mid, "players.json"), encoding="utf-8"))
        context = json.load(open(os.path.join(fx_dir, mid, "context.json"), encoding="utf-8"))
        verify_match(mid, raw, players, context, dump)
    total_fail = 0
    for cat in sorted(checks):
        n_fail = len(fails[cat])
        total_fail += n_fail
        print(f"{'FAIL' if n_fail else 'ok  '} {cat:<34} checks={checks[cat]:>7} mismatches={n_fail}")
        for example in fails[cat][:6]:
            print(f"        e.g. {example}")
    print(f"strike rotation rule vs next delivery's batter (data property, non-wicket balls): {dict(strike)}")
    for example in strike_examples[:12]:
        print(f"        {example}")
    print(f"TOTAL mismatches: {total_fail}")
    sys.exit(1 if total_fail else 0)


def verify_match(mid, raw, players, context, dump):
    ev = dump["events"]
    info = raw["info"]
    reg = info["registry"]["people"]
    code = {t["cricsheetName"]: t["code"] for t in context["teams"]}
    name_of = {t["cricsheetName"]: t["name"] for t in context["teams"]}

    def pid(name):
        return reg[name]

    for i, e in enumerate(ev):
        check("ids.seq_and_id", e["seq"] == i and e["id"] == f"{mid}:{i:04d}", (mid, i, e["id"]))
        if i:
            check("time.non_decreasing", e["t"] >= ev[i - 1]["t"], (mid, i))

    cursor = 0

    def take(kind):
        nonlocal cursor
        e = ev[cursor]
        check(f"order.{kind}", e["kind"] == kind, (mid, cursor, e["kind"], kind))
        cursor += 1
        return e

    e = take("coverage_start")
    check("time.coverage_start", e["t"] == 0, (mid, e["t"]))
    e = take("squads")
    expected = [{"team": t["code"], "playerIds": [p["id"] for p in players["players"] if p["team"] == t["code"]]}
                for t in context["teams"]]
    check("pre.squads", e["t"] == 0 and e["squads"] == expected, (mid,))
    for n_i, note in enumerate(context["notes"]):
        e = take("note")
        check("pre.note", e["t"] == (n_i + 1) * T["noteSpacingMs"] and e["noteId"] == note["id"]
              and e["title"] == note["title"] and e["text"] == note["text"]
              and e["category"] == note["category"] and e["sources"] == note["sources"], (mid, n_i))
    e = take("toss")
    check("pre.toss", e["t"] == T["tossAtMs"] and e["winner"] == code[info["toss"]["winner"]]
          and e["decision"] == info["toss"]["decision"], (mid, e))
    for t_i, team in enumerate(info["teams"]):
        e = take("playing_xi")
        check("pre.playing_xi", e["t"] == T["tossAtMs"] + T["xiAfterTossMs"] + 1000 * t_i
              and e["team"] == code[team] and e["playerIds"] == [pid(n) for n in info["players"][team]],
              (mid, t_i, e["t"]))

    inn_raw = raw["innings"]
    target = inn_raw[1]["target"]
    tgt = {"runs": target["runs"], "balls": int(target["overs"] * 6)}
    snaps = {s["seq"]: s for s in dump["snaps"]}
    end_t = None
    flat = []
    for idx in (0, 1):
        inn_no = idx + 1
        e = take("innings_start")
        exp_t = T["firstBallAtMs"] - T["firstBallAfterInningsStartMs"] if idx == 0 else end_t + T["inningsBreakMs"]
        bat = code[inn_raw[idx]["team"]]
        bowl = [t["code"] for t in context["teams"] if t["code"] != bat][0]
        check("structure.innings_start", e["t"] == exp_t and e["innings"] == inn_no and e["battingTeam"] == bat
              and e["bowlingTeam"] == bowl and e["target"] == (None if idx == 0 else tgt),
              (mid, inn_no, e["t"], exp_t))
        t_next = T["firstBallAtMs"] if idx == 0 else e["t"] + T["firstBallAfterInningsStartMs"]
        free_next = False
        runs = wkts = legal_tot = 0
        partner = None
        last_t = None
        legal_in_over = {}
        for o in inn_raw[idx]["overs"]:
            for di, d in enumerate(o["deliveries"]):
                over_no = o["over"]
                e = take("delivery")
                ex = d.get("extras", {}) or {}
                exs = {k: ex.get(k, 0) for k in ("wides", "noballs", "byes", "legbyes", "penalty")}
                legal = exs["wides"] == 0 and exs["noballs"] == 0
                before = legal_in_over.get(over_no, 0)
                ball = before + 1
                if legal:
                    legal_in_over[over_no] = before + 1
                completes = legal and legal_in_over[over_no] == 6
                rb = d["runs"]["batter"]
                boundary = 0 if d["runs"].get("non_boundary", False) else (rb if rb in (4, 6) else 0)
                wk = [{"kind": w["kind"], "playerOut": pid(w["player_out"]),
                       "fielders": [pid(f["name"]) for f in (w.get("fielders") or []) if f.get("name")],
                       "creditedToBowler": w["kind"] not in NON_BOWLER} for w in (d.get("wickets") or [])]
                is_fh = free_next
                exp = {"innings": inn_no, "over": over_no, "ballInOver": ball, "deliveryInOver": di + 1,
                       "label": f"{over_no}.{ball}", "batter": pid(d["batter"]),
                       "nonStriker": pid(d["non_striker"]), "bowler": pid(d["bowler"]),
                       "runs": {"batter": rb, "extras": d["runs"]["extras"], "total": d["runs"]["total"]},
                       "extras": exs, "isLegal": legal, "isFreeHit": is_fh, "boundary": boundary, "wickets": wk}
                for k in exp:
                    check(f"delivery.{k}", e[k] == exp[k], (mid, e["id"], k, e[k], exp[k]))
                check("delivery.no_extra_keys", set(e) == set(exp) | {"id", "seq", "t", "kind"},
                      (mid, e["id"], sorted(set(e) - set(exp))))
                check("time.delivery_t", e["t"] == t_next, (mid, e["id"], e["t"], t_next))
                last_t = e["t"]
                gap = ((T["deliveryGapMs"] if legal else T["extraGapMs"]) + (T["boundaryExtraMs"] if boundary else 0)
                       + (T["wicketExtraMs"] if wk else 0) + (T["overEndExtraMs"] if completes else 0)
                       + jitter(e["id"]))
                t_next = e["t"] + gap
                free_next = exs["noballs"] > 0 or (is_fh and not legal)

                # reducer state after this delivery
                runs += d["runs"]["total"]
                legal_tot += 1 if legal else 0
                wkts += sum(1 for w in wk if w["kind"] != "retired hurt")
                s = snaps[e["seq"]]
                live = s["live"]
                if wk:
                    st, ns = None, None
                else:
                    st, ns = exp["batter"], exp["nonStriker"]
                    if (rb + exs["byes"] + exs["legbyes"] + max(exs["wides"] - 1, 0)) % 2 == 1:
                        st, ns = ns, st
                    if legal and ball == 6:
                        st, ns = ns, st
                check("live.striker_formula", live["strikerId"] == st and live["nonStrikerId"] == ns,
                      (mid, e["id"], live["strikerId"], st))
                check("live.label_bowler_innings", live["label"] == exp["label"] and live["bowlerId"] == exp["bowler"]
                      and live["innings"] == inn_no, (mid, e["id"]))
                check("live.currentRunRate", live["currentRunRate"] == (r2(runs * 6 / legal_tot) if legal_tot else 0),
                      (mid, e["id"], live["currentRunRate"]))
                if idx == 1:
                    rr = max(0, tgt["runs"] - runs)
                    bl = max(0, tgt["balls"] - legal_tot)
                    rrr = r2(rr * 6 / bl) if bl > 0 else None
                    check("live.chase", live["runsRequired"] == rr and live["ballsRemaining"] == bl
                          and live["requiredRunRate"] == rrr,
                          (mid, e["id"], live["runsRequired"], rr, live["ballsRemaining"], bl,
                           live["requiredRunRate"], rrr))
                else:
                    check("live.first_innings", live["runsRequired"] is None and live["requiredRunRate"] is None
                          and live["ballsRemaining"] == 0, (mid, e["id"]))
                check("live.freeHitNext", live["freeHitNext"] == free_next, (mid, e["id"]))
                check("state.innings_totals", s["runs"] == runs and s["wickets"] == wkts
                      and s["legalBalls"] == legal_tot, (mid, e["id"], s["runs"], runs, s["wickets"], wkts))
                if wk:
                    partner = None
                else:
                    if partner is None:
                        partner = {"batterIds": [exp["batter"], exp["nonStriker"]], "runs": 0, "legalBalls": 0}
                    partner["runs"] += d["runs"]["total"]
                    partner["legalBalls"] += 1 if legal else 0
                check("state.partnership", s["partnership"] == partner, (mid, e["id"], s["partnership"], partner))
                flat.append((inn_no, exp, wk, st))
        e = take("innings_end")
        if idx == 0:
            reason = "all_out" if wkts >= 10 else "overs_complete"
        else:
            reason = "target_reached" if runs >= tgt["runs"] else ("all_out" if wkts >= 10 else "overs_complete")
        check("structure.innings_end", e["t"] == last_t + T["inningsEndAfterMs"] and e["runs"] == runs
              and e["wickets"] == wkts and e["legalBalls"] == legal_tot and e["reason"] == reason,
              (mid, inn_no, e["t"], last_t, e["reason"], reason))
        end_t = e["t"]

    e = take("match_end")
    out = info.get("outcome", {})
    if out.get("winner"):
        by = out.get("by", {})
        if "runs" in by:
            margin = f"{by['runs']} {'run' if by['runs'] == 1 else 'runs'}"
        elif "wickets" in by:
            margin = f"{by['wickets']} {'wicket' if by['wickets'] == 1 else 'wickets'}"
        else:
            margin = None  # spec gap: the auditor expects "<team> won" (see F02 follow-ups)
        text = f"{name_of[out['winner']]} won by {margin}" if margin else f"{name_of[out['winner']]} won"
        winner = code[out["winner"]]
    else:
        text = "Match tied" if out.get("result") == "tie" else "No result"
        winner = None
    if out.get("method"):
        text += " (DLS method)"
    pom = [pid(n) for n in info.get("player_of_match", [])]
    check("structure.match_end_time", e["t"] == end_t + T["matchEndAfterMs"], (mid, e["t"]))
    check("structure.match_end_winner_pom", e["winner"] == winner and e["playerOfMatch"] == pom, (mid,))
    check("structure.match_end_text", e["resultText"] == text, (mid, e["resultText"], text))
    check("order.nothing_after_match_end", cursor == len(ev), (mid, cursor, len(ev)))

    for j, (inn_no, exp, wk, st) in enumerate(flat):
        nxt = flat[j + 1] if j + 1 < len(flat) else None
        if wk or not nxt or nxt[0] != inn_no:
            continue
        hit = st == nxt[1]["batter"]
        strike["match" if hit else "mismatch"] += 1
        if not hit and len(strike_examples) < 12:
            strike_examples.append((mid, f"inn{inn_no}", exp["label"], exp["runs"], exp["extras"]))

    final = dump["final"]
    check("final.phase_result", final["phase"] == "complete"
          and final["result"] == {"winner": winner, "text": text, "playerOfMatch": pom}, (mid, final["phase"]))
    check("final.fold_property", dump["foldMismatch"] == [], (mid, dump["foldMismatch"]))
    for idx, inn in enumerate(final["innings"]):
        bat_order, bowl_order = [], []
        for o in inn_raw[idx]["overs"]:
            for d in o["deliveries"]:
                for n in (d["batter"], d["non_striker"]):
                    if pid(n) not in bat_order:
                        bat_order.append(pid(n))
                if pid(d["bowler"]) not in bowl_order:
                    bowl_order.append(pid(d["bowler"]))
                for w in d.get("wickets") or []:
                    if pid(w["player_out"]) not in bat_order:
                        bat_order.append(pid(w["player_out"]))
        check("final.batter_order", [b["playerId"] for b in inn["batters"]] == bat_order, (mid, idx + 1))
        check("final.bowler_order", [b["playerId"] for b in inn["bowlers"]] == bowl_order, (mid, idx + 1))
        check("final.status", inn["status"] == "complete", (mid, idx + 1))
        exp_overs = []
        for o in inn_raw[idx]["overs"]:
            dl = o["deliveries"]

            def ext(d, k):
                return (d.get("extras") or {}).get(k, 0)

            conceded = sum(d["runs"]["total"] - ext(d, "byes") - ext(d, "legbyes") - ext(d, "penalty") for d in dl)
            legal_n = sum(1 for d in dl if not ext(d, "wides") and not ext(d, "noballs"))
            exp_overs.append({"over": o["over"], "bowlerId": pid(dl[0]["bowler"]),
                              "runs": sum(d["runs"]["total"] for d in dl), "runsConceded": conceded,
                              "wickets": sum(1 for d in dl for w in (d.get("wickets") or []) if w["kind"] != "retired hurt"),
                              "nBalls": len(dl), "complete": legal_n == 6, "isMaiden": legal_n == 6 and conceded == 0})
        got_overs = [{"over": o["over"], "bowlerId": o["bowlerId"], "runs": o["runs"],
                      "runsConceded": o["runsConceded"], "wickets": o["wickets"], "nBalls": len(o["balls"]),
                      "complete": o["complete"], "isMaiden": o["isMaiden"]} for o in inn["overs"]]
        check("final.overs_and_maidens", got_overs == exp_overs,
              (mid, idx + 1, [(g, x) for g, x in zip(got_overs, exp_overs) if g != x][:2]))
        maidens = collections.Counter(x["bowlerId"] for x in exp_overs if x["isMaiden"])
        check("final.bowler_maidens", all(b["maidens"] == maidens.get(b["playerId"], 0) for b in inn["bowlers"]),
              (mid, idx + 1))


if __name__ == "__main__":
    main()
