import { z } from "zod";
import { SCHEMA_VERSION } from "./types.js";

// Every consumer (renderer, digest, ingest endpoint) validates against this and
// refuses unknown `schema` values loudly — see 03 - Architecture & Data Model §Schema notes.

const attrsSchema = z.object({
  speed: z.number(),
  size: z.number(),
  damage: z.number(),
  defense: z.number(),
  spell: z.string(),
});

const fighterSchema = z.object({
  slot: z.union([z.literal(0), z.literal(1)]),
  weapon_id: z.string(),
  display_name: z.string(),
  attrs: attrsSchema,
});

const baseEvent = { t: z.number().int(), id: z.number().int() };

const eventSchema = z.discriminatedUnion("type", [
  z.object({ ...baseEvent, type: z.literal("fight_start") }),
  z.object({
    ...baseEvent,
    type: z.literal("wall_bounce"),
    actor: z.union([z.literal(0), z.literal(1)]),
    wall: z.enum(["n", "s", "e", "w"]),
    impact_speed: z.number(),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("clash"),
    actor: z.union([z.literal(0), z.literal(1)]),
    target: z.union([z.literal(0), z.literal(1)]),
    blocked: z.literal(true),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("strike"),
    actor: z.union([z.literal(0), z.literal(1)]),
    target: z.union([z.literal(0), z.literal(1)]),
    at: z.tuple([z.number(), z.number()]),
    damage: z.number(),
    impact_speed: z.number(),
    score_after: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    ...baseEvent,
    type: z.literal("spell_proc"),
    actor: z.union([z.literal(0), z.literal(1)]),
    spell: z.string(),
    effect: z.string(),
  }),
  z.object({ ...baseEvent, type: z.literal("fight_end") }),
]);

export const fightMapSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  fight_id: z.string(),
  seed: z.string(),
  sim_build: z.string(),
  created_at: z.string(),
  rules: z.object({
    win_condition: z.literal("first_to_strikes"),
    target_strikes: z.number().int(),
    max_ticks: z.number().int(),
  }),
  arena: z.object({ w: z.number(), h: z.number(), restitution: z.number() }),
  tick_rate: z.number().int(),
  sample_rate: z.number().int(),
  fighters: z.tuple([fighterSchema, fighterSchema]),
  tracks: z.object({
    encoding: z.literal("raw-rounded"),
    fields: z.tuple([z.literal("x"), z.literal("y"), z.literal("rot"), z.literal("swing")]),
    samples: z.number().int(),
    data: z.tuple([z.array(z.number()), z.array(z.number())]),
  }),
  events: z.array(eventSchema),
  outcome: z.object({
    winner_slot: z.union([z.literal(0), z.literal(1), z.null()]),
    final_score: z.tuple([z.number(), z.number()]),
    duration_ticks: z.number().int(),
    end_reason: z.enum(["target_reached", "time_limit"]),
  }),
});
