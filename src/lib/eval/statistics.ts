export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items], random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export const mean = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b), position = (sorted.length - 1) * q;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
/** Each family receives equal weight. Languages/repeats never become independent clusters. */
export function pairedClusterInterval(pairs: { family: string; a: number; b: number }[], seed = 17, samples = 2000) {
  const clusters = new Map<string, number[]>();
  for (const p of pairs) clusters.set(p.family, [...(clusters.get(p.family) ?? []), p.b - p.a]);
  const deltas = [...clusters.values()].map(xs => mean(xs)!);
  if (deltas.length < 2) return { families: deltas.length, delta: mean(deltas), lower: null, upper: null };
  const random = seededRandom(seed), draws: number[] = [];
  for (let n = 0; n < samples; n++) draws.push(mean(deltas.map(() => deltas[Math.floor(random() * deltas.length)]))!);
  return { families: deltas.length, delta: mean(deltas), lower: quantile(draws, 0.025), upper: quantile(draws, 0.975) };
}
