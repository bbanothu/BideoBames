# Ashen Oath

A small souls-like in the browser (three.js r160, no build step, no external assets — all models,
textures and sound are procedural).

## Run

```sh
npm install   # once (the only dependency is the `ws` WebSocket library)
npm start     # serves the game + multiplayer on http://localhost:8137 (PORT=… to change)
```

`python3 devserver.py 8137` still works for single player, but multiplayer needs `npm start`.

## Multiplayer — the Hunt

One against everyone who joins. **Multiplayer → Create Match** makes you *the One* and shows a
4-letter code; friends open the same address (the server prints your LAN addresses), choose
**Multiplayer**, type the code and join as *Hunters*. The One starts the round from the lobby.

- Fights happen in the Warden's arena; AI enemies are off. The One's HP scales with the hunt
  (+75% per Hunter) and shows as a boss bar to the Hunters.
- Round ends when the One falls (Hunters win) or every Hunter falls (the One wins); the next round
  starts 6 s later. Late joiners drop straight into the current round as Hunters. No friendly fire.
- Each game simulates its own player and streams its pose at 20 Hz; others are interpolated
  puppets (robe physics included). Hits are detected by the attacker and resolved by the victim,
  so your own rolls and blocks always count. Cuts are broadcast, so the same limb comes off on
  every screen.
- Playing over the internet needs the server reachable from outside (port forward 8137, a tunnel,
  or a VPN like Tailscale).

Any modern browser on Linux works (Chrome/Chromium/Firefox). Gamepads with standard mapping are supported.

## What's in it

- **Five classes** (pick one on New Game / in the lobby): Warrior, Rogue, Cleric, Berserker, Necromancer —
  each with its own Blender-built weapon, passive, three mana skills (1/2/3) and a special move (V).
  Mana regenerates slowly; mana flasks (T) restore it and refill at bonfires. Arcane raises mana and spell power.
- **Inventory (I) and loot**: dead enemies drop Crimson Vials (HP, key 4), Azure Vials (mana, key 5),
  arrow bundles and rarely a Rebirth Draught (key 6) that regrows severed limbs. Spent arrows can be
  picked back up by walking over them (quiver holds 60).
- **Ozrael, the Chained** — a demon merchant in the courtyard (E to talk) who sells arrows, vials,
  Rebirth Draughts and Estus Shards (+1 flask, up to 8) for souls.
- **Sekiro-style UI**: minimal HUD, brush-kanji death screen, and a wooden Equipment · Inventory ·
  Options board (Esc) with saved settings — camera speed, invert Y, FOV, volumes, brightness,
  shadow quality, render resolution, camera shake, enemy health bars.
- **An endless world**: through the courtyard's south gate the wilds stream in forever — hills, dead
  forests, graveyards, ruined shrines and roaming hollows (deterministic, so every player sees the same land).
- Daytime lighting with a sky dome and sun.

- Two weapons, swapped with F (gamepad Y): the demon blade and a bow. Hold LMB to draw, release to
  loose; hold RMB to aim over the shoulder. Arrows fly with gravity, stick where they land, lodge in
  the body part they hit and make it bleed; a fully drawn headshot kills. 30 arrows, restocked at bonfires.
- Stamina-based combat: 3-hit light combo, heavy attack, block, roll with i-frames (tap Space),
  backstep (tap with no direction), sprint (hold Space), lock-on with target switching
- Critical hits from behind, poise/stagger, guard break on shielded knights
- Estus flasks, bonfires (rest = refill + enemies respawn), level up Vigor / Endurance / Strength
- Death drops your souls as a bloodstain; die again before reaching it and they're gone
- Area: Courtyard of Ash → Hollow Causeway → Sunken Hall (Fallen Knight) → Antechamber bonfire → fog gate
- Boss: the Ashen Warden — two phases; phase 2 sets its greatsword aflame and adds leap slams,
  shockwaves and a fire nova
- Orange "messages" on the floor (E to read) double as the tutorial
- Progress autosaves to localStorage

## Art assets (Blender)

The hero, the demon sword and the bow + arrow are modelled in Blender by `blender/build_assets.py` and exported to
`assets/models/*.glb` (the editable `.blend` files are saved next to the script):

```sh
blender/build.sh            # uses ../tools/blender-*/blender, or set BLENDER=/path/to/blender
```

The player character is the "Ritual Woman" sculpt (`assets/source/ritual_women_500k.glb`, not in git).
`blender/build_ritual.py` scales and recentres it, decimates 500k → 60k triangles, shrinks the 4K
textures to WebP, adds an armature whose bones are named after the game's rig joints, computes skin
weights (the robe rides the hips) and exports `assets/models/ritual.glb`. The game rebinds that skin
to its own joint groups (`Humanoid.useSkinnedModel`), so the existing poses, IK and dismemberment drive
it; a severed limb is carved out of the skin in its current pose and collapsed into a stump on the body.
The robe is physically simulated: the build fits 16 bone strands (6 nodes each) to the robe's outer
surface from waist to hem and re-weights the cloth onto them; `src/cloth.js` runs them as verlet chains
pinned at the waist (gravity, damping, a pull back to the rest drape that loosens toward the hem,
ring links between neighbouring strands, collision with the legs and floor) and poses the skirt bones.
Joint landmarks are measured by hand at the top of the script — adjust them there if you swap models.

On ARM Linux (Asahi) there is no native Blender build, so `build.sh` runs the x86-64 Blender
through FEX inside `muvm`. The hero is exported as rigid pieces, one per rig joint, with origins at
the joint pivots — that's what lets the game animate and dismember it. If a `.glb` fails to load,
the game falls back to the procedural models in `src/humanoid.js`.

## Layout

- `src/main.js` — game loop, combat resolution, bonfires, death/respawn, save
- `src/player.js`, `src/enemy.js` — state machines; `src/attacks.js` — keyframed attack data
- `src/humanoid.js` — procedural rigged knight, poses, leg IK
- `src/world.js` — level geometry, colliders, bonfires, fog gate
- `src/classes.js` — class/skill data; `src/spells.js` — skill & special-move effects
- `src/terrain.js` — endless chunked terrain, scatter and roaming enemies
- `src/loot.js` — drops, pickups, arrow recovery; `src/menu.js` — board menu, settings, painted UI textures
- `src/merchant.js` — Ozrael and his shop
- `src/mp.js` — match client (rooms, rounds, state sync); `src/remote.js` — other players' puppets
- `server/server.js` — static server + WebSocket room relay
- `src/archery.js` — bow rig (live string, nocked arrow) and arrow projectiles
- `src/cloth.js` — spring-bone robe simulation
- `src/assets.js` — loads the Blender .glb models; `src/gore.js` — severed limbs, blood pools
- `src/camera.js`, `src/hud.js`, `src/input.js`, `src/particles.js`, `src/audio.js`
