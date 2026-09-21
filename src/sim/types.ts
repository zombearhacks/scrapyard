// Matches the scrapyard.fight/1 schema in 03 - Architecture & Data Model.md.
// `schema` is always the first field written and the first field any consumer checks.

export const SCHEMA_VERSION = "scrapyard.fight/1" as const;

export type SwingState = 0 | 1 | 2 | 3; // idle | windup | extended | recover

export interface FighterSpec {
  slot: 0 | 1;
  weapon_id: string;
  display_name: string;
  attrs: {
    speed: number;
    size: number;
    damage: number;
    defense: number;
    spell: string;
  };
}

export type FightEvent =
  | { t: number; id: number; type: "fight_start" }
  | { t: number; id: number; type: "wall_bounce"; actor: 0 | 1; wall: "n" | "s" | "e" | "w"; impact_speed: number }
  | { t: number; id: number; type: "clash"; actor: 0 | 1; target: 0 | 1; blocked: true }
  | {
      t: number;
      id: number;
      type: "strike";
      actor: 0 | 1;
      target: 0 | 1;
      at: [number, number];
      damage: number;
      impact_speed: number;
      score_after: [number, number];
    }
  | { t: number; id: number; type: "spell_proc"; actor: 0 | 1; spell: string; effect: string }
  | { t: number; id: number; type: "fight_end" };

export interface FightMap {
  schema: typeof SCHEMA_VERSION;
  fight_id: string;
  seed: string;
  sim_build: string;
  created_at: string;

  rules: { win_condition: "first_to_strikes"; target_strikes: number; max_ticks: number };
  arena: { w: number; h: number; restitution: number };
  tick_rate: number;
  sample_rate: number;

  fighters: [FighterSpec, FighterSpec];

  tracks: {
    encoding: "raw-rounded";
    fields: ["x", "y", "rot", "swing"];
    samples: number;
    data: [number[], number[]];
  };

  events: FightEvent[];

  outcome: {
    winner_slot: 0 | 1 | null;
    final_score: [number, number];
    duration_ticks: number;
    end_reason: "target_reached" | "time_limit";
  };
}

export interface FightConfig {
  seed: string;
  weaponIds: [string, string];
  targetStrikes?: number;
  maxTicks?: number;
  arenaSize?: number;
}
