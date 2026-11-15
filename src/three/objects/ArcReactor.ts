import * as THREE from 'three';

export class ArcReactorObject {
  public group: THREE.Group;
  private ringOuter: THREE.Mesh;
  private ringMiddle: THREE.Mesh;
  private ringInner: THREE.Mesh;
  private coreMesh: THREE.Mesh;
  private coreAura: THREE.Mesh;
  private coils: THREE.Group;
  private triangleMark: THREE.LineSegments;
  private fluxRays: THREE.Points;
  private exploded: boolean = false;
  private explosionFactor: number = 0;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();

    // Holographic materials
    const holoRingMat = new THREE.MeshStandardMaterial({
      color: colorThemeHex,
      emissive: colorThemeHex,
      emissiveIntensity: 0.8,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
      roughness: 0.2,
      metalness: 0.8
    });

    const glowCoreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });

    const auraMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide
    });

    // 1. Outer Gimbal Ring with Torus geometry
    const outerGeo = new THREE.TorusGeometry(2.4, 0.08, 16, 100);
    this.ringOuter = new THREE.Mesh(outerGeo, holoRingMat);
    this.group.add(this.ringOuter);

    // Outer notched ring
    const notchRingGeo = new THREE.RingGeometry(2.3, 2.55, 36);
    const notchMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });
    const notchMesh = new THREE.Mesh(notchRingGeo, notchMat);
    this.group.add(notchMesh);

    // 2. Middle Counter-Rotating Ring
    const midGeo = new THREE.TorusGeometry(1.7, 0.06, 16, 80);
    this.ringMiddle = new THREE.Mesh(midGeo, holoRingMat.clone());
    this.group.add(this.ringMiddle);

    // 3. Inner Stabilizer Ring
    const innerGeo = new THREE.TorusGeometry(1.1, 0.05, 16, 60);
    this.ringInner = new THREE.Mesh(innerGeo, holoRingMat.clone());
    this.group.add(this.ringInner);

    // 4. Ten Magnetic Energy Coils (arranged symmetrically in circle)
    this.coils = new THREE.Group();
    const coilGeo = new THREE.BoxGeometry(0.24, 0.45, 0.35);
    const coilMat = new THREE.MeshStandardMaterial({
      color: 0x0088cc,
      emissive: colorThemeHex,
      emissiveIntensity: 0.9,
      metalness: 0.9,
      roughness: 0.1
    });

    const numCoils = 10;
    for (let i = 0; i < numCoils; i++) {
      const angle = (i / numCoils) * Math.PI * 2;
      const radius = 1.4;
      const coil = new THREE.Mesh(coilGeo, coilMat);
      coil.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      coil.rotation.z = angle + Math.PI / 2;
      this.coils.add(coil);
    }
    this.group.add(this.coils);

    // 5. Central Plasma Core Cylinder
    const coreGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.3, 32);
    this.coreMesh = new THREE.Mesh(coreGeo, glowCoreMat);
    this.coreMesh.rotation.x = Math.PI / 2;
    this.group.add(this.coreMesh);

    // Central Core Aura
    const auraGeo = new THREE.SphereGeometry(0.85, 32, 32);
    this.coreAura = new THREE.Mesh(auraGeo, auraMat);
    this.group.add(this.coreAura);

    // 6. Iconic Arc Center Inverted Triangle
    const triPts = [
      new THREE.Vector3(0, 0.38, 0.2),
      new THREE.Vector3(0.33, -0.22, 0.2),
      new THREE.Vector3(-0.33, -0.22, 0.2),
      new THREE.Vector3(0, 0.38, 0.2)
    ];
    const triGeo = new THREE.BufferGeometry().setFromPoints(triPts);
    const triMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 3,
      transparent: true,
      opacity: 0.95
    });
    this.triangleMark = new THREE.LineSegments(triGeo, triMat);
    this.group.add(this.triangleMark);

    // 7. Radial Energy Flux Points
    const fluxCount = 200;
    const fluxGeo = new THREE.BufferGeometry();
    const fluxPositions = new Float32Array(fluxCount * 3);
    for (let i = 0; i < fluxCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 1.8;
      fluxPositions[i * 3] = Math.cos(theta) * r;
      fluxPositions[i * 3 + 1] = Math.sin(theta) * r;
      fluxPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    fluxGeo.setAttribute('position', new THREE.BufferAttribute(fluxPositions, 3));
    const fluxMat = new THREE.PointsMaterial({
      color: colorThemeHex,
      size: 0.05,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    this.fluxRays = new THREE.Points(fluxGeo, fluxMat);
    this.group.add(this.fluxRays);
  }

  public setExplodedView(exploded: boolean) {
    this.exploded = exploded;
  }

  public setColorTheme(hex: number) {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.setHex(hex);
          child.material.emissive.setHex(hex);
        } else if (child.material instanceof THREE.MeshBasicMaterial && child !== this.coreMesh) {
          child.material.color.setHex(hex);
        }
      } else if (child instanceof THREE.Points) {
        if (child.material instanceof THREE.PointsMaterial) {
          child.material.color.setHex(hex);
        }
      }
    });
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    // Target explosion offset interpolation
    const targetExp = this.exploded ? 1.0 : 0.0;
    this.explosionFactor += (targetExp - this.explosionFactor) * 0.08;

    // Concentric counter rotations
    this.ringOuter.rotation.z += 0.008 * speedMultiplier;
    this.ringMiddle.rotation.z -= 0.015 * speedMultiplier;
    this.ringInner.rotation.z += 0.025 * speedMultiplier;
    this.coils.rotation.z += 0.005 * speedMultiplier;
    this.triangleMark.rotation.z -= 0.003 * speedMultiplier;
    this.fluxRays.rotation.z += 0.012 * speedMultiplier;

    // Exploded view component displacements along Z
    this.ringOuter.position.z = this.explosionFactor * 0.9;
    this.ringMiddle.position.z = -this.explosionFactor * 0.7;
    this.ringInner.position.z = this.explosionFactor * 0.4;
    this.coils.position.z = -this.explosionFactor * 1.2;

    // Core pulsing animation
    const pulse = 1 + Math.sin(time * 6) * 0.06;
    this.coreAura.scale.set(pulse, pulse, pulse);
    this.coreMesh.scale.set(pulse * 0.98, pulse * 0.98, pulse * 0.98);
  }
}
