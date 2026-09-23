// Builds the committed fixture fight package Phase 1's renderer loads — per 05:
// "A static page that loads a committed fixture fight package from Phase 0 and plays it."

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simulateFight } from "../src/sim/simulate.js";
import { fightMapSchema } from "../src/sim/schema.js";
import { deriveDigest } from "../src/commentary/digest.js";
import { generateCommentary } from "../src/commentary/commentary.js";
import { buildAudioPackage } from "../src/tts/tts.js";

const seed = process.argv[2] ?? "demo-d";
const w0 = process.argv[3] ?? "axe";
const w1 = process.argv[4] ?? "spear";
const outDir = "public/fixtures/demo";

const map = simulateFight({ seed, weaponIds: [w0, w1] });
fightMapSchema.parse(map);

const digest = deriveDigest(map);
const { doc, source } = await generateCommentary(digest);
console.log(`commentary source: ${source}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "map.json"), JSON.stringify(map));

const pkg = await buildAudioPackage(doc.lines, map.tick_rate, outDir);
console.log(`fixture written to ${outDir}/ (map.json, audio.opus, captions.json)`);
console.log(`matchup: ${map.fighters[0].display_name} vs ${map.fighters[1].display_name}, ${map.outcome.final_score.join("-")}`);
