/**
 * Logistic regression: the one statistical tool behind win probability (models/winprob.ts).
 *
 * Callers: models/winprob.ts (predictLogistic, at every delivery on server and client) and
 * scripts/build-models.ts (fitLogistic, offline, over the Cricsheet archive). Pure and
 * deterministic: a fit is plain Newton/IRLS from zero weights with a fixed summation order, so
 * the same rows always give bit-identical weights and the committed model files rebuild exactly.
 */

/** 1 / (1 + e^-z), written so that neither branch overflows for large |z|. */
export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function dot(weights: readonly number[], features: readonly number[]): number {
  if (weights.length !== features.length) {
    throw new Error(
      `weights length ${weights.length} differs from features length ${features.length}`,
    );
  }
  let z = 0;
  for (let index = 0; index < weights.length; index += 1) {
    z += (weights[index] ?? 0) * (features[index] ?? 0);
  }
  return z;
}

/** P(y = 1 | features); `features` carries its own bias term (a leading 1) if the model has one. */
export function predictLogistic(weights: readonly number[], features: readonly number[]): number {
  return sigmoid(dot(weights, features));
}

/**
 * Solves H·x = g for a symmetric positive-definite H (Cholesky, H = L·Lᵀ). Only the lower triangle
 * (`h[i][j]` with j ≤ i) is read, which is all fitLogistic fills in. The ridge term keeps the
 * Hessian positive definite; a non-positive pivot means the problem is ill-posed, so throw.
 */
function solveSpd(h: number[][], g: number[]): number[] {
  const n = g.length;
  const lower: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = h[i]?.[j] ?? 0;
      for (let k = 0; k < j; k += 1) sum -= (lower[i]?.[k] ?? 0) * (lower[j]?.[k] ?? 0);
      const row = lower[i] as number[];
      if (i === j) {
        if (!(sum > 0)) throw new Error("fitLogistic: Hessian is not positive definite");
        row[j] = Math.sqrt(sum);
      } else {
        row[j] = sum / (lower[j]?.[j] ?? 1);
      }
    }
  }
  const forward = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let sum = g[i] ?? 0;
    for (let k = 0; k < i; k += 1) sum -= (lower[i]?.[k] ?? 0) * (forward[k] ?? 0);
    forward[i] = sum / (lower[i]?.[i] ?? 1);
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = forward[i] ?? 0;
    for (let k = i + 1; k < n; k += 1) sum -= (lower[k]?.[i] ?? 0) * (x[k] ?? 0);
    x[i] = sum / (lower[i]?.[i] ?? 1);
  }
  return x;
}

/**
 * Ridge-penalised maximum likelihood by Newton's method (IRLS): minimises
 * `-Σ log-likelihood + (l2 / 2)·Σ w²` over every weight, intercept included (the build uses a
 * tiny `l2 = 1e-4·n`, so the intercept's shrinkage is negligible and no feature is special-cased).
 * Stops when the largest weight step is below `tol`; throws if that takes more than `maxIter`
 * steps, so a model that did not converge can never be written.
 */
export function fitLogistic(
  rows: readonly { x: readonly number[]; y: 0 | 1 }[],
  opts: { l2: number; maxIter: number; tol: number },
): number[] {
  const first = rows[0];
  if (!first) throw new Error("fitLogistic: no rows to fit");
  const width = first.x.length;
  for (const row of rows) {
    if (row.x.length !== width) {
      throw new Error(`fitLogistic: row length ${row.x.length} differs from length ${width}`);
    }
  }

  const weights = new Array<number>(width).fill(0);
  for (let iteration = 1; iteration <= opts.maxIter; iteration += 1) {
    const gradient = weights.map((weight) => opts.l2 * weight);
    const hessian = Array.from({ length: width }, (_, i) =>
      Array.from({ length: width }, (_, j) => (i === j ? opts.l2 : 0)),
    );
    for (const row of rows) {
      const p = predictLogistic(weights, row.x);
      const residual = p - row.y;
      const curvature = p * (1 - p);
      for (let i = 0; i < width; i += 1) {
        const xi = row.x[i] ?? 0;
        gradient[i] = (gradient[i] ?? 0) + residual * xi;
        // The Hessian is symmetric and solveSpd reads only its lower triangle, so fill only that.
        const hessianRow = hessian[i] as number[];
        for (let j = 0; j <= i; j += 1) {
          hessianRow[j] = (hessianRow[j] ?? 0) + curvature * xi * (row.x[j] ?? 0);
        }
      }
    }
    const step = solveSpd(hessian, gradient);
    let largestStep = 0;
    for (let i = 0; i < width; i += 1) {
      const delta = step[i] ?? 0;
      weights[i] = (weights[i] ?? 0) - delta;
      largestStep = Math.max(largestStep, Math.abs(delta));
    }
    if (largestStep < opts.tol) return weights;
  }
  throw new Error(`fitLogistic: did not converge in ${opts.maxIter} iterations`);
}
