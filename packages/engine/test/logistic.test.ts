import { describe, expect, it } from "vitest";
import { fitLogistic, predictLogistic, sigmoid } from "../src/index.ts";

// mulberry32: a tiny seeded PRNG, so the synthetic dataset is identical on every run.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const TRUE_WEIGHTS = [-1, 2, -3];

/** n rows of [1, x1, x2] with x ~ U(-1, 1) and y ~ Bernoulli(sigmoid(TRUE_WEIGHTS · x)). */
function syntheticRows(n: number, seed: number): { x: number[]; y: 0 | 1 }[] {
  const random = seededRandom(seed);
  return Array.from({ length: n }, () => {
    const x = [1, random() * 2 - 1, random() * 2 - 1];
    const z = TRUE_WEIGHTS.reduce((sum, weight, index) => sum + weight * (x[index] ?? 0), 0);
    return { x, y: random() < 1 / (1 + Math.exp(-z)) ? 1 : 0 };
  });
}

describe("logistic regression", () => {
  it("computes the logistic function and a weighted prediction", () => {
    expect(sigmoid(0)).toBe(0.5);
    // 1 / (1 + e^1.5), worked by hand: e^1.5 = 4.4816890703380645
    expect(predictLogistic([0.5, -1], [1, 2])).toBeCloseTo(0.18242552380635635, 15);
    expect(sigmoid(-800)).toBe(0);
    expect(sigmoid(800)).toBe(1);
    expect(() => predictLogistic([1, 2], [1])).toThrow(/length/);
  });

  it("recovers the generating weights from a seeded synthetic dataset", () => {
    const rows = syntheticRows(20_000, 20_261_016);
    const weights = fitLogistic(rows, { l2: 1e-4 * rows.length, maxIter: 50, tol: 1e-8 });
    expect(weights).toHaveLength(3);
    weights.forEach((weight, index) => {
      expect(Math.abs(weight - (TRUE_WEIGHTS[index] ?? Number.NaN))).toBeLessThan(0.15);
    });
    for (const row of rows) {
      const p = predictLogistic(weights, row.x);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it("is deterministic and shrinks weights as the ridge penalty grows", () => {
    const rows = syntheticRows(2_000, 7);
    const opts = { l2: 0.2, maxIter: 50, tol: 1e-8 };
    expect(fitLogistic(rows, opts)).toEqual(fitLogistic(rows, opts));
    const loose = fitLogistic(rows, opts);
    const tight = fitLogistic(rows, { ...opts, l2: 2_000 });
    const norm = (weights: number[]) => Math.hypot(...weights);
    expect(norm(tight)).toBeLessThan(norm(loose) / 2);
  });

  it("fails loudly instead of returning an unconverged or ill-posed fit", () => {
    const rows = syntheticRows(500, 11);
    expect(() => fitLogistic(rows, { l2: 1e-2, maxIter: 1, tol: 1e-12 })).toThrow(/converge/);
    expect(() => fitLogistic([], { l2: 1, maxIter: 50, tol: 1e-8 })).toThrow(/no rows/);
    expect(() =>
      fitLogistic(
        [
          { x: [1, 2], y: 1 },
          { x: [1], y: 0 },
        ],
        { l2: 1, maxIter: 50, tol: 1e-8 },
      ),
    ).toThrow(/length/);
  });
});
