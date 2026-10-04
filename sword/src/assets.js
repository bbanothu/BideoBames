import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Blender-built models (see blender/build_assets.py). Missing files fall back to procedural meshes.
export async function loadAssets() {
  const loader = new GLTFLoader();
  const load = (url) =>
    loader.loadAsync(url).then(
      (g) => g.scene,
      (e) => {
        console.warn("asset failed to load, using procedural fallback:", url, e);
        return null;
      },
    );
  const CHARS = ["char_1", "char_2", "char_3", "char_4", "villain_1"];
  const [hero, sword, ritual, bow, weapons, ...chars] = await Promise.all([
    load("assets/models/hero.glb"),
    load("assets/models/demon_sword.glb"),
    load("assets/models/ritual.glb"),
    load("assets/models/bow.glb"),
    load("assets/models/weapons.glb"),
    ...CHARS.map((c) => load(`assets/models/${c}.glb`)),
  ]);
  const parts = hero && Object.fromEntries(hero.children.map((c) => [c.name, c]));
  // Class weapons by name; the demon blade doubles as the warrior's sword.
  const classWeapons = { sword };
  for (const n of ["Dagger", "Mace", "Axe", "Staff"]) {
    const w = weapons?.getObjectByName(n);
    if (w) classWeapons[n.toLowerCase()] = w;
  }
  // Character bodies by id (the class table picks one per class).
  const bodies = { ritual };
  CHARS.forEach((c, i) => chars[i] && (bodies[c] = chars[i]));
  return { hero: parts, sword, ritual, bow, classWeapons, bodies };
}
