import * as THREE from 'three';

export class ParticleFieldEffect {
  public points: THREE.Points;
  private count: number;
  private maxCount: number = 5000;
  private positions: Float32Array;
  private originalPositions: Float32Array;
  private velocities: Float32Array;

  constructor(count = 1500, colorThemeHex = 0x00f0ff) {
    this.count = Math.max(200, Math.min(this.maxCount, count));
    this.positions = new Float32Array(this.maxCount * 3);
    this.originalPositions = new Float32Array(this.maxCount * 3);
    this.velocities = new Float32Array(this.maxCount * 3);

    for (let i = 0; i < this.maxCount; i++) {
      const x = (Math.random() - 0.5) * 20;
      const y = (Math.random() - 0.5) * 14;
      const z = (Math.random() - 0.5) * 16;

      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;

      this.originalPositions[i * 3] = x;
      this.originalPositions[i * 3 + 1] = y;
      this.originalPositions[i * 3 + 2] = z;

      this.velocities[i * 3] = (Math.random() - 0.5) * 0.04;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.04;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, this.count);

    const mat = new THREE.PointsMaterial({
      color: colorThemeHex,
      size: 0.07,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geo, mat);
  }

  public setParticleCount(newCount: number) {
    this.count = Math.max(200, Math.min(this.maxCount, Math.round(newCount)));
    this.points.geometry.setDrawRange(0, this.count);
  }

  public setGlowIntensity(intensity: number) {
    const mat = this.points.material as THREE.PointsMaterial;
    mat.opacity = Math.min(1.0, 0.45 * intensity);
    mat.size = 0.05 + intensity * 0.015;
  }

  public setColorTheme(hex: number) {
    (this.points.material as THREE.PointsMaterial).color.setHex(hex);
  }

  public update(time: number, handCentroid?: { x: number; y: number; z: number }) {
    for (let i = 0; i < this.count; i++) {
      // Harmonic idle floating
      const ox = this.originalPositions[i * 3];
      const oy = this.originalPositions[i * 3 + 1];
      const oz = this.originalPositions[i * 3 + 2];

      let targetX = ox + Math.sin(time * 0.7 + i * 0.5) * 0.35;
      let targetY = oy + Math.cos(time * 0.5 + i * 0.7) * 0.35;
      let targetZ = oz + Math.sin(time * 0.3 + i * 1.1) * 0.35;

      // Real-time hand proximity displacement (parting effect)
      if (handCentroid) {
        const hx = (handCentroid.x - 0.5) * 12;
        const hy = -(handCentroid.y - 0.5) * 9;
        const hz = (handCentroid.z || 0) * 8;

        const dx = targetX - hx;
        const dy = targetY - hy;
        const dz = targetZ - hz;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < 6.0 && distSq > 0.04) {
          const dist = Math.sqrt(distSq);
          const force = (2.45 - dist) * 0.28;
          targetX += (dx / dist) * force;
          targetY += (dy / dist) * force;
          targetZ += (dz / dist) * force;
        }
      }

      // Smooth interpolation towards target position
      this.positions[i * 3] += (targetX - this.positions[i * 3]) * 0.1;
      this.positions[i * 3 + 1] += (targetY - this.positions[i * 3 + 1]) * 0.1;
      this.positions[i * 3 + 2] += (targetZ - this.positions[i * 3 + 2]) * 0.1;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
