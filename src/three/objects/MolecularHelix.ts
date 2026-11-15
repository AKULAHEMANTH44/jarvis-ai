import * as THREE from 'three';

export class MolecularHelixObject {
  public group: THREE.Group;
  private strands: THREE.Points;
  private rungs: THREE.LineSegments;
  private exploded: boolean = false;
  private explosionFactor: number = 0;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();

    const count = 60;
    const height = 3.6;
    const radius = 1.1;

    const strandPts: number[] = [];
    const rungPts: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 4;
      const y = (i / count) * height - height / 2;

      // Strand A
      const xA = Math.cos(t) * radius;
      const zA = Math.sin(t) * radius;
      strandPts.push(xA, y, zA);

      // Strand B (180 deg out of phase)
      const xB = Math.cos(t + Math.PI) * radius;
      const zB = Math.sin(t + Math.PI) * radius;
      strandPts.push(xB, y, zB);

      // Connect rung every 2 steps
      if (i % 2 === 0) {
        rungPts.push(new THREE.Vector3(xA, y, zA));
        rungPts.push(new THREE.Vector3(xB, y, zB));
      }
    }

    const strandGeo = new THREE.BufferGeometry();
    strandGeo.setAttribute('position', new THREE.Float32BufferAttribute(strandPts, 3));
    const strandMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.12,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    this.strands = new THREE.Points(strandGeo, strandMat);
    this.group.add(this.strands);

    const rungGeo = new THREE.BufferGeometry().setFromPoints(rungPts);
    const rungMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      linewidth: 2,
      transparent: true,
      opacity: 0.75
    });
    this.rungs = new THREE.LineSegments(rungGeo, rungMat);
    this.group.add(this.rungs);
  }

  public setExplodedView(exploded: boolean) {
    this.exploded = exploded;
  }

  public setColorTheme(hex: number) {
    (this.rungs.material as THREE.LineBasicMaterial).color.setHex(hex);
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const targetExp = this.exploded ? 1.0 : 0.0;
    this.explosionFactor += (targetExp - this.explosionFactor) * 0.08;

    this.group.rotation.y += 0.012 * speedMultiplier;
    this.group.rotation.z = Math.sin(time * 0.5) * 0.15;

    const scale = 1.0 + this.explosionFactor * 0.6;
    this.group.scale.set(scale, 1.0, scale);
  }
}
