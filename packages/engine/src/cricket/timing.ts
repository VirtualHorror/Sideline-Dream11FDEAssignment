/** Deterministic stadium-clock spacing used by timeline builders. */
export interface TimingModel {
  noteSpacingMs: number;
  tossAtMs: number;
  xiAfterTossMs: number;
  firstBallAtMs: number;
  deliveryGapMs: number;
  extraGapMs: number;
  boundaryExtraMs: number;
  wicketExtraMs: number;
  overEndExtraMs: number;
  inningsEndAfterMs: number;
  inningsBreakMs: number;
  firstBallAfterInningsStartMs: number;
  matchEndAfterMs: number;
  jitterMs: number;
}

export const DEFAULT_TIMING: TimingModel = {
  noteSpacingMs: 60_000,
  tossAtMs: 600_000,
  xiAfterTossMs: 60_000,
  firstBallAtMs: 1_800_000,
  deliveryGapMs: 34_000,
  extraGapMs: 22_000,
  boundaryExtraMs: 18_000,
  wicketExtraMs: 50_000,
  overEndExtraMs: 55_000,
  inningsEndAfterMs: 30_000,
  inningsBreakMs: 900_000,
  firstBallAfterInningsStartMs: 60_000,
  matchEndAfterMs: 15_000,
  jitterMs: 3_000,
};
