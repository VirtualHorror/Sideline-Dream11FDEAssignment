#!/usr/bin/env bash
# Auditor's archive sweep (from the Task 2 audit on). See scripts/oracle/audit/README.md.
#
# Usage: scripts/oracle/audit/run_sweep.sh <raw-dir> <work-dir>
#   <raw-dir>   a fresh directory holding extracted Cricsheet match JSON (untrusted data)
#   <work-dir>  scratch output outside the repo: fixtures, reports, dumps, summary.tsv
#
# For every match: synthesize fixtures, run the engine report and the oracle, compare them; then
# dump the engine's timeline/state for every match it accepts and re-derive it with check_spec.py.
set -u
AUDIT=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$AUDIT/../../.." && pwd)
RAW=$(cd "$1" && pwd)
mkdir -p "$2/fx" "$2/res" "$2/dump"
WORK=$(cd "$2" && pwd)
case "$WORK/" in "$REPO"/*) echo "run_sweep: work dir must be outside the repo" >&2; exit 2 ;; esac
RULES="$REPO/data/rules/t20-fantasy.json"
: > "$WORK/summary.tsv"

for raw in "$RAW"/*.json; do
  id=$(basename "$raw" .json)
  [[ $id =~ ^[0-9]+$ ]] || continue
  fx="$WORK/fx/$id"
  if ! python3 -I "$AUDIT/gen_fixtures.py" "$raw" "$fx" 2> "$WORK/res/$id.gen.err"; then
    printf '%s\tFIXTURE_FAIL\t%s\n' "$id" "$(head -c 200 "$WORK/res/$id.gen.err" | tr '\n\t' '  ')" >> "$WORK/summary.tsv"
    continue
  fi
  (cd "$REPO" && node scripts/engine-report.ts "$raw" --players "$fx/players.json" --rules "$RULES" --json) \
    > "$WORK/res/$id.engine.json" 2> "$WORK/res/$id.engine.err"
  engine_exit=$?
  python3 -I "$REPO/scripts/oracle/cricsheet_oracle.py" "$raw" --players "$fx/players.json" --rules "$RULES" --json \
    > "$WORK/res/$id.oracle.json" 2> "$WORK/res/$id.oracle.err"
  oracle_exit=$?
  if [ $engine_exit -ne 0 ]; then
    printf '%s\tENGINE_REJECTS\t%s\n' "$id" "$(head -c 300 "$WORK/res/$id.engine.err" | tr '\n\t' '  ')" >> "$WORK/summary.tsv"
  elif [ $oracle_exit -ne 0 ]; then
    printf '%s\tORACLE_FAIL\t%s\n' "$id" "$(tail -c 200 "$WORK/res/$id.oracle.err" | tr '\n\t' '  ')" >> "$WORK/summary.tsv"
  elif python3 -I "$AUDIT/compare.py" "$raw" "$WORK/res/$id.engine.json" "$WORK/res/$id.oracle.json" > "$WORK/res/$id.diff" 2>&1; then
    printf '%s\tIDENTICAL\t%s\n' "$id" "$(tail -n 1 "$WORK/res/$id.diff")" >> "$WORK/summary.tsv"
  else
    printf '%s\tDIFF\t%s\n' "$id" "$(tail -n 1 "$WORK/res/$id.diff")" >> "$WORK/summary.tsv"
  fi
done

(cd "$REPO" && node "$AUDIT/dump_engine.ts" "$RAW" "$WORK/fx" "$WORK/dump")
python3 -I "$AUDIT/check_spec.py" "$WORK/dump" "$RAW" "$WORK/fx" > "$WORK/check_spec.txt"
spec_exit=$?

echo "== engine report vs oracle (per match) =="
cut -f2 "$WORK/summary.tsv" | sort | uniq -c
echo "   of which carry oracle-only substitute-fielder entries (BUG-001): $(grep -c 'BUG-001' "$WORK/summary.tsv")"
echo "== engine rejections by reason =="
awk -F'\t' '$2=="ENGINE_REJECTS"{print $3}' "$WORK/summary.tsv" | sed -E \
  -e 's/.*missing its Cricsheet target.*/missing innings[1].target (older Cricsheet files)/' \
  -e 's/.*"balls".*/fractional target overs (DLS)/' \
  -e 's/.*"ballInOver".*/over with more than six legal balls/' \
  -e 's/.*"playerIds".*/listed XI is not 11 players/' \
  -e 's/.*more than one bowler.*/bowler changed mid-over/' \
  -e 's/.*"innings".*/not exactly two innings (no result, super over)/' | sort | uniq -c
echo "== independent spec re-derivation (check_spec.py) =="
grep -E "^(FAIL|TOTAL|strike)" "$WORK/check_spec.txt"
grep -c "^ok " "$WORK/check_spec.txt" | sed 's/^/   check categories ok: /'
exit $spec_exit
