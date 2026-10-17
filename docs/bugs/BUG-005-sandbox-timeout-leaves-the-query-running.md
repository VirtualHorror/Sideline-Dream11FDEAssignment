# BUG-005: the SQL sandbox's 2 s stop left the query computing

- **Found:** in the Task 10 final audit, by Claude, during the security review of the SQL sandbox (Review focus 5):
  the CPU of a process after `runSandboxed` had answered "timeout"
- **Severity:** major (anyone can send such SQL through the public inspector route; a few queries a minute can hold
  every core of the one host the site runs on)
- **Status:** fixed in Task 10 (test first; D-078)

## Symptom
`runSandboxed("SELECT count(*) FROM t a, t b, t c, t d", tables)` over a 251-row table answered after 2,007 ms with
`{ status: "timeout", reason: "the query ran past 2 s and was stopped" }`, and the process then kept using the CPU:
1,842, 1,882, 1,829 and 1,741 ms of CPU in the next four two-second windows; `process.exit(0)` did not return, and
the script ended only when `timeout 60` killed it (exit 124). The same SQL reaches the sandbox from anyone through
`POST /api/sessions/:id/inspector` with `{ "sql": … }` (12 a minute per address, a burst of 4), and each
"timed out" query freed its slot (two at a time) while it went on running.

## Expected
Constraint 12, D-074 and `docs/Architecture.md` §7: model or operator SQL runs "killed after 2 s". A stopped query
must stop computing, and a slot must stay taken while its query still runs.

## Reproduction
`apps/server/test/sql.test.ts` › "the SQL sandbox (PLAN 8.4, Review focus 5)" › "leaves nothing computing once a
query is killed": after the timeout, the CPU used by the test process and the processes it started over the next
second must stay under 500 ms. Before the fix: `AssertionError: expected 960 to be less than 500`.

## Investigation log (newest last)
- The sandbox ran each query in a worker thread and called `worker.terminate()` at 2 s. `terminate()` stops a
  thread's JavaScript; `StatementSync.all()` loops over `sqlite3_step` in native code, which never yields to it, so
  the thread ran on until SQLite finished (a four-way cross join of 251 rows is about four billion rows; one more
  table multiplies that by 251). The existing test only checked that the answer came at 2 s.
- `node:sqlite` (Node 24.22) exposes no progress handler or interrupt to stop a statement from outside, and a limit
  on joins in the validator would not hold (a CTE repeats a table without naming it again).

## Fix
`sql/sandbox.ts` forks `sql/worker.ts` as a child process for each query (an empty environment, so no key is inside
it; V8's heap capped at 64 MB as before; structured-clone IPC) and kills it with `SIGKILL` once it has answered or at
2 s; a query settles, and its slot frees, only when its process has exited. A killed process stops whatever it was
doing, native code included. Starting a process costs about 120 ms per query on this host (112-125 ms measured over
five quick queries), small next to a model call.

## Verification
The test above fails on the old sandbox (960 ms) and on a mutant that answers at 2 s without killing the process
(`expected 1940 to be less than 500`), and passes on the fix. By hand, after the fix: the timed-out query answered
at 2,012 ms, no sandbox process was left, the process used 1 ms of CPU in the next two seconds and exited at once.
The sandbox's other tests (refusals, the authorizer, 200 rows, the 2 s answer, two at a time) and `pnpm verify` pass;
production after the redeploy: F10.
