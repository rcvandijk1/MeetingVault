/** Small, dependency-free, browser-safe hashing helpers (FNV-1a 32-bit, twice for 64 bits of spread). */

export function fnv1a(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashString(input: string): string {
  const a = fnv1a(input).toString(16).padStart(8, '0');
  const b = fnv1a(input, 0x9747b28c).toString(16).padStart(8, '0');
  return a + b;
}

/** Deterministic pseudo-random number in [0, 1) for a key. */
export function hashUnit(key: string): number {
  return fnv1a(key) / 0x100000000;
}
