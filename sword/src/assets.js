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
  const [hero, sword, ritual, bow, weapons] = await Promise.all([
    load("assets/models/hero.glb"),
    load("assets/models/demon_sword.glb"),
    load("assets/models/ritual.glb"),
    load("assets/models/bow.glb"),
    load("assets/models/weapons.glb"),
  ]);
  const parts = hero && Object.fromEntries(hero.children.map((c) => [c.name, c]));
  // Class weapons by name; the demon blade doubles as the warrior's sword.
  const classWeapons = { sword };
  for (const n of ["Dagger", "Mace", "Axe", "Staff"]) {
    const w = weapons?.getObjectByName(n);
    if (w) classWeapons[n.toLowerCase()] = w;
  }
  return { hero: parts, sword, ritual, bow, classWeapons };
}
