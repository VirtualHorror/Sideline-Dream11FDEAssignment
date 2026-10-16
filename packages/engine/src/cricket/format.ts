/** Scorecard rate and over formatting helpers shared by reducer and consumers. */

export function oversText(legalBalls: number): string {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
}

export function round2(value: number): number {
  return Math.round((value + 1e-12) * 100) / 100;
}

export function runRate(runs: number, legalBalls: number): number {
  return legalBalls > 0 ? round2((runs * 6) / legalBalls) : 0;
}

export function requiredRate(runsNeeded: number, ballsLeft: number): number | null {
  return ballsLeft > 0 ? round2((Math.max(0, runsNeeded) * 6) / ballsLeft) : null;
}
