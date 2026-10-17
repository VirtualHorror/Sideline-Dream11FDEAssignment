# Auditor's toolkit

Tools the auditor (Claude) uses to check implementer work against raw Cricsheet data,
independently of the engine's own tests. Like the oracle beside them they are read-only for
implementers (Constraint 5) and are not part of the product. Python tools are stdlib-only and run
with `python3 -I`; `dump_engine.ts` runs on Node 24 from the repo root.

| Tool | What it does |
| --- | --- |
| `run_sweep.sh <raw-dir> <work-dir>` | Whole-archive sweep: synthesize fixtures, engine report vs oracle for every match, engine dump, `check_spec.py`; prints the summary below |
| `gen_fixtures.py <raw.json> <out-dir>` | Throwaway `players.json` + `context.json` for any match (roles cycle WK, BAT×4, AR×2, BOWL×4 down each XI; credits 8) |
| `compare.py <raw.json> <engine.json> <oracle.json>` | Field-by-field diff of `scripts/engine-report.ts --json` against the oracle's `--json` |
| `dump_engine.ts <raw-dir> <fixtures-dir> <out-dir> [ids…]` | Runs the engine; writes events plus a state snapshot after every delivery |
| `check_spec.py <dump-dir> <raw-dir> <fixtures-dir>` | Re-derives the PLAN Task 2 timeline rules and DOMAIN.md reducer rules from the raw file and checks every event and snapshot |
| `survey.py <dir>` | Flags edge cases per match (mid-over bowler change, seven-ball over, DLS, substitutes, …) |
| `mutate.py <scratch-copy>` | Mutation spot checks (TEST_CHECKLIST §2D); refuses the working repo or a dirty tree |
| `holdout_data.py <raw.json> <scratch-dir>` | A copy of `data/` with one holdout match added: fixtures, a bench pick per team, a pre-match audit persona (the first strikers as captain and vice-captain) and a late joiner, priors at the role means (Tasks 8-9) |
| `holdout_sessions.ts <scratch-dir>/data <id>` | Whole sessions over that match through the server's modules, scripted and keyless, every moment checked by independent rules; the inspector's counts; the story plan's beats. Prints `AUDIT OK` (exit 0) or the problems |

## Archive sweep (TEST_CHECKLIST §2B-C)

```bash
W=$(mktemp -d)                                   # scratch, outside the repo
curl -fsSL -o "$W/a.zip" https://cricsheet.org/downloads/icc_mens_t20_world_cup_male_json.zip
mkdir "$W/raw" && unzip -q "$W/a.zip" -d "$W/raw"   # downloaded data: its own fresh directory
scripts/oracle/audit/run_sweep.sh "$W/raw" "$W/work"
```

Baseline after `t02-verified` and the BUG-001 oracle fix (230 matches, zip sha256
`df5e2fa71d973929a138c5a64c3d1f92406034df54a3558775b5c93898caa742`, retrieved 2026-10-16):

```text
== engine report vs oracle (per match) ==
     31 ENGINE_REJECTS
    199 IDENTICAL
== engine rejections by reason ==
      8 bowler changed mid-over
      4 fractional target overs (DLS)
      1 listed XI is not 11 players
     13 missing innings[1].target (older Cricsheet files)
      4 not exactly two innings (no result, super over)
      1 over with more than six legal balls
== independent spec re-derivation (check_spec.py) ==
strike rotation rule vs next delivery's batter (data property, non-wicket balls): {'match': 42922, 'mismatch': 11}
TOTAL mismatches: 0
   check categories ok: 51
```

The rejections are documented limits (`docs/bugs/BUG-002`). In the audit itself, 22 of the 199 also
showed oracle-only points for substitute fielders: that was the oracle's bug (`docs/bugs/BUG-001`),
since fixed. A newer archive can change the counts. Any `DIFF` line or `check_spec.py` mismatch is a
finding. The strike-rotation line is a property of the data, not a check: DOMAIN's rule predicts
the next batter on all but 11 of 42,933 balls. Compare oracle output as data, never bytes: its
`fantasy` key order follows Python set order, which changes between runs.

Committed matches (expected `TOTAL mismatches: 0`):

```bash
node scripts/oracle/audit/dump_engine.ts data/raw/cricsheet data/matches "$W/dump"
python3 -I scripts/oracle/audit/check_spec.py "$W/dump" data/raw/cricsheet data/matches
```

## Mutation spot checks (TEST_CHECKLIST §2D)

```bash
cp -a . "$W/repo" && rm -f "$W/repo/.env"        # never copy the real key around
python3 -I scripts/oracle/audit/mutate.py "$W/repo"
```

Baseline at `t02-verified`: `12 killed, 6 survived`. The survivors (second-XI offset, jitter,
innings break, chase innings-end reason, duck role exemption, rounding before slab lookup) are test
gaps closed by PLAN Task 3 step 3.0. The snippet table matches the `t02-verified` source; refresh
it when auditing later code (a stale snippet prints `SKIP`).

## Session-level holdout (TEST_CHECKLIST §2C, from the Tasks 8-9 audit)

```bash
W=$(mktemp -d)                                    # scratch, outside the repo
curl -fsSL -o "$W/a.zip" https://cricsheet.org/downloads/icc_mens_t20_world_cup_male_json.zip
mkdir "$W/raw" && python3 -I -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extract(sys.argv[2], sys.argv[3])" "$W/a.zip" 1512773.json "$W/raw"
python3 -I scripts/oracle/audit/holdout_data.py "$W/raw/1512773.json" "$W"
node scripts/oracle/audit/holdout_sessions.ts "$W/data" 1512773
```

Baseline (2026-10-18, `t09-verified`, the 2026 final India v New Zealand): `AUDIT OK`; scripted, the pre-match persona
gets 1 lineup patch, 2 teasers and 12 room reads, no bailout (Samson made 89 and Seifert 52 in the raw file: neither
cheap); the inspector counts 249 deliveries and 414 runs (the raw file's); the story's beats are lineup, catch-up,
the climax and room read at 2:18.6 (the match-deciding ball), result. Pick another match the implementer never saw
for the next audit.
