import { describe, expect, it } from "vitest";
import { simulateFight } from "../sim/simulate.js";
import { deriveDigest } from "./digest.js";

describe("deriveDigest", () => {
  const map = simulateFight({ seed: "digest-test-1", weaponIds: ["axe", "spear"] });
  const digest = deriveDigest(map);
  const realEventIds = new Set(map.events.map((e) => e.id));

  it("stamps the correct schema and fight_id", () => {
    expect(digest.schema).toBe("scrapyard.digest/1");
    expect(digest.fight_id).toBe(map.fight_id);
  });

  it("includes first_blood when the fight had any strikes", () => {
    const hadStrike = map.events.some((e) => e.type === "strike");
    expect(digest.beats.some((b) => b.kind === "first_blood")).toBe(hadStrike);
  });

  it("includes finishing_blow only when the fight ended via target_reached", () => {
    const hasFinishing = digest.beats.some((b) => b.kind === "finishing_blow");
    expect(hasFinishing).toBe(map.outcome.end_reason === "target_reached");
  });

  it("never cites an event id that doesn't exist in the map", () => {
    for (const beat of digest.beats) {
      for (const id of beat.event_ids) {
        expect(realEventIds.has(id)).toBe(true);
      }
    }
  });

  it("orders beats chronologically", () => {
    for (let i = 1; i < digest.beats.length; i++) {
      expect(digest.beats[i]!.t).toBeGreaterThanOrEqual(digest.beats[i - 1]!.t);
    }
  });

  it("stays within the beat cap", () => {
    expect(digest.beats.length).toBeLessThanOrEqual(20);
  });

  it("produces a non-empty headline and matches the outcome's winner", () => {
    expect(digest.headline.length).toBeGreaterThan(0);
    const expectedWinner = map.outcome.winner_slot === null ? "tie" : map.fighters[map.outcome.winner_slot].display_name;
    expect(digest.final.winner).toBe(expectedWinner);
  });

  it("is deterministic for the same seed", () => {
    const map2 = simulateFight({ seed: "digest-test-1", weaponIds: ["axe", "spear"] });
    const digest2 = deriveDigest(map2);
    expect(digest2.beats).toEqual(digest.beats);
    expect(digest2.headline).toBe(digest.headline);
  });
});
