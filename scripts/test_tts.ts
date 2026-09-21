import { mkdirSync } from "node:fs";
import { simulateFight } from "../src/sim/simulate.js";
import { deriveDigest } from "../src/commentary/digest.js";
import { generateCommentary } from "../src/commentary/commentary.js";
import { buildAudioPackage, readCaptions } from "../src/tts/tts.js";

const seed = process.argv[2] ?? "demo-d";
const w0 = process.argv[3] ?? "axe";
const w1 = process.argv[4] ?? "spear";

const map = simulateFight({ seed, weaponIds: [w0, w1] });
const digest = deriveDigest(map);
const { doc, source } = await generateCommentary(digest);
console.log(`commentary source: ${source}, ${doc.lines.length} lines`);

mkdirSync("out", { recursive: true });
const pkg = await buildAudioPackage(doc.lines, map.tick_rate, "out");

console.log(`synthesis: ${pkg.synthesisMs.toFixed(0)}ms, encode: ${pkg.encodeMs.toFixed(0)}ms`);
console.log(`packed ${pkg.packedLines.length}/${doc.lines.length} lines (dropped: ${doc.lines.length - pkg.packedLines.length})`);
console.log(`audio: ${pkg.audioPath}`);
console.log(`captions: ${pkg.captionsPath}`);
console.log();
for (const c of readCaptions(pkg.captionsPath)) {
  console.log(`[${(c.start_ms / 1000).toFixed(1)}s - ${(c.end_ms / 1000).toFixed(1)}s] ${c.text}`);
}
