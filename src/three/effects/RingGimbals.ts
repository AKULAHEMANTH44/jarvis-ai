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
  private ambientAttenuation: number = 1.0;

  constructor(colorThemeHex = 0x00f0ff) {
    this.group = new THREE.Group();

    const geoA = new THREE.RingGeometry(3.75, 3.78, 96);
    const matA = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.ringA = new THREE.Mesh(geoA, matA);
    this.ringA.position.z = -0.45;
    this.group.add(this.ringA);

    const geoB = new THREE.RingGeometry(3.25, 3.3, 64, 1, 0, Math.PI * 1.6);
    const matB = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.ringB = new THREE.Mesh(geoB, matB);
    this.ringB.position.z = -0.25;
    this.group.add(this.ringB);

    const geoC = new THREE.RingGeometry(2.85, 2.88, 72);
    const matC = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.ringC = new THREE.Mesh(geoC, matC);
    this.ringC.position.z = 0.05;
    this.group.add(this.ringC);

    const geoD = new THREE.RingGeometry(2.38, 2.41, 48, 1, 0, Math.PI * 1.25);
    const matD = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.ringD = new THREE.Mesh(geoD, matD);
    this.ringD.position.z = 0.18;
    this.group.add(this.ringD);

    const tickPoints: THREE.Vector3[] = [];
    const tickCount = 48;
    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2;
      const rIn = i % 4 === 0 ? 3.42 : 3.52;
      const rOut = 3.64;
      tickPoints.push(
        new THREE.Vector3(Math.cos(a) * rIn, Math.sin(a) * rIn, -0.2),
        new THREE.Vector3(Math.cos(a) * rOut, Math.sin(a) * rOut, -0.2)
      );
    }
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPoints);
    const tickMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending
    });
    this.orbitalTicks = new THREE.LineSegments(tickGeo, tickMat);
    this.group.add(this.orbitalTicks);

    const orbCount = 72;
    const orbPos = new Float32Array(orbCount * 3);
    for (let i = 0; i < orbCount; i++) {
      const a = (i / orbCount) * Math.PI * 2;
      const r = 2.6 + (i % 3) * 0.45;
      orbPos[i * 3] = Math.cos(a) * r;
      orbPos[i * 3 + 1] = Math.sin(a) * r;
      orbPos[i * 3 + 2] = Math.sin(a * 3) * 0.28;
    }
    const orbGeo = new THREE.BufferGeometry();
    orbGeo.setAttribute('position', new THREE.BufferAttribute(orbPos, 3));
    const orbMat = new THREE.PointsMaterial({
      color: colorThemeHex,
      size: 0.05,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending
    });
    this.orbitalParticles = new THREE.Points(orbGeo, orbMat);
    this.group.add(this.orbitalParticles);

    const ptsH = [new THREE.Vector3(-4.4, 0, -0.35), new THREE.Vector3(4.4, 0, -0.35)];
    const geoH = new THREE.BufferGeometry().setFromPoints(ptsH);
    const lineMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.14
    });
    this.crosshairH = new THREE.Line(geoH, lineMat);
    this.group.add(this.crosshairH);

    const ptsV = [new THREE.Vector3(0, -4.4, -0.35), new THREE.Vector3(0, 4.4, -0.35)];
    const geoV = new THREE.BufferGeometry().setFromPoints(ptsV);
    this.crosshairV = new THREE.Line(geoV, lineMat.clone());
    this.group.add(this.crosshairV);
  }

  public setVisionSphereActive(active: boolean) {
    // When VisionSphereObject owns the hero orbital architecture, keep ambient background calibration subtle
    this.ambientAttenuation = active ? 0.22 : 1.0;
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

    const amp = this.isSpeaking ? 0.045 : this.isListening ? 0.025 : 0.008;
    const freq = this.isSpeaking ? 8.0 : this.isListening ? 4.5 : 1.5;
    const pulse = 1 + Math.sin(time * freq) * amp + this.energyBoost * 0.04;
    this.ringD.scale.set(pulse, pulse, 1);
    this.ringC.scale.set(1 + (pulse - 1) * 0.6, 1 + (pulse - 1) * 0.6, 1);

    const att = this.ambientAttenuation;
    const targetOpacityBoost = this.isSpeaking ? 0.28 : this.isListening ? 0.16 : 0;
    (this.ringA.material as THREE.MeshBasicMaterial).opacity = 0.28 * att;
    (this.ringB.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, (0.34 + targetOpacityBoost) * att);
    (this.ringC.material as THREE.MeshBasicMaterial).opacity = 0.26 * att;
    (this.ringD.material as THREE.MeshBasicMaterial).opacity = Math.min(0.95, (0.3 + targetOpacityBoost * 1.1) * att);
    (this.orbitalTicks.material as THREE.LineBasicMaterial).opacity = 0.36 * att;
    (this.orbitalParticles.material as THREE.PointsMaterial).opacity = 0.55 * att;
    (this.crosshairH.material as THREE.LineBasicMaterial).opacity = 0.14 * att;
    (this.crosshairV.material as THREE.LineBasicMaterial).opacity = 0.14 * att;
  }

  public dispose() {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose();
      }
    });
  }
}
