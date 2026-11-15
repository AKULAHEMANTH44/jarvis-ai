import * as THREE from 'three';

export class IronManArmorObject {
  public group: THREE.Group;
  private facePlate: THREE.Group;
  private jawPlate: THREE.Group;
  private craniumPlate: THREE.Group;
  private eyeLeft: THREE.Mesh;
  private eyeRight: THREE.Mesh;
  private scanLaser: THREE.Line;
  private scanY: number = 0;
  private exploded: boolean = false;
  private explosionFactor: number = 0;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();

    const wireMat = new THREE.MeshStandardMaterial({
      color: colorThemeHex,
      emissive: colorThemeHex,
      emissiveIntensity: 0.7,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });

    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending
    });

    // 1. Cranium / Helmet Top Dome
    this.craniumPlate = new THREE.Group();
    const craniumGeo = new THREE.SphereGeometry(1.4, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.65);
    const craniumMesh = new THREE.Mesh(craniumGeo, wireMat);
    craniumMesh.position.y = 0.2;
    this.craniumPlate.add(craniumMesh);
    this.group.add(this.craniumPlate);

    // 2. Faceplate
    this.facePlate = new THREE.Group();
    const browGeo = new THREE.BoxGeometry(1.6, 0.4, 0.9);
    const browMesh = new THREE.Mesh(browGeo, wireMat);
    browMesh.position.set(0, 0.35, 0.8);
    this.facePlate.add(browMesh);

    const cheekL = new THREE.BoxGeometry(0.45, 0.8, 0.7);
    const cheekR = cheekL.clone();
    const cheekMeshL = new THREE.Mesh(cheekL, wireMat);
    const cheekMeshR = new THREE.Mesh(cheekR, wireMat);
    cheekMeshL.position.set(-0.75, -0.2, 0.7);
    cheekMeshR.position.set(0.75, -0.2, 0.7);
    this.facePlate.add(cheekMeshL);
    this.facePlate.add(cheekMeshR);
    this.group.add(this.facePlate);

    // 3. Eyes (Iconic angular slits)
    const eyeGeo = new THREE.BoxGeometry(0.38, 0.1, 0.15);
    this.eyeLeft = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeRight = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeLeft.position.set(-0.45, 0.22, 1.15);
    this.eyeLeft.rotation.z = -0.15;
    this.eyeRight.position.set(0.45, 0.22, 1.15);
    this.eyeRight.rotation.z = 0.15;
    this.group.add(this.eyeLeft);
    this.group.add(this.eyeRight);

    // 4. Jaw / Chin Plate
    this.jawPlate = new THREE.Group();
    const chinGeo = new THREE.CylinderGeometry(0.5, 0.85, 0.9, 8);
    const chinMesh = new THREE.Mesh(chinGeo, wireMat);
    chinMesh.position.set(0, -0.75, 0.6);
    this.jawPlate.add(chinMesh);
    this.group.add(this.jawPlate);

    // 5. Cybernetic Scanning Laser Plane
    const scanPts = [
      new THREE.Vector3(-1.8, 0, 1.3),
      new THREE.Vector3(1.8, 0, 1.3)
    ];
    const scanGeo = new THREE.BufferGeometry().setFromPoints(scanPts);
    const scanMat = new THREE.LineBasicMaterial({
      color: 0xff3344, // Red targeting beam or match theme
      linewidth: 3,
      transparent: true,
      opacity: 0.9
    });
    this.scanLaser = new THREE.Line(scanGeo, scanMat);
    this.group.add(this.scanLaser);
  }

  public setExplodedView(exploded: boolean) {
    this.exploded = exploded;
  }

  public setColorTheme(hex: number) {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh && child !== this.eyeLeft && child !== this.eyeRight) {
        if (child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.setHex(hex);
          child.material.emissive.setHex(hex);
        }
      }
    });
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const targetExp = this.exploded ? 1.0 : 0.0;
    this.explosionFactor += (targetExp - this.explosionFactor) * 0.08;

    // Subtle idle scanning sway
    this.group.rotation.y = Math.sin(time * 0.8) * 0.35 * speedMultiplier;

    // Laser vertical scan loop
    this.scanY = Math.sin(time * 2.5) * 1.1;
    this.scanLaser.position.y = this.scanY;

    // Eye glow pulse
    const eyeIntensity = 0.8 + Math.sin(time * 8) * 0.2;
    (this.eyeLeft.material as THREE.MeshBasicMaterial).opacity = eyeIntensity;
    (this.eyeRight.material as THREE.MeshBasicMaterial).opacity = eyeIntensity;

    // Exploded View Assembly
    this.craniumPlate.position.y = 0.2 + this.explosionFactor * 0.9;
    this.facePlate.position.z = this.explosionFactor * 0.95;
    this.jawPlate.position.y = -this.explosionFactor * 0.8;
  }
}
