import * as THREE from 'three';

export class HolographicDataChartObject {
  public group: THREE.Group;
  private bars: THREE.Mesh[] = [];
  private baseGrid: THREE.GridHelper;
  private trajectoryLine: THREE.Line;
  private targetBarHeights: number[] = [];
  private exploded: boolean = false;
  private explosionFactor: number = 0;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();

    // 1. Holographic Floor Grid
    this.baseGrid = new THREE.GridHelper(3.2, 8, colorThemeHex, 0x004466);
    this.baseGrid.position.y = -1.0;
    this.group.add(this.baseGrid);

    // 2. 3D Equalizer & Telemetry Bars (16 columns)
    const barCount = 16;
    const barWidth = 0.12;
    const barGeo = new THREE.BoxGeometry(barWidth, 1, barWidth);
    const barMat = new THREE.MeshStandardMaterial({
      color: colorThemeHex,
      emissive: colorThemeHex,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.85,
      roughness: 0.2
    });

    for (let i = 0; i < barCount; i++) {
      const bar = new THREE.Mesh(barGeo, barMat.clone());
      const angle = (i / barCount) * Math.PI * 2;
      const radius = 1.1;
      bar.position.set(Math.cos(angle) * radius, -0.5, Math.sin(angle) * radius);
      this.bars.push(bar);
      this.targetBarHeights.push(0.5);
      this.group.add(bar);
    }

    // 3. Trajectory Spline Curve
    const curvePoints: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      const t = (i / 19) * Math.PI * 2;
      curvePoints.push(new THREE.Vector3(
        Math.cos(t) * 1.3,
        Math.sin(t * 3) * 0.4,
        Math.sin(t) * 1.3
      ));
    }
    const spline = new THREE.CatmullRomCurve3(curvePoints);
    const splineGeo = new THREE.BufferGeometry().setFromPoints(spline.getPoints(50));
    const splineMat = new THREE.LineBasicMaterial({
      color: 0x00ffaa,
      linewidth: 2,
      transparent: true,
      opacity: 0.9
    });
    this.trajectoryLine = new THREE.Line(splineGeo, splineMat);
    this.group.add(this.trajectoryLine);
  }

  public setExplodedView(exploded: boolean) {
    this.exploded = exploded;
  }

  public setColorTheme(hex: number) {
    this.bars.forEach(bar => {
      (bar.material as THREE.MeshStandardMaterial).color.setHex(hex);
      (bar.material as THREE.MeshStandardMaterial).emissive.setHex(hex);
    });
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const targetExp = this.exploded ? 1.0 : 0.0;
    this.explosionFactor += (targetExp - this.explosionFactor) * 0.08;

    this.group.rotation.y += 0.007 * speedMultiplier;
    this.trajectoryLine.rotation.y += 0.015 * speedMultiplier;

    // Animate bars reacting dynamically to procedural frequencies
    for (let i = 0; i < this.bars.length; i++) {
      const h = 0.3 + Math.abs(Math.sin(time * 3 + i * 0.6)) * 1.2;
      this.targetBarHeights[i] = h;

      const bar = this.bars[i];
      bar.scale.y = h;
      bar.position.y = -1.0 + (h / 2);

      // Exploded offset outwards radially
      if (this.explosionFactor > 0.01) {
        const angle = (i / this.bars.length) * Math.PI * 2;
        const radius = 1.1 + this.explosionFactor * 0.8;
        bar.position.x = Math.cos(angle) * radius;
        bar.position.z = Math.sin(angle) * radius;
      }
    }
  }
}
