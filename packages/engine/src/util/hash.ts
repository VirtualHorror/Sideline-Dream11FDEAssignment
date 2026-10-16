/** Stable, dependency-free hashes for deterministic engine behaviour. */

/** FNV-1a over UTF-16 code units, returned as an unsigned 32-bit integer. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
