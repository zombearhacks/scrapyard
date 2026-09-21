// Gate 0.9 — commentary fidelity, per 05 - Roadmap & Phases:
// across 5 fights, 0 lines citing an event that didn't occur, and >=3 lines per fight
// referencing a detail unique to that fight (not generic filler).

import { simulateFight } from "../src/sim/simulate.js";
import { deriveDigest } from "../src/commentary/digest.js";
import { generateCommentary } from "../src/commentary/commentary.js";

const FIGHTS: Array<[string, string, string]> = [
  ["gate09-1", "axe", "sword"],
  ["gate09-2", "sword", "mace"],
  ["gate09-3", "mace", "spear"],
  ["gate09-4", "spear", "axe"],
  ["gate09-5", "axe", "mace"],
];

let totalLines = 0;
let hallucinatedLines = 0;
let llmSourced = 0;
const uniqueRefCounts: number[] = [];

for (const [seed, w0, w1] of FIGHTS) {
  const map = simulateFight({ seed, weaponIds: [w0, w1] });
  const realEventIds = new Set(map.events.map((e) => e.id));
  const digest = deriveDigest(map);
  const { doc, source } = await generateCommentary(digest);
  if (source === "llm") llmSourced++;

  let uniqueRefs = 0;
  for (const line of doc.lines) {
    totalLines++;
    const citesReal = line.beat_ref.length > 0 && line.beat_ref.every((id) => realEventIds.has(id));
    if (!citesReal) hallucinatedLines++;
    if (/\d/.test(line.text)) uniqueRefs++; // proxy for "cites a fight-specific detail" (speed/score/streak/time)
  }
  uniqueRefCounts.push(uniqueRefs);
  console.log(`${seed} (${w0} vs ${w1}): source=${source}, lines=${doc.lines.length}, unique_refs=${uniqueRefs}`);
}

console.log();
console.log("--- Gate 0.9 ---");
console.log(`total lines: ${totalLines}`);
console.log(`hallucinated (bad beat_ref): ${hallucinatedLines}  -> threshold 0  -> ${hallucinatedLines === 0 ? "PASS" : "FAIL"}`);
console.log(`fights with >=3 unique-detail lines: ${uniqueRefCounts.filter((n) => n >= 3).length}/${FIGHTS.length}  -> ${uniqueRefCounts.every((n) => n >= 3) ? "PASS" : "FAIL"}`);
console.log(`LLM-sourced (not fallback): ${llmSourced}/${FIGHTS.length}`);
