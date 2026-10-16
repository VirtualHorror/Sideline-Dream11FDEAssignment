#!/usr/bin/env python3
"""
Mutation spot checks for an audit (TEST_CHECKLIST section 2D), run in a SCRATCH COPY of the repo.

Usage: cp -a <repo> <scratch>/repo && rm -f <scratch>/repo/.env
       python3 -I scripts/oracle/audit/mutate.py <scratch>/repo

Each entry swaps one exact snippet of engine source, runs the engine test project, prints KILLED
(some test failed) or SURVIVED, then restores the file with `git checkout`. The snippets match the
source as of `t02-verified`; refresh the table when auditing later code (a snippet that no longer
matches is reported as SKIP). Refuses to run on the repo this file lives in or on a dirty tree,
because restoring uses `git checkout -- <file>`.
"""
import os
import re
import subprocess
import sys

MUTATIONS = [
    # (label, file, exact snippet, replacement)
    ("free hit: no carry-over through a wide", "packages/engine/src/cricket/timeline.ts",
     "freeHitNext = (delivery.extras?.noballs ?? 0) > 0 || (isFreeHit && !actualLegal);",
     "freeHitNext = (delivery.extras?.noballs ?? 0) > 0;"),
    ("maiden: team runs instead of bowler-conceded", "packages/engine/src/cricket/reducer.ts",
     "if (over.runsConceded === 0) {", "if (over.runs === 0) {"),
    ("strike: wide penalty counted as a run", "packages/engine/src/cricket/reducer.ts",
     "Math.max(event.extras.wides - 1, 0);", "event.extras.wides;"),
    ("strike: no swap at over end", "packages/engine/src/cricket/reducer.ts",
     "    if (event.isLegal && event.ballInOver === 6)\n      [strikerId, nonStrikerId] = [nonStrikerId, strikerId];\n",
     ""),
    ("label: extras take the previous ball's number", "packages/engine/src/cricket/timeline.ts",
     "  const ballInOver = legalBallInOver + 1;",
     "  const ballInOver = isLegal ? legalBallInOver + 1 : Math.max(legalBallInOver, 1);"),
    ("timing: second XI 2 s after the first (spec 1 s)", "packages/engine/src/cricket/timeline.ts",
     "timing.tossAtMs + timing.xiAfterTossMs + index * 1000",
     "timing.tossAtMs + timing.xiAfterTossMs + index * 2000"),
    ("timing: no jitter", "packages/engine/src/cricket/timeline.ts",
     "        jitter(parsed.id, timing.jitterMs);", "        0;"),
    ("timing: innings break ignored", "packages/engine/src/cricket/timeline.ts",
     "const secondStartAt = firstInningsEndAt + timing.inningsBreakMs;",
     "const secondStartAt = firstInningsEndAt;"),
    ("innings_end: chase never target_reached", "packages/engine/src/cricket/timeline.ts",
     "    secondTotals.runs >= target.runs\n      ? \"target_reached\"", "    false\n      ? \"target_reached\""),
    ("wickets: bowler credited for run outs", "packages/engine/src/cricket/timeline.ts",
     "creditedToBowler: !NON_BOWLER_WICKETS.has(wicket.kind),", "creditedToBowler: true,"),
    ("partnership: extras excluded", "packages/engine/src/cricket/reducer.ts",
     "innings.partnership.runs += event.runs.total;", "innings.partnership.runs += event.runs.batter;"),
    ("chase: balls remaining off by one", "packages/engine/src/cricket/reducer.ts",
     "Math.max(0, target.balls - innings.legalBalls)", "Math.max(0, target.balls - innings.legalBalls - 1)"),
    ("bowler dot: byes spoil it", "packages/engine/src/cricket/reducer.ts",
     "    if (event.runs.batter === 0) bowler.dots += 1;", "    if (event.runs.total === 0) bowler.dots += 1;"),
    ("fantasy: indirect run out credits one fielder", "packages/engine/src/fantasy/scoring.ts",
     "out.fielderIds.slice(-2)", "out.fielderIds.slice(-1)"),
    ("fantasy: duck for every role", "packages/engine/src/fantasy/scoring.ts",
     "      batting.duckRoles.includes(player.role)\n", "      true\n"),
    ("fantasy: slab lookup on the unrounded rate", "packages/engine/src/fantasy/scoring.ts",
     "  const roundedRate = round2(rate);", "  const roundedRate = rate;"),
    ("fantasy: milestones cumulative", "packages/engine/src/fantasy/scoring.ts",
     "if (rules.points.batting.milestoneMode === \"cumulative\") {", "if (true) {"),
    ("fantasy: captain multiplier ignored", "packages/engine/src/fantasy/scoring.ts",
     "        ? rules.team.captainMultiplier\n", "        ? 1\n"),
]


def main():
    target = os.path.realpath(sys.argv[1])
    here = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    if target == here:
        sys.exit("mutate.py: refusing to mutate the working repo; pass a scratch copy")
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=target, capture_output=True, text=True).stdout
    if dirty.strip():
        sys.exit("mutate.py: scratch copy has uncommitted changes; refusing (restore uses git checkout)")
    env = dict(os.environ, PATH=os.path.expanduser("~/.local/bin") + ":" + os.environ.get("PATH", ""), CI="1")
    killed = survived = 0
    for label, rel, old, new in MUTATIONS:
        path = os.path.join(target, rel)
        src = open(path, encoding="utf-8").read()
        if src.count(old) != 1:
            print(f"SKIP     {label}: snippet found {src.count(old)} times")
            continue
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(src.replace(old, new))
        try:
            run = subprocess.run(["pnpm", "vitest", "run", "--project", "engine"], cwd=target, env=env,
                                 capture_output=True, text=True, timeout=600)
            out = re.sub(r"\x1b\[[0-9;]*m", "", run.stdout + run.stderr)
            summary = re.search(r"Tests\s+([^\n]+)", out)
            failed = sorted(set(re.findall(r"FAIL\s+\|engine\|\s+(test/[^\n]+)", out)))
            if run.returncode != 0:
                killed += 1
                print(f"KILLED   {label}  [{summary.group(1).strip() if summary else '?'}]")
                for name in failed[:3]:
                    print(f"           - {name.strip()[:150]}")
            else:
                survived += 1
                print(f"SURVIVED {label}")
        finally:
            subprocess.run(["git", "checkout", "--", rel], cwd=target, check=True)
    print(f"mutate: {killed} killed, {survived} survived")


if __name__ == "__main__":
    main()
