import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import type { PersonInstance, PersonLibrary } from '../core/Loader';
import type { GameAudio } from '../core/Audio';
import { HealthBar3D } from '../ui/HealthBar3D';
import { HOSTILE_CAMP } from '../world/SurvivalSites';
import { makeTracer } from './fx';

interface Guard {
  id: string; home: THREE.Vector3; body: RAPIER.RigidBody; collider: RAPIER.Collider; person: PersonInstance;
  hp: number; dead: boolean; alerted: boolean; cooldown: number; spotted: number; shots: number; phase: number;
  previous: THREE.Vector3; yaw: number; action: THREE.AnimationAction | null; clip: string; bar: HealthBar3D;
}

export class HostileCamp {
  private enabled = true;
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const g of this.guards) { g.body.setEnabled(false); g.person.root.visible = false; g.bar.hide(); }
  }
  private readonly guards: Guard[] = [];
  private readonly physics: Physics;
  private readonly scene: THREE.Scene;
  private readonly audio: GameAudio;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private readonly target = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly tracers: Array<{ mesh: THREE.Mesh; life: number }> = [];
  onPlayerHit: ((amount: number) => void) | null = null;
  onDefeated: ((id: string, position: THREE.Vector3, cleared: boolean) => void) | null = null;

  constructor(scene: THREE.Scene, physics: Physics, library: PersonLibrary, audio: GameAudio) {
    this.physics = physics; this.scene = scene; this.audio = audio;
    for (const [i, x, z] of [[0,172,-56],[1,181,-61],[2,181,-51]]) {
      const person = library.spawn('adventurer'); person.root.visible = false; scene.add(person.root);
      person.root.getObjectByName('Backpack')!.visible = false;
      person.root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        const change = (material: THREE.Material) => {
          if (!(material instanceof THREE.MeshStandardMaterial) || !/Green/.test(material.name)) return material;
          const copy = material.clone(); copy.color.setHex(0x824c42); copy.roughness = .9; return copy;
        };
        o.material = Array.isArray(o.material) ? o.material.map(change) : change(o.material);
      });
      const gun = new THREE.Mesh(new THREE.BoxGeometry(.065, .09, .3), new THREE.MeshStandardMaterial({ color: 0x242d30 }));
      gun.rotation.x = Math.PI / 2; gun.position.y = .08; person.handSlotR?.add(gun);
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().lockRotations().setTranslation(x!, 1, z!).setLinearDamping(.3).setCcdEnabled(true));
      const collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(.55, .32).setMass(70).setFriction(.4), body);
      body.setEnabled(false);
      this.guards.push({ id: `camp:${i}`, home: new THREE.Vector3(x, 1, z), body, collider, person, hp: 70, dead: false,
        alerted: false, cooldown: 1.5, spotted: 0, shots: 0, phase: i! * 2, previous: new THREE.Vector3(x, 1, z), yaw: 0,
        action: null, clip: '', bar: new HealthBar3D(scene) });
    }
  }

  defeatedIds(): string[] { return this.guards.filter(g => g.dead).map(g => g.id); }
  restoreDefeated(ids: string[]): void {
    for (const g of this.guards) if (ids.includes(g.id)) { g.dead = true; g.hp = 0; g.body.setEnabled(false); g.person.root.visible = false; }
  }

  private canSee(g: Guard, player: THREE.Vector3, targetBody: RAPIER.RigidBody): boolean {
    const p = g.body.translation(); const dx = player.x - p.x, dy = player.y + .25 - (p.y + .45), dz = player.z - p.z;
    const distance = Math.hypot(dx, dy, dz); if (distance < .01) return false;
    Object.assign(this.ray.origin, { x: p.x, y: p.y + .45, z: p.z });
    Object.assign(this.ray.dir, { x: dx / distance, y: dy / distance, z: dz / distance });
    const hit = this.physics.world.castRay(this.ray, distance, true, undefined, undefined, g.collider, g.body);
    return !hit || hit.collider.parent()?.handle === targetBody.handle;
  }

  fixedUpdate(dt: number, player: THREE.Vector3, targetBody: RAPIER.RigidBody, canAttack: boolean): void {
    if (!this.enabled) return;
    for (const g of this.guards) {
      const near = Math.hypot(player.x - g.home.x, player.z - g.home.z) < 85;
      if (g.body.isEnabled() !== (near && !g.dead)) g.body.setEnabled(near && !g.dead);
      if (g.dead || !near) continue;
      const p = g.body.translation(), v = g.body.linvel(); g.previous.set(p.x, p.y, p.z);
      g.phase += dt * .4; g.cooldown -= dt;
      const distance = Math.hypot(player.x - p.x, player.y - p.y, player.z - p.z);
      const inside = Math.hypot(player.x - HOSTILE_CAMP.x, player.z - HOSTILE_CAMP.z) < 32;
      const sees = canAttack && inside && distance < 24 && this.canSee(g, player, targetBody);
      g.spotted = sees ? g.spotted + dt : Math.max(0, g.spotted - dt * 2);
      g.alerted = g.spotted > .6 || (g.alerted && canAttack && inside && distance < 30);
      this.target.set(g.home.x + Math.sin(g.phase) * 2, g.home.y, g.home.z + Math.cos(g.phase) * 2);
      let moving = true;
      if (g.alerted && canAttack && inside) {
        if (sees && distance < 17) moving = false;
        else this.target.copy(player);
      }
      let dx = this.target.x - p.x, dz = this.target.z - p.z, length = Math.hypot(dx, dz);
      if (!moving) { dx = player.x - p.x; dz = player.z - p.z; length = Math.hypot(dx, dz); }
      const yaw = Math.atan2(-dx, -dz); g.yaw += Math.atan2(Math.sin(yaw - g.yaw), Math.cos(yaw - g.yaw)) * (1 - Math.exp(-8 * dt));
      let vx = moving && length > .6 ? dx / length * (g.alerted ? 2.6 : 1.1) : 0;
      let vz = moving && length > .6 ? dz / length * (g.alerted ? 2.6 : 1.1) : 0;
      // Look ahead at waist height, then flank an obstacle instead of pushing through it.
      if (Math.hypot(vx, vz) > 0) {
        Object.assign(this.ray.origin, { x: p.x, y: p.y, z: p.z });
        const speed = Math.hypot(vx, vz); Object.assign(this.ray.dir, { x: vx / speed, y: 0, z: vz / speed });
        if (this.physics.world.castRay(this.ray, 1.3, true, RAPIER.QueryFilterFlags.ONLY_FIXED)) { const old = vx; vx = -vz; vz = old; }
      }
      // Patrols never chase into the river or beyond their local encounter.
      if (p.x + vx * dt < 163 || p.x + vx * dt > 190 || p.z + vz * dt < -73 || p.z + vz * dt > -40) vx = vz = 0;
      g.body.setLinvel({ x: vx, y: v.y, z: vz }, true);
      const clip = moving ? 'Walking_A' : '1H_Ranged_Aiming'; this.play(g, clip);
      if (g.alerted && sees && distance < 17 && g.spotted > 1.1 && g.cooldown <= 0) {
        g.cooldown = 1.7 + Number(g.id.at(-1)) * .17; g.shots++;
        this.from.set(p.x, p.y + .45, p.z); this.to.copy(player).y += .25;
        if (g.shots % 2 === 1) this.to.x += 1.2; // First shot warns; subsequent hits remain line-of-sight checked.
        const tracer = makeTracer(this.from, this.to); this.scene.add(tracer); this.tracers.push({ mesh: tracer, life: .09 });
        this.audio.gunshot(false); if (g.shots % 2 === 0) this.onPlayerHit?.(8);
      }
    }
  }

  private play(g: Guard, clip: string): void {
    if (g.clip === clip) return; const action = g.person.actions.get(clip); if (!action) return;
    g.action?.fadeOut(.18); action.reset().fadeIn(.18).play(); g.action = action; g.clip = clip;
  }

  update(dt: number, alpha: number, player: THREE.Vector3): void {
    if (!this.enabled) return;
    for (const g of this.guards) {
      const visible = g.body.isEnabled() && !g.dead; g.person.root.visible = visible;
      const p = g.body.translation();
      if (visible) {
        g.person.root.position.lerpVectors(g.previous, this.from.set(p.x, p.y, p.z), alpha).y -= .87;
        g.person.root.rotation.y = g.yaw; g.person.mixer.update(dt);
      }
      g.bar.update(p.x, p.y + 1.1, p.z, g.hp / 70, visible, player);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!; t.life -= dt;
      if (t.life <= 0) { this.scene.remove(t.mesh); this.tracers.splice(i, 1); }
    }
  }

  applyDamage(body: RAPIER.RigidBody, amount: number): boolean {
    if (!this.enabled) return false;
    const g = this.guards.find(guard => guard.body.handle === body.handle); if (!g) return false;
    if (g.dead) return true;
    g.hp = Math.max(0, g.hp - amount); g.alerted = true;
    if (g.hp === 0) {
      g.dead = true; g.body.setEnabled(false); g.person.root.visible = false;
      const p = g.body.translation(); this.onDefeated?.(g.id, new THREE.Vector3(p.x, p.y, p.z), this.guards.every(guard => guard.dead));
    }
    return true;
  }

  explosion(x: number, y: number, z: number): void {
    if (!this.enabled) return;
    for (const g of this.guards) if (!g.dead) {
      const p = g.body.translation(), distance = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (distance < 8) this.applyDamage(g.body, 100 * (1 - distance / 8));
    }
  }

  forEachGuard(cb: (x: number, z: number) => void): void {
    if (!this.enabled) return;
    for (const g of this.guards) if (!g.dead) { const p = g.body.translation(); cb(p.x, p.z); }
  }
}
