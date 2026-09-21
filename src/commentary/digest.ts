// scrapyard.digest/1 — 01's third open question, answered in 03: the LLM never sees the raw
// event map, only this. Every beat cites real event ids so a line can always be traced back
// to what actually happened (the mechanism behind success criterion #5, not a hope).

import type { FightEvent, FightMap } from "../sim/types.js";
import { getWeapon } from "../sim/weapons.js";
import { round1 } from "../sim/utils.js";

export const DIGEST_SCHEMA_VERSION = "scrapyard.digest/1" as const;

export type BeatKind =
  | "first_blood"
  | "streak"
  | "stall"
  | "comeback"
  | "match_point"
  | "biggest_hit"
  | "finishing_blow"
  | "near_miss";

export interface DigestBeat {
  t: number;
  kind: BeatKind;
  event_ids: number[];
  facts: Record<string, unknown>;
}

export interface FightDigest {
  schema: typeof DIGEST_SCHEMA_VERSION;
  fight_id: string;
  fighters: [{ slot: 0; name: string; style: string }, { slot: 1; name: string; style: string }];
  headline: string;
  beats: DigestBeat[];
  final: { winner: string | "tie"; score: [number, number]; duration_s: number };
}

const MAX_BEATS = 20;
const MIN_BEAT_GAP_TICKS = 3 * 60; // don't clump beats within 3s of each other unless forced
const STALL_THRESHOLD_TICKS = 8 * 60;

interface Candidate extends DigestBeat {
  forced: boolean;
  priority: number; // higher = kept first when trimming to MAX_BEATS
}

export function deriveDigest(map: FightMap): FightDigest {
  const tickRate = map.tick_rate;
  const name = (slot: 0 | 1) => map.fighters[slot].display_name;
  const strikes = map.events.filter((e): e is Extract<FightEvent, { type: "strike" }> => e.type === "strike");
  const clashes = map.events.filter((e): e is Extract<FightEvent, { type: "clash" }> => e.type === "clash");
  const targetStrikes = map.rules.target_strikes;

  const candidates: Candidate[] = [];
  const usedEventIds = new Set<number>();

  function scoreAtTick(t: number): [number, number] {
    let a = 0;
    let b = 0;
    for (const s of strikes) {
      if (s.t > t) break;
      if (s.actor === 0) a = s.score_after[0];
      else b = s.score_after[1];
    }
    return [a, b];
  }

  // first_blood — forced
  const firstStrike = strikes[0];
  if (firstStrike) {
    candidates.push({
      t: firstStrike.t,
      kind: "first_blood",
      event_ids: [firstStrike.id],
      facts: { actor: name(firstStrike.actor), impact_speed: firstStrike.impact_speed },
      forced: true,
      priority: 100,
    });
    usedEventIds.add(firstStrike.id);
  }

  // finishing_blow — forced, only meaningful if the fight actually ended on a strike
  const lastStrike = strikes[strikes.length - 1];
  const hasFinishingBlow = map.outcome.end_reason === "target_reached" && lastStrike !== undefined;
  if (hasFinishingBlow && lastStrike) {
    candidates.push({
      t: lastStrike.t,
      kind: "finishing_blow",
      event_ids: [lastStrike.id],
      facts: { actor: name(lastStrike.actor), final: map.outcome.final_score },
      forced: true,
      priority: 99,
    });
    usedEventIds.add(lastStrike.id);
  }

  // match_point — forced: the strike that brought the eventual winner to target-1
  if (map.outcome.winner_slot !== null) {
    const winner = map.outcome.winner_slot;
    const matchPoint = strikes.find((s) => s.score_after[winner] === targetStrikes - 1);
    if (matchPoint && !usedEventIds.has(matchPoint.id)) {
      candidates.push({
        t: matchPoint.t,
        kind: "match_point",
        event_ids: [matchPoint.id],
        facts: { actor: name(winner) },
        forced: true,
        priority: 98,
      });
    }
  }

  // streak — 3+ consecutive strikes by the same actor
  let runStart = 0;
  for (let i = 1; i <= strikes.length; i++) {
    const runEnded = i === strikes.length || strikes[i]!.actor !== strikes[runStart]!.actor;
    if (runEnded) {
      const runLen = i - runStart;
      if (runLen >= 3) {
        const first = strikes[runStart]!;
        const last = strikes[i - 1]!;
        candidates.push({
          t: last.t,
          kind: "streak",
          event_ids: strikes.slice(runStart, i).map((s) => s.id),
          facts: { actor: name(first.actor), count: runLen, span_s: round1((last.t - first.t) / tickRate) },
          forced: false,
          priority: 70,
        });
      }
      runStart = i;
    }
  }

  // comeback — the strike where a fighter who was down by 3+ ties or takes the lead, once each
  {
    let deficitA = 0;
    let deficitB = 0;
    let flaggedA = false;
    let flaggedB = false;
    let a = 0;
    let b = 0;
    for (const s of strikes) {
      if (s.actor === 0) a++;
      else b++;
      deficitA = Math.max(deficitA, b - a);
      deficitB = Math.max(deficitB, a - b);
      if (!flaggedA && deficitA >= 3 && a >= b) {
        candidates.push({
          t: s.t,
          kind: "comeback",
          event_ids: [s.id],
          facts: { actor: name(0), from_deficit: deficitA },
          forced: false,
          priority: 80,
        });
        flaggedA = true;
      }
      if (!flaggedB && deficitB >= 3 && b >= a) {
        candidates.push({
          t: s.t,
          kind: "comeback",
          event_ids: [s.id],
          facts: { actor: name(1), from_deficit: deficitB },
          forced: false,
          priority: 80,
        });
        flaggedB = true;
      }
    }
  }

  // near_miss — a block thrown while the blocker was one hit from losing
  for (const c of clashes) {
    const [sa, sb] = scoreAtTick(c.t - 1);
    const blockerScore = c.target === 0 ? sa : sb;
    if (blockerScore === targetStrikes - 1) {
      candidates.push({
        t: c.t,
        kind: "near_miss",
        event_ids: [c.id],
        facts: { actor: name(c.target), attacker: name(c.actor) },
        forced: false,
        priority: 75,
      });
    }
  }

  // stall — gaps of 8s+ with no strike or clash
  const combat = [...strikes, ...clashes].sort((x, y) => x.t - y.t);
  if (combat.length > 0 && combat[0]!.t >= STALL_THRESHOLD_TICKS) {
    candidates.push({
      t: Math.floor(combat[0]!.t / 2),
      kind: "stall",
      event_ids: [],
      facts: { duration_s: round1(combat[0]!.t / tickRate) },
      forced: false,
      priority: 40,
    });
  }
  for (let i = 1; i < combat.length; i++) {
    const gap = combat[i]!.t - combat[i - 1]!.t;
    if (gap >= STALL_THRESHOLD_TICKS) {
      candidates.push({
        t: combat[i - 1]!.t + Math.floor(gap / 2),
        kind: "stall",
        event_ids: [],
        facts: { duration_s: round1(gap / tickRate) },
        forced: false,
        priority: 40,
      });
    }
  }

  // biggest_hit — highest impact_speed strike, skipped if it's already the finishing blow
  if (strikes.length > 0) {
    const biggest = strikes.reduce((a, b) => (b.impact_speed > a.impact_speed ? b : a));
    if (!usedEventIds.has(biggest.id)) {
      candidates.push({
        t: biggest.t,
        kind: "biggest_hit",
        event_ids: [biggest.id],
        facts: { actor: name(biggest.actor), impact_speed: biggest.impact_speed },
        forced: false,
        priority: 60,
      });
    }
  }

  // Select: forced beats always survive; the rest fill remaining slots by priority, skipping
  // anything within MIN_BEAT_GAP_TICKS of an already-selected beat so beats spread across the
  // fight instead of clumping (03's spec).
  const forced = candidates.filter((c) => c.forced).sort((a, b) => a.t - b.t);
  const optional = candidates
    .filter((c) => !c.forced)
    .sort((a, b) => b.priority - a.priority || a.t - b.t);

  const selected: Candidate[] = [...forced];
  for (const cand of optional) {
    if (selected.length >= MAX_BEATS) break;
    const tooClose = selected.some((s) => Math.abs(s.t - cand.t) < MIN_BEAT_GAP_TICKS);
    if (tooClose) continue;
    selected.push(cand);
  }
  selected.sort((a, b) => a.t - b.t);

  const winnerName = map.outcome.winner_slot === null ? "tie" : name(map.outcome.winner_slot);
  const margin = Math.abs(map.outcome.final_score[0] - map.outcome.final_score[1]);
  const wonByComeback = selected.some(
    (b) => b.kind === "comeback" && map.outcome.winner_slot !== null && b.facts.actor === name(map.outcome.winner_slot),
  );
  const headline =
    map.outcome.winner_slot === null
      ? "tie"
      : wonByComeback
        ? `${getWeapon(map.fighters[map.outcome.winner_slot].weapon_id).id}_wins_after_comeback`
        : margin <= 3
          ? `${getWeapon(map.fighters[map.outcome.winner_slot].weapon_id).id}_wins_close_fight`
          : `${getWeapon(map.fighters[map.outcome.winner_slot].weapon_id).id}_wins_dominant`;

  return {
    schema: DIGEST_SCHEMA_VERSION,
    fight_id: map.fight_id,
    fighters: [
      { slot: 0, name: name(0), style: getWeapon(map.fighters[0].weapon_id).styleHint },
      { slot: 1, name: name(1), style: getWeapon(map.fighters[1].weapon_id).styleHint },
    ],
    headline,
    beats: selected.map(({ forced: _forced, priority: _priority, ...beat }) => beat),
    final: {
      winner: winnerName,
      score: map.outcome.final_score,
      duration_s: round1(map.outcome.duration_ticks / tickRate),
    },
  };
}
