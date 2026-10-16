# BUG-003: two of PLAN 3.4's 1298150 climax balls stay below the leverage threshold

- **Found:** 2026-10-16, Claude (implementing Task 3 in place of Codex), on the first committed
  build: `packages/engine/test/leverage.test.ts` › "flags the 1298150 climax"
- **Severity:** major for Task 3 acceptance (step 3.4 cannot pass as written); minor for the
  product (the climax still gets five big balls, and the winning moment is flagged one delivery
  earlier, on the 19.6 wide)
- **Status:** open. PLAN 3.4 and HANDOFF4 forbid tuning weights, features or the percentile to
  pass, so the decision is the architect's and the owner's. The failing test stays as written
  (Constraint 4).

## Symptom
With PLAN Task 3's features, fit rules and default weights, the build sets `nudgeThreshold` to
0.18437 (the nearest-rank 95th percentile of the leverage of all 134,049 legal deliveries in the
test split; 5.00% of them are at or above it). In 1298150, innings 2:

| Ball | Before → after | P(India) before → after | Leverage | ≥ 0.18437 |
| --- | --- | --- | --- | --- |
| 18.5 six off Rauf | 28 off 8 → 22 off 7, 6 wickets in hand | 0.0176 → 0.0573 | 0.0932 | **no** |
| 18.6 six off Rauf | 22 off 7 → 16 off 6 | 0.0573 → 0.2342 | 0.4100 | yes |
| 19.1 Hardik caught | 16 off 6 → 16 off 5, 5 wickets | 0.2342 → 0.0533 | 0.3779 | yes |
| 19.4 no-ball, six | 13 off 3 → 6 off 3, free hit next | 0.0048 → 0.7679 | 1.0000 | yes |
| 19.4 wide on the free hit (not listed) | 6 off 3 → 5 off 3 | 0.7679 → 0.9003 | 0.2728 | yes |
| 19.5 Karthik stumped | 2 off 2 → 2 off 1, 4 wickets | 0.9912 → 0.8598 | 0.3048 | yes |
| 19.6 wide (not listed) | 2 off 1 → 1 off 1 | 0.8598 → 0.9903 | 0.2611 | yes |
| 19.6 winning single | 1 off 1 → won | 0.9903 → 1.0000 | 0.0193 | **no** |

Everything else in step 3.4 holds: 1415755's 16.1 (0.2676) and 19.1 (0.1878) pass, and the
share of big balls is 22 of 251 deliveries (8.76%) in 1298150 and 24 of 251 (9.56%) in 1415755.

## Expected
PLAN Task 3 step 3.4: 18.5, 18.6, 19.1, the 19.4 no-ball, 19.5 and the final 19.6 are all at or
above the threshold.

## Reproduction
`node scripts/build-models.ts --zip <t20s_male_json.zip, sha256 95305bc2…860a>` (or the committed
`data/models/winprob-v1.json`), then `pnpm vitest run --project engine leverage`.

## Investigation log (newest last)
- 2026-10-16: re-derived the chase probabilities in Python from the committed weights and the
  PLAN feature formulas: identical to 4 decimals, so the numbers are not an engine artifact.
- 2026-10-16: empirical win rates of the archive's filter-passing chases (demo matches excluded),
  by state after a legal ball: need 1 off 1, 26 of 27 won (0.96); 2 off 1, 24 of 28 (0.86);
  2 off 2, 28 of 31 (0.90); 16 off 6, 6 of 29 (0.21); 22 off 7, 2 of 26 (0.08); 28 off 8, 1 of 26
  (0.04). The model agrees with the data where the data is dense.
- 2026-10-16: **the final 19.6.** The model rates "need 1 off 1, 4 wickets in hand" at 0.99, and the
  training data agrees (26 of 27). The cause is the PLAN filters: a tie that goes to a super over
  has more than two innings, so the filters drop almost every tied match, and a chase needing one
  off the last ball is left with almost only wins. So the 19.6 wide (2 off 1 → 1 off 1) carries the
  swing (0.86 → 0.99, leverage 0.26), and the winning single moves P by 0.0097. Closeness after a
  decided ball is 0, so its leverage is 2 × 0.0097 = 0.019.
- 2026-10-16: **18.5.** Structural. A six that takes a chase from about 2% to about 6% (4% → 8%
  in the raw data) gives 2·|ΔP| ≈ 0.08 plus spectacle × closeness ≈ 0.12 × 0.11 = 0.014. Even with
  the empirical rates it would score about 0.10, half the threshold. Its weight in the story comes
  from the six that followed, which a per-ball measure cannot see.
- 2026-10-16: ruled out the choices the plan left open. The ridge also shrinks the intercept, but
  with `l2 = 1e-4·n` that moves the mean residual by 5e-4. Nearest-rank vs interpolated 95th
  percentile differs by less than 1e-4 on 134,049 values. Neither can lift 0.093 or 0.019 to 0.184.

## Options (for the architect and owner; none applied)
1. Amend the 3.4 list to what a win-probability leverage can see: drop 18.5 and the final 19.6,
   and name the 19.6 wide (or the free-hit wide) instead. Smallest change; the model stays honest.
2. A "decisive ball" rule: a delivery that ends the match scores 1. Fixes the final 19.6 only.
3. Train on super-over ties instead of excluding them (labelled as ties). Removes the "1 off 1 is
   99%" bias; the wide would probably still carry most of that swing. Changes the filters.
4. Re-weight leverage (a bigger six weight, say). That is per-ball tuning unless the plan itself
   changes it, which is why it is listed last.

## Fix
None yet: waiting for the decision.

## Verification
`leverage.test.ts` › "flags the 1298150 climax" fails today on 18.5 and the final 19.6, with the
values above.
