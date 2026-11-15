import * as THREE from 'three';

export class EnergyShockwaveEffect {
  public group: THREE.Group;
  private ringMesh1: THREE.Mesh;
  private ringMesh2: THREE.Mesh;
  private ringMesh3: THREE.Mesh;
  private sphereMesh: THREE.Mesh;
  private sparkParticles: THREE.Points;
  private sparkPositions: Float32Array;
  private sparkVelocities: THREE.Vector3[] = [];
  private active: boolean = false;
  private progress: number = 0;
  private maxDuration: number = 1.35; // seconds
  private colorHex: number = 0x00f0ff;
  private pointLight: THREE.PointLight;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.colorHex = colorThemeHex;
    this.group = new THREE.Group();
    this.group.visible = false;

    // Ring 1 (Primary high-energy expansion wave)
    const ringGeo1 = new THREE.RingGeometry(0.1, 0.45, 80);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
    this.group.add(this.ringMesh1);

    // Ring 2 (Secondary trailing cyan wave)
    const ringGeo2 = new THREE.RingGeometry(0.1, 0.75, 80);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.ringMesh2 = new THREE.Mesh(ringGeo2, ringMat2);
    this.group.add(this.ringMesh2);

    // Ring 3 (Outer harmonic resonance wave)
    const ringGeo3 = new THREE.RingGeometry(0.08, 0.25, 64);
    const ringMat3 = new THREE.MeshBasicMaterial({
      color: 0x0088ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.ringMesh3 = new THREE.Mesh(ringGeo3, ringMat3);
    this.group.add(this.ringMesh3);

    // Expanding 3D energy bubble
    const sphereGeo = new THREE.SphereGeometry(0.35, 32, 32);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      wireframe: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    this.group.add(this.sphereMesh);

    // Dynamic point light flash
    this.pointLight = new THREE.PointLight(colorThemeHex, 0, 15);
    this.group.add(this.pointLight);

    // Radial Sparks (450 particles)
    const sparkCount = 450;
    const sparkGeo = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      this.sparkVelocities.push(new THREE.Vector3(0, 0, 0));
      this.sparkPositions[i * 3] = 0;
      this.sparkPositions[i * 3 + 1] = 0;
      this.sparkPositions[i * 3 + 2] = 0;
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.14,
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
    this.pointLight.intensity = 4.0;

    // Generate fresh organic radial burst velocities
    const count = this.sparkVelocities.length;
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize();
      const speed = 4.0 + Math.random() * 8.5;
      this.sparkVelocities[i].copy(dir.multiplyScalar(speed));

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
    this.pointLight.color.setHex(hex);
  }

  public update(deltaSeconds: number) {
    if (!this.active) return;

    this.progress += deltaSeconds / this.maxDuration;
    if (this.progress >= 1.0) {
      this.active = false;
      this.group.visible = false;
      this.pointLight.intensity = 0;
      return;
    }

    // Cubic ease-out
    const easeOut = 1 - Math.pow(1 - this.progress, 3);
    const alpha = Math.max(0, 1 - this.progress);

    // Expand primary ring
    const ringScale1 = 0.5 + easeOut * 14.0;
    this.ringMesh1.scale.set(ringScale1, ringScale1, ringScale1);
    (this.ringMesh1.material as THREE.MeshBasicMaterial).opacity = alpha * 0.95;

    // Expand secondary ring
    const ringScale2 = 0.3 + easeOut * 10.0;
    this.ringMesh2.scale.set(ringScale2, ringScale2, ringScale2);
    (this.ringMesh2.material as THREE.MeshBasicMaterial).opacity = alpha * 0.75;

    // Expand outer ring
    const ringScale3 = 0.2 + easeOut * 18.0;
    this.ringMesh3.scale.set(ringScale3, ringScale3, ringScale3);
    (this.ringMesh3.material as THREE.MeshBasicMaterial).opacity = alpha * 0.45;

    // Expand energy bubble
    const sphereScale = 0.5 + easeOut * 8.5;
    this.sphereMesh.scale.set(sphereScale, sphereScale, sphereScale);
    (this.sphereMesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.6;

    // Light flash decay
    this.pointLight.intensity = Math.max(0, (1 - this.progress * 1.5) * 4.0);

    // Radiate sparks with drag deceleration (air resistance)
    const count = this.sparkVelocities.length;
    const drag = Math.pow(0.92, deltaSeconds * 60);
    for (let i = 0; i < count; i++) {
      const vel = this.sparkVelocities[i];
      vel.multiplyScalar(drag);
      this.sparkPositions[i * 3] += vel.x * deltaSeconds;
      this.sparkPositions[i * 3 + 1] += vel.y * deltaSeconds;
      this.sparkPositions[i * 3 + 2] += vel.z * deltaSeconds;
    }
    this.sparkParticles.geometry.attributes.position.needsUpdate = true;
    (this.sparkParticles.material as THREE.PointsMaterial).opacity = alpha * 0.95;
  }
}
