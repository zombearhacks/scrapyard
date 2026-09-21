import { mkdirSync, writeFileSync } from "node:fs";
import { simulateFight } from "../src/sim/simulate.js";
import { fightMapSchema } from "../src/sim/schema.js";
import { WEAPONS } from "../src/sim/weapons.js";

const seed = process.argv[2] ?? "demo-seed-1";
const w0 = process.argv[3] ?? WEAPONS[0]!.id;
const w1 = process.argv[4] ?? WEAPONS[1]!.id;

const t0 = performance.now();
const map = simulateFight({ seed, weaponIds: [w0, w1] });
const cpuMs = performance.now() - t0;

const parsed = fightMapSchema.safeParse(map);
if (!parsed.success) {
  console.error("Schema validation FAILED:", parsed.error.format());
  process.exit(1);
}

mkdirSync("out", { recursive: true });
const outPath = `out/${map.fight_id}.map.json`;
writeFileSync(outPath, JSON.stringify(map));

const bytes = Buffer.byteLength(JSON.stringify(map));
console.log(`fight_id        ${map.fight_id}`);
console.log(`seed            ${seed}`);
console.log(`matchup         ${map.fighters[0].display_name} vs ${map.fighters[1].display_name}`);
console.log(`winner          ${map.outcome.winner_slot === null ? "tie" : map.fighters[map.outcome.winner_slot].display_name}`);
console.log(`score           ${map.outcome.final_score.join(" - ")}`);
console.log(`end_reason      ${map.outcome.end_reason}`);
console.log(`duration        ${(map.outcome.duration_ticks / map.tick_rate).toFixed(1)}s (${map.outcome.duration_ticks} ticks)`);
console.log(`events          ${map.events.length}`);
console.log(`samples         ${map.tracks.samples}`);
console.log(`sim CPU time    ${cpuMs.toFixed(1)} ms`);
console.log(`map.json size   ${(bytes / 1024).toFixed(1)} KB (uncompressed)`);
console.log(`written to      ${outPath}`);
