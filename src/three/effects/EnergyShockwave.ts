import * as THREE from 'three';

export class EnergyShockwaveEffect {
  public group: THREE.Group;
  private ringMesh1: THREE.Mesh;
  private ringMesh2: THREE.Mesh;
  private sphereMesh: THREE.Mesh;
  private sparkParticles: THREE.Points;
  private sparkPositions: Float32Array;
  private sparkVelocities: THREE.Vector3[] = [];
  private active: boolean = false;
  private progress: number = 0;
  private maxDuration: number = 1.2; // seconds
  private colorHex: number = 0x00f0ff;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.colorHex = colorThemeHex;
    this.group = new THREE.Group();
    this.group.visible = false;

    // Ring 1 (Radial expanding wave)
    const ringGeo1 = new THREE.RingGeometry(0.1, 0.4, 64);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
    this.group.add(this.ringMesh1);

    // Ring 2 (Secondary trailing wave)
    const ringGeo2 = new THREE.RingGeometry(0.1, 0.6, 64);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.ringMesh2 = new THREE.Mesh(ringGeo2, ringMat2);
    this.group.add(this.ringMesh2);

    // Expanding energy bubble
    const sphereGeo = new THREE.SphereGeometry(0.3, 32, 32);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      wireframe: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    this.group.add(this.sphereMesh);

    // Radial Sparks
    const sparkCount = 300;
    const sparkGeo = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize();
      const speed = 3.5 + Math.random() * 6.0;
      this.sparkVelocities.push(dir.multiplyScalar(speed));
      this.sparkPositions[i * 3] = 0;
      this.sparkPositions[i * 3 + 1] = 0;
      this.sparkPositions[i * 3 + 2] = 0;
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.12,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.sparkParticles = new THREE.Points(sparkGeo, sparkMat);
    this.group.add(this.sparkParticles);
  }

  public trigger(origin = new THREE.Vector3(0, 0, 0)) {
    this.group.position.copy(origin);
    this.progress = 0;
    this.active = true;
    this.group.visible = true;

    // Reset spark positions
    for (let i = 0; i < this.sparkVelocities.length; i++) {
      this.sparkPositions[i * 3] = 0;
      this.sparkPositions[i * 3 + 1] = 0;
      this.sparkPositions[i * 3 + 2] = 0;
    }
    this.sparkParticles.geometry.attributes.position.needsUpdate = true;
  }

  public setColorTheme(hex: number) {
    this.colorHex = hex;
    (this.ringMesh2.material as THREE.MeshBasicMaterial).color.setHex(hex);
    (this.sphereMesh.material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  public update(deltaSeconds: number) {
    if (!this.active) return;

    this.progress += deltaSeconds / this.maxDuration;
    if (this.progress >= 1.0) {
      this.active = false;
      this.group.visible = false;
      return;
    }

    const easeOut = 1 - Math.pow(1 - this.progress, 3);
    const alpha = Math.max(0, 1 - this.progress);

    // Expand rings
    const ringScale1 = 0.5 + easeOut * 12.0;
    this.ringMesh1.scale.set(ringScale1, ringScale1, ringScale1);
    (this.ringMesh1.material as THREE.MeshBasicMaterial).opacity = alpha * 0.9;

    const ringScale2 = 0.2 + easeOut * 8.5;
    this.ringMesh2.scale.set(ringScale2, ringScale2, ringScale2);
    (this.ringMesh2.material as THREE.MeshBasicMaterial).opacity = alpha * 0.7;

    // Expand energy bubble
    const sphereScale = 0.5 + easeOut * 7.0;
    this.sphereMesh.scale.set(sphereScale, sphereScale, sphereScale);
    (this.sphereMesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.5;

    // Radiate sparks
    const count = this.sparkVelocities.length;
    for (let i = 0; i < count; i++) {
      const vel = this.sparkVelocities[i];
      this.sparkPositions[i * 3] += vel.x * deltaSeconds;
      this.sparkPositions[i * 3 + 1] += vel.y * deltaSeconds;
      this.sparkPositions[i * 3 + 2] += vel.z * deltaSeconds;
    }
    this.sparkParticles.geometry.attributes.position.needsUpdate = true;
    (this.sparkParticles.material as THREE.PointsMaterial).opacity = alpha * 0.95;
  }
}
