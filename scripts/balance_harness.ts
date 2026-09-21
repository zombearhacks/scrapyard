// Gate 0 harness — 01 - Product Vision & Scope success criterion #2 ("attributes materially
// affect the fight") made checkable, per 05 - Roadmap & Phases. Reports a table: metric,
// threshold, actual, pass/fail. No entry here is allowed to just say "looks good".

import { brotliCompressSync } from "node:zlib";
import { simulateFight, SIM_BUILD } from "../src/sim/simulate.js";
import { fightMapSchema } from "../src/sim/schema.js";
import { WEAPONS } from "../src/sim/weapons.js";

const N = Number(process.argv[2] ?? 100);
const TARGET_STRIKES = 24;

const matchups: [string, string][] = [];
for (let i = 0; i < WEAPONS.length; i++) {
  for (let j = i + 1; j < WEAPONS.length; j++) {
    matchups.push([WEAPONS[i]!.id, WEAPONS[j]!.id]);
  }
}

const wins: Record<string, number> = Object.fromEntries(WEAPONS.map((w) => [w.id, 0]));
const appearances: Record<string, number> = Object.fromEntries(WEAPONS.map((w) => [w.id, 0]));
const matchupWinsA: Record<string, number> = {};
const matchupTotal: Record<string, number> = {};

const durationsSec: number[] = [];
const cpuMs: number[] = [];
const mapKB: number[] = [];
const brotliKB: number[] = [];
let endReasonCounts = { target_reached: 0, time_limit: 0 };
let schemaFailures = 0;
let hangs = 0;

for (let i = 0; i < N; i++) {
  const [wA, wB] = matchups[i % matchups.length]!;
  const seed = `balance-${i}`;
  const t0 = performance.now();
  let map;
  try {
    map = simulateFight({ seed, weaponIds: [wA, wB], targetStrikes: TARGET_STRIKES });
  } catch {
    hangs++;
    continue;
  }
  cpuMs.push(performance.now() - t0);

  if (!fightMapSchema.safeParse(map).success) schemaFailures++;

  durationsSec.push(map.outcome.duration_ticks / map.tick_rate);
  endReasonCounts[map.outcome.end_reason]++;

  const json = JSON.stringify(map);
  mapKB.push(Buffer.byteLength(json) / 1024);
  brotliKB.push(brotliCompressSync(json).length / 1024);

  appearances[wA]! += 1;
  appearances[wB]! += 1;
  const key = `${wA}:${wB}`;
  matchupTotal[key] = (matchupTotal[key] ?? 0) + 1;
  if (map.outcome.winner_slot === 0) {
    wins[wA]! += 1;
    matchupWinsA[key] = (matchupWinsA[key] ?? 0) + 1;
  } else if (map.outcome.winner_slot === 1) {
    wins[wB]! += 1;
  }
}

// Determinism check (0.2): same seed + same build, 5 runs, byte-identical map.json —
// excluding fight_id/created_at, which are deliberately fresh per generation (03's "same
// seed + same build -> same event map" is about physics, not about wrapper metadata).
const detSeed = "determinism-check";
const detRuns = Array.from({ length: 5 }, () => {
  const { fight_id, created_at, ...rest } = simulateFight({ seed: detSeed, weaponIds: ["axe", "sword"] });
  return JSON.stringify(rest);
});
const deterministic = detRuns.every((r) => r === detRuns[0]);

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function pct(n: number, total: number): string {
  return `${((n / total) * 100).toFixed(0)}%`;
}

const inBand = durationsSec.filter((d) => d >= 45 && d <= 180).length;
const weaponWinRates = WEAPONS.map((w) => ({
  id: w.id,
  rate: appearances[w.id] ? wins[w.id]! / appearances[w.id]! : 0,
}));
const matchupRates = matchups.map(([a, b]) => {
  const key = `${a}:${b}`;
  const total = matchupTotal[key] ?? 0;
  const rateA = total ? (matchupWinsA[key] ?? 0) / total : 0.5;
  return { a, b, rateA, rateBSideWinPct: 1 - rateA };
});
const matchupSkews = matchupRates.map((m) => Math.abs(m.rateA - 0.5) * 2); // 0 = even, 1 = one-sided
const bestBalanced = Math.min(...matchupSkews);
const mostSkewed = Math.max(...matchupSkews);
// "best vs worst matchup win rate spread" — take the two matchups whose winning-side rate differ most.
const winSideRates = matchupRates.map((m) => Math.max(m.rateA, 1 - m.rateA));
const spreadPct = (Math.max(...winSideRates) - Math.min(...winSideRates)) * 100;

const rows: Array<[string, string, string, boolean]> = [
  ["0.1 sim CPU (max, one fight)", "<= 2000 ms", `${Math.max(...cpuMs).toFixed(1)} ms`, Math.max(...cpuMs) <= 2000],
  ["0.2 determinism (5 runs, same seed+build)", "byte-identical", deterministic ? "identical" : "DIVERGED", deterministic],
  ["0.3 termination", `${N}/${N}, 0 hangs`, `${N - hangs}/${N}, ${hangs} hangs`, hangs === 0],
  ["0.4 duration median", "60-120 s", `${median(durationsSec).toFixed(1)} s`, median(durationsSec) >= 60 && median(durationsSec) <= 120],
  ["0.4 duration in 45-180s band", ">= 80%", `${pct(inBand, durationsSec.length)} (${inBand}/${durationsSec.length})`, inBand / durationsSec.length >= 0.8],
  [
    "0.5 balance: every weapon win rate",
    "25-75%",
    weaponWinRates.map((w) => `${w.id}=${(w.rate * 100).toFixed(0)}%`).join(", "),
    weaponWinRates.every((w) => w.rate >= 0.25 && w.rate <= 0.75),
  ],
  ["0.6 balance: best vs worst matchup spread", ">= 20 pts", `${spreadPct.toFixed(1)} pts`, spreadPct >= 20],
  ["0.7 map.json size, brotli'd (avg / max)", "<= 150 KB", `${(brotliKB.reduce((a, b) => a + b, 0) / brotliKB.length).toFixed(1)} / ${Math.max(...brotliKB).toFixed(1)} KB`, Math.max(...brotliKB) <= 150],
];

console.log(`sim_build: ${SIM_BUILD}  |  fights: ${N}  |  matchups: ${matchups.map((m) => m.join("v")).join(", ")}`);
console.log(`schema validation failures: ${schemaFailures}`);
console.log();
const colWidths = [46, 14, 34, 6];
console.log(["metric", "threshold", "actual", "pass"].map((h, i) => h.padEnd(colWidths[i]!)).join(" | "));
console.log(colWidths.map((w) => "-".repeat(w)).join("-|-"));
for (const [metric, threshold, actual, pass] of rows) {
  console.log([metric.padEnd(colWidths[0]!), threshold.padEnd(colWidths[1]!), actual.padEnd(colWidths[2]!), pass ? "PASS" : "FAIL"].join(" | "));
}

console.log();
console.log("Per-matchup win rate (slot A weapon vs slot B weapon):");
for (const m of matchupRates) {
  console.log(`  ${m.a} vs ${m.b}: ${m.a}=${(m.rateA * 100).toFixed(0)}%  ${m.b}=${(m.rateBSideWinPct * 100).toFixed(0)}%`);
}

const failed = rows.some((r) => !r[3]);
process.exit(failed ? 1 : 0);
