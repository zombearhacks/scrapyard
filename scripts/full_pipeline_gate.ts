// Gates 0.8 (audio size) and 0.10 (end-to-end wall clock, sim -> uploadable package),
// per 05 - Roadmap & Phases. Also writes full packages for the 3 fights Gate 0.11 needs
// (Mike listens and says yes/no on the voice).

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simulateFight } from "../src/sim/simulate.js";
import { fightMapSchema } from "../src/sim/schema.js";
import { deriveDigest } from "../src/commentary/digest.js";
import { generateCommentary } from "../src/commentary/commentary.js";
import { buildAudioPackage } from "../src/tts/tts.js";

const FIGHTS: Array<[string, string, string]> = [
  ["gate-full-1", "axe", "spear"],
  ["gate-full-2", "sword", "mace"],
  ["gate-full-3", "spear", "mace"],
];

const rows: Array<{ seed: string; simMs: number; digestMs: number; commentaryMs: number; ttsMs: number; totalMs: number; audioKB: number; packageKB: number }> = [];

for (const [seed, w0, w1] of FIGHTS) {
  const t0 = performance.now();

  const tSim0 = performance.now();
  const map = simulateFight({ seed, weaponIds: [w0, w1] });
  fightMapSchema.parse(map);
  const simMs = performance.now() - tSim0;

  const tDigest0 = performance.now();
  const digest = deriveDigest(map);
  const digestMs = performance.now() - tDigest0;

  const tCommentary0 = performance.now();
  const { doc, source } = await generateCommentary(digest);
  const commentaryMs = performance.now() - tCommentary0;

  const outDir = join("out", `pkg-${seed}`);
  mkdirSync(outDir, { recursive: true });
  const mapPath = join(outDir, "map.json");
  writeFileSync(mapPath, JSON.stringify(map));

  const tTts0 = performance.now();
  const pkg = await buildAudioPackage(doc.lines, map.tick_rate, outDir);
  const ttsMs = performance.now() - tTts0;

  const totalMs = performance.now() - t0;

  const audioKB = statSync(pkg.audioPath).size / 1024;
  const packageKB = (statSync(mapPath).size + statSync(pkg.audioPath).size + statSync(pkg.captionsPath).size) / 1024;

  rows.push({ seed, simMs, digestMs, commentaryMs, ttsMs, totalMs, audioKB, packageKB });
  console.log(`${seed} (${w0} vs ${w1}): source=${source}, total=${(totalMs / 1000).toFixed(1)}s, audio=${audioKB.toFixed(0)}KB -> ${outDir}/`);
}

console.log();
console.log("--- Per-stage breakdown (ms) ---");
for (const r of rows) {
  console.log(`${r.seed}: sim=${r.simMs.toFixed(0)} digest=${r.digestMs.toFixed(0)} commentary=${r.commentaryMs.toFixed(0)} tts+encode=${r.ttsMs.toFixed(0)} total=${r.totalMs.toFixed(0)}`);
}

console.log();
console.log("--- Gate 0.8 (audio size) ---");
const maxAudioKB = Math.max(...rows.map((r) => r.audioKB));
const maxPackageKB = Math.max(...rows.map((r) => r.packageKB));
console.log(`audio max: ${maxAudioKB.toFixed(0)} KB, threshold <= 1200 KB -> ${maxAudioKB <= 1200 ? "PASS" : "FAIL"}`);
console.log(`package max: ${maxPackageKB.toFixed(0)} KB, threshold <= 1500 KB -> ${maxPackageKB <= 1500 ? "PASS" : "FAIL"}`);

console.log();
console.log("--- Gate 0.10 (end-to-end wall clock) ---");
const maxTotalS = Math.max(...rows.map((r) => r.totalMs)) / 1000;
console.log(`max total: ${maxTotalS.toFixed(1)}s, threshold <= 150s -> ${maxTotalS <= 150 ? "PASS" : "FAIL"}`);
