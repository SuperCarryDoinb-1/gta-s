import * as THREE from 'three';
import type { Vehicle } from '../entities/Vehicle';

export class FlightInstruments {
  private readonly root = document.createElement('aside');
  private readonly attitude: HTMLElement;
  private readonly height: HTMLElement;
  private readonly climb: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly power: HTMLElement;
  private readonly angles = new THREE.Euler(0, 0, 0, 'YXZ');
  private refresh = 0;

  constructor() {
    this.root.id = 'flight-instruments'; this.root.hidden = true;
    this.root.setAttribute('aria-label', '直升机飞行仪表');
    this.root.innerHTML = '<small>HELICOPTER / 飞行仪表</small><div class="flight-attitude"><div class="flight-horizon"></div><span>— ┼ —</span></div><dl><dt>高度</dt><dd data-height></dd><dt>升降速</dt><dd data-climb></dd><dt>航向</dt><dd data-heading></dd><dt>旋翼</dt><dd data-power></dd></dl>';
    this.attitude = this.root.querySelector('.flight-horizon')!;
    this.height = this.root.querySelector('[data-height]')!; this.climb = this.root.querySelector('[data-climb]')!;
    this.heading = this.root.querySelector('[data-heading]')!; this.power = this.root.querySelector('[data-power]')!;
    document.body.append(this.root);
  }

  update(dt: number, aircraft: Vehicle | null): void {
    this.root.hidden = !aircraft;
    if (!aircraft) return;
    this.angles.setFromQuaternion(aircraft.mesh.quaternion, 'YXZ');
    this.attitude.style.transform = `translateY(${this.angles.x * 50}px) rotate(${this.angles.z}rad)`;
    this.refresh -= dt;
    if (this.refresh > 0) return;
    this.refresh = .1;
    const position = aircraft.chassisBody.translation(), v = aircraft.chassisBody.linvel();
    this.height.textContent = `${Math.max(0, position.y).toFixed(1)} m`;
    this.climb.textContent = `${v.y >= 0 ? '+' : ''}${v.y.toFixed(1)} m/s`;
    this.heading.textContent = `${((180 - aircraft.visualHeadingYaw * 180 / Math.PI + 360) % 360).toFixed(0).padStart(3, '0')}°`;
    this.power.textContent = `${Math.round(aircraft.flight.rotorSpeed * 100)}%`;
  }
}
