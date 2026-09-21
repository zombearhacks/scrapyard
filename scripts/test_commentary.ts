import { simulateFight } from "../src/sim/simulate.js";
import { deriveDigest } from "../src/commentary/digest.js";
import { generateCommentary } from "../src/commentary/commentary.js";

const seed = process.argv[2] ?? "demo-d";
const w0 = process.argv[3] ?? "axe";
const w1 = process.argv[4] ?? "spear";

const map = simulateFight({ seed, weaponIds: [w0, w1] });
const digest = deriveDigest(map);

const t0 = performance.now();
const { doc, source } = await generateCommentary(digest);
const ms = performance.now() - t0;

console.log(`matchup: ${map.fighters[0].display_name} vs ${map.fighters[1].display_name}`);
console.log(`result: ${digest.final.winner} wins ${digest.final.score.join("-")}  (${digest.headline})`);
console.log(`source: ${source}  |  generation time: ${ms.toFixed(0)}ms  |  ${doc.lines.length}/${digest.beats.length} beats got a line`);
console.log();
for (const line of doc.lines) {
  console.log(`[${(line.anchor_tick / map.tick_rate).toFixed(1)}s, beat_ref=${JSON.stringify(line.beat_ref)}] ${line.text}`);
}
