export type SpellId = "cleave" | "riposte" | "stun" | "lunge";

export interface WeaponDef {
  id: string;
  display_name: string;
  attrs: {
    speed: number; // 1-10. Higher = shorter swing windup/recovery, faster body movement.
    size: number; // 1-10. Bigger body radius = easier to be hit, more contact mass.
    damage: number; // 1-10. Flavor + knockback impulse strength. Does not change score (strikes are 1 point each).
    defense: number; // 1-10. Raises this fighter's chance to turn an incoming strike into a clash.
    spell: SpellId;
  };
  styleHint: string; // one line of persona, fed to the digest per 03's data model
}

// Four fixed v1 weapons per 01 - Product Vision & Scope and the weapons table in 03.
export const WEAPONS: readonly WeaponDef[] = [
  {
    id: "axe",
    display_name: "The Axe",
    attrs: { speed: 4, size: 7, damage: 9, defense: 8, spell: "cleave" },
    styleHint: "slow, enormous, hits like a dropped piano",
  },
  {
    id: "sword",
    display_name: "The Sword",
    attrs: { speed: 8, size: 4, damage: 5, defense: 6, spell: "riposte" },
    styleHint: "quick, twitchy, death by a thousand pokes",
  },
  {
    id: "mace",
    display_name: "The Mace",
    attrs: { speed: 3, size: 6, damage: 8, defense: 7, spell: "stun" },
    styleHint: "heavy, stubborn, shrugs off punishment",
  },
  {
    id: "spear",
    display_name: "The Spear",
    attrs: { speed: 9, size: 3, damage: 6, defense: 5, spell: "lunge" },
    styleHint: "fast and reckless, all speed no patience",
  },
];

// Shared by the sim (collision/engage-range math) and the renderer (draw size) so the two
// never drift into two different definitions of "how big is this fighter" — decision #4's
// whole point, applied to this one number.
export function weaponRadius(size: number): number {
  return 22 + size * 4;
}

export function getWeapon(id: string): WeaponDef {
  const w = WEAPONS.find((w) => w.id === id);
  if (!w) throw new Error(`Unknown weapon id: ${id}`);
  return w;
}
