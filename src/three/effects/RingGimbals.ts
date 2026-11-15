import * as THREE from 'three';

export class RingGimbalsEffect {
  public group: THREE.Group;
  private ringA: THREE.Mesh;
  private ringB: THREE.Mesh;
  private ringC: THREE.Mesh;
  private ringD: THREE.Mesh;
  private orbitalTicks: THREE.LineSegments;
  private orbitalParticles: THREE.Points;
  private crosshairH: THREE.Line;
  private crosshairV: THREE.Line;

  private isListening: boolean = false;
  private isSpeaking: boolean = false;
  private energyBoost: number = 0;

  constructor(colorThemeHex = 0x00f0ff) {
    this.group = new THREE.Group();

    // 1. Concentric Ring A (Outer depth halo)
    const geoA = new THREE.RingGeometry(3.6, 3.64, 96);
    const matA = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });
    this.ringA = new THREE.Mesh(geoA, matA);
    this.ringA.position.z = -0.35;
    this.group.add(this.ringA);

    // 2. Ring B (Segmented arc ring)
    const geoB = new THREE.RingGeometry(3.1, 3.16, 64, 1, 0, Math.PI * 1.6);
    const matB = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.42
    });
    this.ringB = new THREE.Mesh(geoB, matB);
    this.ringB.position.z = -0.18;
    this.group.add(this.ringB);

    // 3. Ring C (Inner gauge ring)
    const geoC = new THREE.RingGeometry(2.7, 2.73, 72);
    const matC = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.32
    });
    this.ringC = new THREE.Mesh(geoC, matC);
    this.ringC.position.z = 0.08;
    this.group.add(this.ringC);

    // 4. Ring D (Deep inner core resonance ring)
    const geoD = new THREE.RingGeometry(2.25, 2.29, 48, 1, 0, Math.PI * 1.25);
    const matD = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.36
    });
    this.ringD = new THREE.Mesh(geoD, matD);
    this.ringD.position.z = 0.22;
    this.group.add(this.ringD);

    // 5. Azimuthal Calibration Tick Marks
    const tickPoints: THREE.Vector3[] = [];
    const tickCount = 48;
    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2;
      const rIn = i % 4 === 0 ? 3.28 : 3.38;
      const rOut = 3.5;
      tickPoints.push(
        new THREE.Vector3(Math.cos(a) * rIn, Math.sin(a) * rIn, -0.1),
        new THREE.Vector3(Math.cos(a) * rOut, Math.sin(a) * rOut, -0.1)
      );
    }
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPoints);
    const tickMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.45
    });
    this.orbitalTicks = new THREE.LineSegments(tickGeo, tickMat);
    this.group.add(this.orbitalTicks);

    // 6. Orbital Core Particles
    const orbCount = 72;
    const orbPos = new Float32Array(orbCount * 3);
    for (let i = 0; i < orbCount; i++) {
      const a = (i / orbCount) * Math.PI * 2;
      const r = 2.45 + (i % 3) * 0.42;
      orbPos[i * 3] = Math.cos(a) * r;
      orbPos[i * 3 + 1] = Math.sin(a) * r;
      orbPos[i * 3 + 2] = Math.sin(a * 3) * 0.28;
    }
    const orbGeo = new THREE.BufferGeometry();
    orbGeo.setAttribute('position', new THREE.BufferAttribute(orbPos, 3));
    const orbMat = new THREE.PointsMaterial({
      color: colorThemeHex,
      size: 0.055,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });
    this.orbitalParticles = new THREE.Points(orbGeo, orbMat);
    this.group.add(this.orbitalParticles);

    // Subtle crosshairs
    const ptsH = [new THREE.Vector3(-4.2, 0, -0.2), new THREE.Vector3(4.2, 0, -0.2)];
    const geoH = new THREE.BufferGeometry().setFromPoints(ptsH);
    const lineMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.2
    });
    this.crosshairH = new THREE.Line(geoH, lineMat);
    this.group.add(this.crosshairH);

    const ptsV = [new THREE.Vector3(0, -4.2, -0.2), new THREE.Vector3(0, 4.2, -0.2)];
    const geoV = new THREE.BufferGeometry().setFromPoints(ptsV);
    this.crosshairV = new THREE.Line(geoV, lineMat.clone());
    this.group.add(this.crosshairV);
  }

  public setCoreActivity(activity: { isListening?: boolean; isSpeaking?: boolean; energyBoost?: number }) {
    if (activity.isListening !== undefined) this.isListening = activity.isListening;
    if (activity.isSpeaking !== undefined) this.isSpeaking = activity.isSpeaking;
    if (activity.energyBoost !== undefined) this.energyBoost = Math.max(0, activity.energyBoost);
  }

  public setColorTheme(hex: number) {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).color.setHex(hex);
      } else if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        (child.material as THREE.LineBasicMaterial).color.setHex(hex);
      } else if (child instanceof THREE.Points) {
        (child.material as THREE.PointsMaterial).color.setHex(hex);
      }
    });
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    this.energyBoost = Math.max(0, this.energyBoost - 0.015);

    const stateMult =
      1.0 +
      (this.isListening ? 0.65 : 0) +
      (this.isSpeaking ? 1.15 : 0) +
      this.energyBoost * 2.2;

    const effective = speedMultiplier * stateMult;

    this.ringA.rotation.z += 0.003 * effective;
    this.ringB.rotation.z -= 0.007 * effective;
    this.ringC.rotation.z += 0.005 * effective;
    this.ringD.rotation.z -= 0.009 * effective;
    this.orbitalTicks.rotation.z += 0.002 * effective;
    this.orbitalParticles.rotation.z -= 0.006 * effective;

    // Reactive harmonic breathing pulse when listening or speaking
    const amp = this.isSpeaking ? 0.045 : this.isListening ? 0.025 : 0.008;
    const freq = this.isSpeaking ? 8.0 : this.isListening ? 4.5 : 1.5;
    const pulse = 1 + Math.sin(time * freq) * amp + this.energyBoost * 0.04;
    this.ringD.scale.set(pulse, pulse, 1);
    this.ringC.scale.set(1 + (pulse - 1) * 0.6, 1 + (pulse - 1) * 0.6, 1);

    const targetOpacityBoost = this.isSpeaking ? 0.32 : this.isListening ? 0.18 : 0;
    (this.ringB.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, 0.42 + targetOpacityBoost);
    (this.ringD.material as THREE.MeshBasicMaterial).opacity = Math.min(0.95, 0.36 + targetOpacityBoost * 1.1);
  }
}
