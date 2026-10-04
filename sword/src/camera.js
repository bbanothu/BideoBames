import * as THREE from "three";
import { angleTo, clamp, damp, dampAngle } from "./util.js";

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = Math.PI;
    this.pitch = 0.32;
    this.dist = 4.8;
    this.pivot = new THREE.Vector3();
    this.shake = 0;
    this.ray = new THREE.Raycaster();
    this.tmp = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.aiming = false;
    this.aimBlend = 0;
  }

  // How far the camera is looking up (positive) — used to tilt the archer's torso.
  aimPitch() {
    return this.aimBlend * -this.pitch;
  }

  // Camera-relative stick → world direction on XZ. lookDir = (sin yaw, 0, cos yaw), right = (-cos yaw, 0, sin yaw).
  moveVector(mx, my) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    return new THREE.Vector3(s * my - c * mx, 0, c * my + s * mx);
  }

  snapBehind(player) {
    this.yaw = player.facing;
    this.pitch = 0.32;
    this.pivot.set(player.pos.x, player.pos.y + 1.55, player.pos.z);
  }

  update(dt, player, inp, target) {
    const tgtPivot = this.tmp.set(player.pos.x, player.pos.y + 1.55, player.pos.z);
    this.pivot.x = damp(this.pivot.x, tgtPivot.x, 14, dt);
    this.pivot.y = damp(this.pivot.y, tgtPivot.y, 14, dt);
    this.pivot.z = damp(this.pivot.z, tgtPivot.z, 14, dt);

    let lookY = 0;
    if (target) {
      this.yaw = dampAngle(this.yaw, angleTo(player.pos, target.pos), 9, dt);
      const big = target.T && target.T.scale > 1.5;
      const want = big ? 0.2 : 0.3;
      this.pitch = damp(this.pitch, want, 5, dt);
      lookY = big ? 1.4 : 0;
    } else if (inp) {
      this.yaw -= inp.lookX;
      this.pitch = clamp(this.pitch + inp.lookY, -0.45, 1.2);
    }

    const big = target && target.T && target.T.scale > 1.5;
    this.aimBlend = damp(this.aimBlend, this.aiming ? 1 : 0, 10, dt);
    this.dist = damp(this.dist, this.aiming ? 2.3 : big ? 6.8 : 4.8, this.aiming ? 10 : 3, dt);
    this.camera.fov = (this.baseFov ?? 60) - 14 * this.aimBlend;
    this.camera.updateProjectionMatrix();
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    // Over-the-right-shoulder offset while aiming the bow.
    const shoulder = this.pivot.clone().add(new THREE.Vector3(-Math.cos(this.yaw), 0.08, Math.sin(this.yaw)).multiplyScalar(0.55 * this.aimBlend));
    const want = shoulder.clone().addScaledVector(dir, -this.dist);
    // Pull the camera in front of walls between it and the player.
    this.ray.set(shoulder, dir.clone().negate());
    this.ray.far = this.dist;
    const hit = this.ray.intersectObjects(this.world.cameraMeshes, false)[0];
    if (hit) want.copy(shoulder).addScaledVector(dir, -Math.max(0.6, hit.distance - 0.3));
    want.y = Math.max(this.world.heightAt(want.x, want.z) + 0.35, want.y);

    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake * 0.35;
    this.camera.position.set(want.x + (Math.random() - 0.5) * s, want.y + (Math.random() - 0.5) * s, want.z + (Math.random() - 0.5) * s);
    this.lookAt.copy(shoulder).addScaledVector(dir, 2);
    this.lookAt.y += lookY;
    this.camera.lookAt(this.lookAt);
  }
}
