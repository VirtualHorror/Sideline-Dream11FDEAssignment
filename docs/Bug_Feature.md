# Bug / Feature Record

## F02 Cricket Core

- **Status:** implemented on `task/02-cricket-core`, ready for audit.
- **Feature record:** [F02-cricket-core](features/F02-cricket-core.md).
- **Delivered:** Cricsheet event timeline, reducer, fantasy scoring, and oracle-compatible report CLI.
- **Reference status:** no open Task 2 engine/oracle discrepancy. Both committed matches and the
  temporary holdout match `1273712` matched the Python oracle for scorecards, fielding, fall of
  wickets, and fantasy output.

## Bugs

No product or scoring bug was recorded for Task 2. The fixture-helper parse error and the first live
scoring test's incorrect event selection were corrected during implementation and are logged in F02.
