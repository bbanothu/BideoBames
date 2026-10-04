// The five classes: starting stats, weapon, passive, three mana skills (keys 1/2/3) and a special (V).

export const SKILLS = {
  warcry: { name: "War Cry", cost: 25, desc: "+30% damage for 12 s" },
  slam: { name: "Ground Slam", cost: 30, desc: "Shockwave around you" },
  charge: { name: "Charge", cost: 20, desc: "Barrel forward through foes" },
  step: { name: "Shadow Step", cost: 18, desc: "Invulnerable blink" },
  veil: { name: "Smoke Veil", cost: 30, desc: "Unseen for 6 s (attacking reveals)" },
  venom: { name: "Venom Blade", cost: 22, desc: "Hits make foes bleed, 12 s" },
  holybolt: { name: "Holy Bolt", cost: 14, desc: "Homing light" },
  heal: { name: "Heal", cost: 30, desc: "Restore 35% HP, stop bleeding" },
  sanctuary: { name: "Sanctuary", cost: 35, desc: "Holy burst that heals you" },
  rage: { name: "Rage", cost: 25, desc: "+25% damage, lifesteal, speed, 12 s" },
  whirl: { name: "Whirlwind", cost: 25, desc: "Spin through everything nearby" },
  drain: { name: "Life Drain", cost: 16, desc: "Bolt that heals you" },
  raise: { name: "Raise Dead", cost: 45, desc: "Two undead allies for 30 s" },
  corpse: { name: "Corpse Burst", cost: 32, desc: "Necrotic blast around you" },
};

export const SPECIALS = {
  cleave: { name: "Crimson Cleave", cost: 20 },
  assassinate: { name: "Assassinate", cost: 25 },
  smite: { name: "Divine Smite", cost: 22 },
  soulrend: { name: "Soul Rend", cost: 22 },
  barrage: { name: "Barrage", cost: 15 },
};

export const CLASSES = {
  warrior: {
    name: "Warrior", blurb: "Frontline fighter in heavy armour. Hard to kill, hits hard.",
    stats: { vig: 14, end: 12, str: 12, arc: 6 }, weapon: "sword",
    passive: "Iron Will — takes 20% less damage; blocking costs less stamina.",
    skills: ["warcry", "slam", "charge"], special: "cleave",
    atkSpeed: 1, atkDmg: 1, range: 1, dmgTaken: 0.8, crit: 1.6, tint: 0xffffff,
  },
  rogue: {
    name: "Rogue", blurb: "Stealthy and quick. Daggers, ambushes and brutal critical hits.",
    stats: { vig: 11, end: 14, str: 11, arc: 8 }, weapon: "dagger",
    passive: "Assassin — critical hits from behind deal 2.6× damage; cheaper rolls.",
    skills: ["step", "veil", "venom"], special: "assassinate",
    atkSpeed: 1.4, atkDmg: 0.72, range: 0.78, dmgTaken: 1, crit: 2.6, rollCost: 14, tint: 0xb8c0d0,
  },
  cleric: {
    name: "Cleric", blurb: "Healer and holy warrior. Mends wounds and smites with light.",
    stats: { vig: 12, end: 10, str: 9, arc: 13 }, weapon: "mace",
    passive: "Blessed — slowly regenerates health; bleeds half as fast.",
    skills: ["holybolt", "heal", "sanctuary"], special: "smite",
    atkSpeed: 0.95, atkDmg: 0.95, range: 0.9, dmgTaken: 0.9, crit: 1.6, regen: 1.5, bleedMul: 0.5, tint: 0xfff2d8,
  },
  berserker: {
    name: "Berserker", blurb: "Reckless bruiser. Trades defence for raw damage, fuelled by rage.",
    stats: { vig: 12, end: 11, str: 16, arc: 5 }, weapon: "axe",
    passive: "Bloodlust — up to +60% damage as health drops; takes 15% more damage.",
    skills: ["rage", "slam", "whirl"], special: "cleave",
    atkSpeed: 0.85, atkDmg: 1.45, range: 1.15, dmgTaken: 1.15, crit: 1.6, bloodlust: true, tint: 0xffc8b8,
  },
  necromancer: {
    name: "Necromancer", blurb: "Dark caster. Raises the dead and drains the living.",
    stats: { vig: 9, end: 10, str: 8, arc: 17 }, weapon: "staff",
    passive: "Soul Siphon — every kill restores 10 mana.",
    skills: ["drain", "raise", "corpse"], special: "soulrend",
    atkSpeed: 0.9, atkDmg: 0.65, range: 1.05, dmgTaken: 1, crit: 1.6, manaOnKill: 10, tint: 0xc8b8e8,
  },
};

export const CLASS_IDS = Object.keys(CLASSES);
