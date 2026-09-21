// Seeded PRNG only. No Math.random anywhere in the sim — determinism (Gate 0.2) depends on it.

export function hashSeed(seed: string): number {
  // FNV-1a, folded to a uint32.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed) || 1;
  }

  // mulberry32
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(arr: readonly T[]): T {
    const item = arr[Math.floor(this.next() * arr.length)];
    if (item === undefined) throw new Error("Rng.pick on empty array");
    return item;
  }
}
