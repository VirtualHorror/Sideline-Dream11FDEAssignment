/**
 * Seeded randomness for the engine (Constraint 6: no `Math.random()`).
 *
 * Callers: crowd/simulate.ts (which lines the synthetic crowd says, when and as whom) and, from
 * Task 5, anything else that must look random but replay identically for the same seed (a
 * session's crowd is seeded from its id). Not for anything secret.
 */
import { fnv1a32 } from "./hash.ts";

/**
 * mulberry32: a small, fast 32-bit generator with good statistical quality for simulation. Returns
 * a function that yields floats in [0, 1); the same seed always yields the same sequence.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A 32-bit seed from any text (a session id, "seed|event id"), via FNV-1a. */
export function seedFrom(text: string): number {
  return fnv1a32(text);
}
