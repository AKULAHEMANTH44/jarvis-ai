import * as THREE from 'three';

export class ParticleFieldEffect {
  public points: THREE.Points;
  private count: number;
  private positions: Float32Array;
  private originalPositions: Float32Array;
  private velocities: Float32Array;

  constructor(count = 1200, colorThemeHex = 0x00f0ff) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.originalPositions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 18;
      const y = (Math.random() - 0.5) * 12;
      const z = (Math.random() - 0.5) * 14;

      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;

      this.originalPositions[i * 3] = x;
      this.originalPositions[i * 3 + 1] = y;
      this.originalPositions[i * 3 + 2] = z;

      this.velocities[i * 3] = (Math.random() - 0.5) * 0.05;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.05;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const mat = new THREE.PointsMaterial({
      color: colorThemeHex,
      size: 0.06,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geo, mat);
  }

  public setColorTheme(hex: number) {
    (this.points.material as THREE.PointsMaterial).color.setHex(hex);
  }

  public update(time: number, handCentroid?: { x: number; y: number; z: number }) {
    for (let i = 0; i < this.count; i++) {
      // Gentle idle harmonic drifting
      this.positions[i * 3] = this.originalPositions[i * 3] + Math.sin(time * 0.8 + i) * 0.25;
      this.positions[i * 3 + 1] = this.originalPositions[i * 3 + 1] + Math.cos(time * 0.6 + i * 2) * 0.25;
      this.positions[i * 3 + 2] = this.originalPositions[i * 3 + 2] + Math.sin(time * 0.4 + i * 3) * 0.25;

      // Subtle hand interaction repulsion if hand is nearby
      if (handCentroid) {
        // Map 0..1 hand coords to 3D space: x: -5..5, y: -4..4
        const hx = (handCentroid.x - 0.5) * 10;
        const hy = -(handCentroid.y - 0.5) * 8;
        const dx = this.positions[i * 3] - hx;
        const dy = this.positions[i * 3 + 1] - hy;
        const distSq = dx * dx + dy * dy;
        if (distSq < 4.0 && distSq > 0.01) {
          const force = (2.0 - Math.sqrt(distSq)) * 0.15;
          this.positions[i * 3] += (dx / Math.sqrt(distSq)) * force;
          this.positions[i * 3 + 1] += (dy / Math.sqrt(distSq)) * force;
        }
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
