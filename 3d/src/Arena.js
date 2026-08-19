import * as THREE from "three";

export const WORLD_LEFT = -9;
export const WORLD_RIGHT = 9;

/** Builds the ground + backdrop + lighting for a chosen map image. */
export class Arena {
  constructor(scene, mapFile) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(-4, 8, 6);
    this.group.add(ambient, sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 30),
      new THREE.MeshStandardMaterial({ color: 0x8a8a8a })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 0);
    this.group.add(ground);

    if (mapFile) {
      const tex = new THREE.TextureLoader().load(`assets/maps/${mapFile}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 20),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      backdrop.position.set(0, 10, -12);
      this.group.add(backdrop);
    }

    scene.background = new THREE.Color(0x1a1a1a);
    scene.fog = new THREE.Fog(0x1a1a1a, 25, 45);
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
