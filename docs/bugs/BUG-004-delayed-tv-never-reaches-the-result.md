# BUG-004: a fan whose TV runs behind never sees the last balls or the result

- **Found:** 2026-10-17, Claude, implementing Task 6: watching a `babar-believer` session (25 s
  feed) through the 2022 finish in the real match room, in Chrome, against the keyless dev server
- **Severity:** major (the result never reaches the fans the product is built for: everyone with
  a delay longer than the crowd's last reaction, 22 s in 1298150)
- **Status:** fixed on `task/06-frontend-core` (test first; D-063)

## Symptom
Jumped to after 18 overs of the chase at 16x with the persona's 25 s delay. The fan's TV folded every
ball to 19.6 (160/6, the winning single) and then froze: the scorebug never showed "India won by 4
wickets", the result outburst never fired, and the crowd's last reactions never appeared. The stream
had sent a `clock` message with `playing: false` at stadium time 14,580,270 (the crowd's last line),
so the browser's TV clock stopped at 14,580,270 − 25,000 = 14,555,270, before `match_end` at
14,558,000.

## Expected
D-056 says the clock stops "at the end of the match and its crowd" so the stream can say the match
is over; Flow §9 and D-055/D-056 say everything is released on the fan's own TV clock. A fan's TV is
`delayMs` behind the ground, so the end has happened for them only `delayMs` after it happened at the
ground. Stopping at the ground's end cuts off the last `delayMs` of their match.

## Reproduction
`apps/server/test/sessions.test.ts` › "sessions: the end of the match reaches the fan's TV (BUG-004)"
› "keeps the clock running until the fan's delayed TV has shown the match end": late-from-work with a
30 s delay, jumped to `match_end`; after the crowd's last line the clock must still be playing, and it
stops only once the TV time equals that line's time. It fails on the merged Task 5 code
(`expected false to be true`).

## Investigation log (newest last)
- The browser had every event (the `snapshot` and `events` messages held `match_end`); the TV clock
  simply never got there, because `clock.playing` was false.
- `apps/server/src/sessions/session.ts`: `stadiumNow()` clamped to `endT` (the later of the last event
  and the last crowd line) and `tick()` paused once events and crowd were exhausted. Both ignore the
  session's delay.
- Late-from-work (15 s) still saw the result in 1298150, because the crowd's tail (22 s) is longer than
  its delay, but lost the last 15 s of crowd lines; babar-believer (25 s) and f1-convert (40 s) lost the
  result. The Task 5 tests used late-from-work, so they could not see it.

## Fix
The session's stadium clock runs on past `endT` by the session's `delayMs` (`finalT = endT + delayMs`)
and pauses only when it reaches it, so the fan's TV reaches the end before the stream says the match is
over. Nothing new happens at the ground in that tail; only the TV catches up. Seeks and jumps still clamp
to `endT`. The server is the right layer: the clock is the server's, and the browser must not invent time
past a paused clock.

## Verification
The new test fails on the merged code and passes with the fix. Two existing expectations encoded the old
rule and now add `delayMs`: "stops the clock once the match and its crowd are over" (`stadiumT` is the
ground's end plus the fan's delay) and the step 6.0 test "keeps the clock running after the last event
until the crowd's last reaction". `pnpm vitest run --project server`: 13 files, 167 tests passed. In the
browser the scorebug then shows the result and the result outburst fires (F06 log).
