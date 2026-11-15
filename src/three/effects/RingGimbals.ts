import * as THREE from 'three';

export class RingGimbalsEffect {
  public group: THREE.Group;
  private ringA: THREE.Mesh;
  private ringB: THREE.Mesh;
  private ringC: THREE.Mesh;
  private crosshairH: THREE.Line;
  private crosshairV: THREE.Line;

  constructor(colorThemeHex = 0x00f0ff) {
    this.group = new THREE.Group();

    // 1. Concentric Ring A (Large outer dashed)
    const geoA = new THREE.RingGeometry(3.6, 3.64, 90);
    const matA = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35
    });
    this.ringA = new THREE.Mesh(geoA, matA);
    this.group.add(this.ringA);

    // 2. Ring B (Segmented arc ring)
    const geoB = new THREE.RingGeometry(3.1, 3.16, 60, 1, 0, Math.PI * 1.6);
    const matB = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4
    });
    this.ringB = new THREE.Mesh(geoB, matB);
    this.group.add(this.ringB);

    // 3. Ring C (Inner gauge ring with ticks)
    const geoC = new THREE.RingGeometry(2.7, 2.73, 72);
    const matC = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.3
    });
    this.ringC = new THREE.Mesh(geoC, matC);
    this.group.add(this.ringC);

    // Subtle crosshairs
    const ptsH = [new THREE.Vector3(-4.2, 0, 0), new THREE.Vector3(4.2, 0, 0)];
    const geoH = new THREE.BufferGeometry().setFromPoints(ptsH);
    const lineMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.2
    });
    this.crosshairH = new THREE.Line(geoH, lineMat);
    this.group.add(this.crosshairH);

    const ptsV = [new THREE.Vector3(0, -4.2, 0), new THREE.Vector3(0, 4.2, 0)];
    const geoV = new THREE.BufferGeometry().setFromPoints(ptsV);
    this.crosshairV = new THREE.Line(geoV, lineMat.clone());
    this.group.add(this.crosshairV);
  }

  public setColorTheme(hex: number) {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).color.setHex(hex);
      } else if (child instanceof THREE.Line) {
        (child.material as THREE.LineBasicMaterial).color.setHex(hex);
      }
    });
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    this.ringA.rotation.z += 0.003 * speedMultiplier;
    this.ringB.rotation.z -= 0.007 * speedMultiplier;
    this.ringC.rotation.z += 0.005 * speedMultiplier;
  }
}
