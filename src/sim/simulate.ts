import * as planck from "planck";
import { ulid } from "ulid";
import { Rng } from "./rng.js";
import { getWeapon, weaponRadius, type WeaponDef } from "./weapons.js";
import { clamp, round1 } from "./utils.js";
import { SCHEMA_VERSION, type FightConfig, type FightEvent, type FightMap, type SwingState } from "./types.js";

export const SIM_BUILD = "sim@0.1.0";

const TICK_RATE = 60;
const SAMPLE_RATE = 30;
const SAMPLE_EVERY = TICK_RATE / SAMPLE_RATE;
const WALL_RESTITUTION = 0.97;
const INVULN_TICKS = 40; // ~0.67s — without this a sustained overlap scores dozens of strikes instantly.
const EXTENDED_TICKS = 6; // ~100ms strike-sensor window
const ENGAGE_MARGIN = 40; // sim units beyond touching radii that triggers a windup
const REACH_MARGIN = 25; // sim units the strike sensor extends beyond touching radii

interface FighterRuntime {
  state: SwingState;
  stateUntilTick: number;
  invulnerableUntilTick: number;
  cooldownUntilTick: number;
  score: number;
  facing: number;
  resolvedThisSwing: boolean;
}

export function simulateFight(config: FightConfig): FightMap {
  const rng = new Rng(config.seed);
  const targetStrikes = config.targetStrikes ?? 24;
  const maxTicks = config.maxTicks ?? 14400;
  const arenaSize = config.arenaSize ?? 1000;

  const weapons = config.weaponIds.map(getWeapon) as [WeaponDef, WeaponDef];
  const radii: [number, number] = [
    weaponRadius(weapons[0].attrs.size),
    weaponRadius(weapons[1].attrs.size),
  ];

  const world = new planck.World();

  const walls: Array<{ id: "n" | "s" | "e" | "w"; v1: planck.Vec2; v2: planck.Vec2 }> = [
    { id: "w", v1: new planck.Vec2(0, 0), v2: new planck.Vec2(0, arenaSize) },
    { id: "e", v1: new planck.Vec2(arenaSize, 0), v2: new planck.Vec2(arenaSize, arenaSize) },
    { id: "s", v1: new planck.Vec2(0, 0), v2: new planck.Vec2(arenaSize, 0) },
    { id: "n", v1: new planck.Vec2(0, arenaSize), v2: new planck.Vec2(arenaSize, arenaSize) },
  ];
  for (const w of walls) {
    const body = world.createBody({ type: "static" });
    body.createFixture(new planck.EdgeShape(w.v1, w.v2), { restitution: WALL_RESTITUTION, friction: 0 });
    body.setUserData({ kind: "wall", wall: w.id });
  }

  const startPositions: [planck.Vec2, planck.Vec2] = [
    new planck.Vec2(arenaSize * 0.28, arenaSize * 0.5),
    new planck.Vec2(arenaSize * 0.72, arenaSize * 0.5),
  ];

  const bodies: [planck.Body, planck.Body] = [0, 1].map((slot) => {
    const speedAttr = weapons[slot]!.attrs.speed;
    const angle = rng.range(0, Math.PI * 2);
    const speedMag = 90 + speedAttr * 14;
    const body = world.createBody({
      type: "dynamic",
      position: startPositions[slot as 0 | 1],
      bullet: true,
      fixedRotation: true,
      linearDamping: 0,
    });
    body.createFixture(new planck.CircleShape(radii[slot as 0 | 1]), {
      density: 1,
      friction: 0,
      restitution: WALL_RESTITUTION,
    });
    body.setLinearVelocity(new planck.Vec2(Math.cos(angle) * speedMag, Math.sin(angle) * speedMag));
    body.setUserData({ kind: "fighter", slot });
    return body;
  }) as [planck.Body, planck.Body];

  const runtime: [FighterRuntime, FighterRuntime] = [0, 1].map(() => ({
    state: 0 as SwingState,
    stateUntilTick: 0,
    invulnerableUntilTick: 0,
    cooldownUntilTick: 0,
    score: 0,
    facing: 0,
    resolvedThisSwing: false,
  })) as [FighterRuntime, FighterRuntime];

  const events: FightEvent[] = [];
  let nextEventId = 0;
  let currentTick = 0;

  function emit(e: Omit<FightEvent, "id">) {
    events.push({ ...(e as object), id: nextEventId++ } as FightEvent);
  }

  function applySpell(attacker: 0 | 1, defender: 0 | 1, spell: string) {
    const atkBody = bodies[attacker];
    const defBody = bodies[defender];
    switch (spell) {
      case "cleave": {
        const dir = defBody.getPosition().clone().sub(atkBody.getPosition());
        if (dir.length() > 0.001) dir.normalize();
        else dir.set(1, 0);
        defBody.applyLinearImpulse(
          dir.mul(defBody.getMass() * (40 + weapons[attacker].attrs.damage * 6)),
          defBody.getPosition(),
          true,
        );
        emit({ t: currentTick, type: "spell_proc", actor: attacker, spell, effect: "knockback" });
        break;
      }
      case "stun": {
        runtime[defender].cooldownUntilTick += 25;
        emit({ t: currentTick, type: "spell_proc", actor: attacker, spell, effect: "stagger" });
        break;
      }
      case "riposte": {
        runtime[attacker].cooldownUntilTick = Math.max(runtime[attacker].cooldownUntilTick - 15, currentTick);
        emit({ t: currentTick, type: "spell_proc", actor: attacker, spell, effect: "quick_recovery" });
        break;
      }
      case "lunge": {
        const dir = defBody.getPosition().clone().sub(atkBody.getPosition());
        if (dir.length() > 0.001) dir.normalize();
        else dir.set(1, 0);
        atkBody.applyLinearImpulse(dir.mul(atkBody.getMass() * 30), atkBody.getPosition(), true);
        emit({ t: currentTick, type: "spell_proc", actor: attacker, spell, effect: "reach" });
        break;
      }
    }
  }

  function resolveStrike(attacker: 0 | 1, defender: 0 | 1) {
    const defRt = runtime[defender];
    if (defRt.invulnerableUntilTick > currentTick) return;

    const defenderWeapon = weapons[defender];
    const blockChance = clamp(defenderWeapon.attrs.defense * 0.05, 0, 0.65);
    if (rng.bool(blockChance)) {
      emit({ t: currentTick, type: "clash", actor: attacker, target: defender, blocked: true });
      return;
    }

    const posA = bodies[attacker].getPosition();
    const posB = bodies[defender].getPosition();
    const mid: [number, number] = [round1((posA.x + posB.x) / 2), round1((posA.y + posB.y) / 2)];
    const relSpeed = round1(bodies[attacker].getLinearVelocity().clone().sub(bodies[defender].getLinearVelocity()).length());

    runtime[attacker].score += 1;
    defRt.invulnerableUntilTick = currentTick + INVULN_TICKS;
    const score_after: [number, number] = [runtime[0].score, runtime[1].score];
    emit({
      t: currentTick,
      type: "strike",
      actor: attacker,
      target: defender,
      at: mid,
      damage: weapons[attacker].attrs.damage,
      impact_speed: relSpeed,
      score_after,
    });

    applySpell(attacker, defender, weapons[attacker].attrs.spell);
  }

  // Strike detection is an active sensor check during each fighter's "extended" window, not a
  // physics contact event — 03's spec ("the strike sensor only exists during extended") is a
  // continuous check, not a discrete one. A discrete begin-contact check missed most swings:
  // by the time a windup finished, independent relative motion had often carried the fighters
  // out of contact range again, so the 6-tick extended window frequently closed with nothing
  // resolved. `resolvedThisSwing` caps each swing to at most one outcome.
  function resolveSwings() {
    const posA = bodies[0].getPosition();
    const posB = bodies[1].getPosition();
    const dist = Math.hypot(posA.x - posB.x, posA.y - posB.y);
    const strikeRange = radii[0] + radii[1] + REACH_MARGIN;
    if (dist > strikeRange) return;

    const aExtended = runtime[0].state === 2 && !runtime[0].resolvedThisSwing;
    const bExtended = runtime[1].state === 2 && !runtime[1].resolvedThisSwing;
    if (!aExtended && !bExtended) return;

    if (aExtended && bExtended) {
      runtime[0].resolvedThisSwing = true;
      runtime[1].resolvedThisSwing = true;
      emit({ t: currentTick, type: "clash", actor: 0, target: 1, blocked: true });
      return;
    }

    const attacker: 0 | 1 = aExtended ? 0 : 1;
    const defender: 0 | 1 = aExtended ? 1 : 0;
    runtime[attacker].resolvedThisSwing = true;
    resolveStrike(attacker, defender);
  }

  world.on("begin-contact", (contact) => {
    const bodyA = contact.getFixtureA().getBody();
    const bodyB = contact.getFixtureB().getBody();
    const uda = bodyA.getUserData() as { kind: "wall" | "fighter"; wall?: string; slot?: 0 | 1 };
    const udb = bodyB.getUserData() as { kind: "wall" | "fighter"; wall?: string; slot?: 0 | 1 };

    if (uda.kind === "wall" || udb.kind === "wall") {
      const wallUD = uda.kind === "wall" ? uda : udb;
      const fighterBody = uda.kind === "wall" ? bodyB : bodyA;
      const fud = fighterBody.getUserData() as { slot: 0 | 1 };
      const speed = fighterBody.getLinearVelocity().length();
      emit({
        t: currentTick,
        type: "wall_bounce",
        actor: fud.slot,
        wall: wallUD.wall as "n" | "s" | "e" | "w",
        impact_speed: round1(speed),
      });
    }
    // Fighter-vs-fighter contact still bounces physically (real restitution), but hit
    // resolution is decoupled from this event — see resolveSwings().
  });

  function updateSwingStates() {
    for (const slot of [0, 1] as const) {
      const rt = runtime[slot];
      const speedAttr = weapons[slot].attrs.speed;
      if (rt.state === 0) {
        if (currentTick >= rt.cooldownUntilTick) {
          const me = bodies[slot].getPosition();
          const other = bodies[slot === 0 ? 1 : 0].getPosition();
          const dist = me.clone().sub(other).length();
          const engageRange = radii[0] + radii[1] + ENGAGE_MARGIN;
          if (dist <= engageRange) {
            rt.state = 1;
            rt.resolvedThisSwing = false;
            rt.stateUntilTick = currentTick + Math.max(4, Math.round(18 - speedAttr * 1.3));
          }
        }
      } else if (currentTick >= rt.stateUntilTick) {
        if (rt.state === 1) {
          rt.state = 2;
          rt.stateUntilTick = currentTick + EXTENDED_TICKS;
        } else if (rt.state === 2) {
          rt.state = 3;
          rt.stateUntilTick = currentTick + Math.max(4, Math.round(14 - speedAttr));
        } else {
          rt.state = 0;
          rt.cooldownUntilTick = currentTick + 6;
        }
      }
    }
  }

  // Pure elastic billiard physics (no gravity, no drag) produces long non-intersecting
  // trajectories between two independent bodies — measured empirically: without this, two
  // fighters can bounce for the full 240s max_ticks and collide once. These are supposed to
  // be personified combatants, not inert balls, so each tick nudges heading gently toward the
  // opponent (a boid-style "seek"), preserving current speed. Real elastic collisions still
  // happen off walls and off each other; this only steers direction, never overrides physics.
  function applySteering() {
    for (const slot of [0, 1] as const) {
      const other = slot === 0 ? 1 : 0;
      const me = bodies[slot].getPosition();
      const opp = bodies[other].getPosition();
      const toOppX = opp.x - me.x;
      const toOppY = opp.y - me.y;
      const toOppLen = Math.hypot(toOppX, toOppY);
      if (toOppLen < 0.001) continue;

      const vel = bodies[slot].getLinearVelocity();
      const speedMag = vel.length();
      const baseSpeed = 90 + weapons[slot].attrs.speed * 14;
      if (speedMag < 1) {
        bodies[slot].setLinearVelocity(new planck.Vec2((toOppX / toOppLen) * baseSpeed, (toOppY / toOppLen) * baseSpeed));
        continue;
      }

      const turnRate = clamp(0.015 + weapons[slot].attrs.speed * 0.0035, 0.015, 0.08);
      const blendedX = (vel.x / speedMag) * (1 - turnRate) + (toOppX / toOppLen) * turnRate;
      const blendedY = (vel.y / speedMag) * (1 - turnRate) + (toOppY / toOppLen) * turnRate;
      const blendedLen = Math.hypot(blendedX, blendedY) || 1;
      bodies[slot].setLinearVelocity(
        new planck.Vec2((blendedX / blendedLen) * speedMag, (blendedY / blendedLen) * speedMag),
      );
    }
  }

  const trackData: [number[], number[]] = [[], []];
  let samples = 0;
  function recordSample() {
    for (const slot of [0, 1] as const) {
      const pos = bodies[slot].getPosition();
      const vel = bodies[slot].getLinearVelocity();
      if (vel.lengthSquared() > 0.0001) runtime[slot].facing = Math.atan2(vel.y, vel.x);
      trackData[slot].push(round1(pos.x), round1(pos.y), round1(runtime[slot].facing), runtime[slot].state);
    }
    samples++;
  }

  emit({ t: 0, type: "fight_start" });

  let endReason: "target_reached" | "time_limit" = "time_limit";
  let durationTicks = maxTicks;

  for (currentTick = 0; currentTick < maxTicks; currentTick++) {
    updateSwingStates();
    applySteering();
    world.step(1 / TICK_RATE);
    resolveSwings();
    if (currentTick % SAMPLE_EVERY === 0) recordSample();

    if (runtime[0].score >= targetStrikes || runtime[1].score >= targetStrikes) {
      endReason = "target_reached";
      durationTicks = currentTick + 1;
      break;
    }
  }

  emit({ t: durationTicks, type: "fight_end" });

  const winnerSlot: 0 | 1 | null =
    runtime[0].score === runtime[1].score ? null : runtime[0].score > runtime[1].score ? 0 : 1;

  return {
    schema: SCHEMA_VERSION,
    fight_id: ulid(),
    seed: config.seed,
    sim_build: SIM_BUILD,
    created_at: new Date().toISOString(),
    rules: { win_condition: "first_to_strikes", target_strikes: targetStrikes, max_ticks: maxTicks },
    arena: { w: arenaSize, h: arenaSize, restitution: WALL_RESTITUTION },
    tick_rate: TICK_RATE,
    sample_rate: SAMPLE_RATE,
    fighters: [
      { slot: 0, weapon_id: weapons[0].id, display_name: weapons[0].display_name, attrs: weapons[0].attrs },
      { slot: 1, weapon_id: weapons[1].id, display_name: weapons[1].display_name, attrs: weapons[1].attrs },
    ],
    tracks: {
      encoding: "raw-rounded",
      fields: ["x", "y", "rot", "swing"],
      samples,
      data: trackData,
    },
    events,
    outcome: {
      winner_slot: winnerSlot,
      final_score: [runtime[0].score, runtime[1].score],
      duration_ticks: durationTicks,
      end_reason: endReason,
    },
  };
}
