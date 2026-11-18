// Deterministic, seedable PRNG. The same seed string always yields the same stream
// on every platform: cyrb128 string hash -> sfc32 generator (32-bit integer math only).

export type Rng = () => number;

export function hashString(input: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Short stable fingerprint, e.g. for detecting a changed candidate set. */
export function fingerprint(parts: readonly string[]): string {
  return hashString(parts.join('\u0000')).map(value => value.toString(36)).join('');
}

export function createRng(seed: string): Rng {
  let [a, b, c, d] = hashString(seed);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ (b >>> 9);
    b = c + (c << 3) | 0;
    c = (c << 21) | (c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
  // Discard the warm-up outputs so similar seeds diverge immediately.
  for (let index = 0; index < 12; index++) next();
  return next;
}

/** Independent stream for one step/attempt of one seed. */
export function stepRng(seed: string, step: number, attempt = 0): Rng {
  return createRng(`${seed}\u0000${step}\u0000${attempt}`);
}

export function randomInt(rng: Rng, exclusiveMax: number): number {
  if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax <= 0) throw new RangeError('exclusiveMax must be a positive integer');
  return Math.min(exclusiveMax - 1, Math.floor(rng() * exclusiveMax));
}

/** Fisher–Yates on a copy. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = randomInt(rng, index + 1);
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}
