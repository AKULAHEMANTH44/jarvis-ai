import * as THREE from 'three';

export class CarbonBuckyballObject {
  public group: THREE.Group;
  private cageWire: THREE.LineSegments;
  private carbonNodes: THREE.Points;
  private electronCloud: THREE.Mesh;
  private innerFullerene: THREE.LineSegments;
  private exploded: boolean = false;
  private explosionFactor: number = 0;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();

    // 1. Icosahedron / Truncated Icosahedron wireframe cage
    const icoGeo = new THREE.IcosahedronGeometry(1.6, 1);
    const edgesGeo = new THREE.EdgesGeometry(icoGeo);
    const lineMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      linewidth: 2,
      transparent: true,
      opacity: 0.85
    });
    this.cageWire = new THREE.LineSegments(edgesGeo, lineMat);
    this.group.add(this.cageWire);

    // 2. 60 Carbon Atom Nodes (Glowing Vertices)
    const posAttr = icoGeo.getAttribute('position');
    const nodesGeo = new THREE.BufferGeometry();
    nodesGeo.setAttribute('position', posAttr);
    const nodeMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.14,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    this.carbonNodes = new THREE.Points(nodesGeo, nodeMat);
    this.group.add(this.carbonNodes);

    // 3. Central Electron Cloud Aura
    const sphereGeo = new THREE.SphereGeometry(1.1, 24, 24);
    const auraMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending
    });
    this.electronCloud = new THREE.Mesh(sphereGeo, auraMat);
    this.group.add(this.electronCloud);

    // 4. Inner Concentric Sub-Nanotube Shell
    const innerGeo = new THREE.DodecahedronGeometry(0.8);
    const innerEdges = new THREE.EdgesGeometry(innerGeo);
    const innerMat = new THREE.LineBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.75
    });
    this.innerFullerene = new THREE.LineSegments(innerEdges, innerMat);
    this.group.add(this.innerFullerene);
  }

  public setExplodedView(exploded: boolean) {
    this.exploded = exploded;
  }

  public setColorTheme(hex: number) {
    (this.cageWire.material as THREE.LineBasicMaterial).color.setHex(hex);
    (this.electronCloud.material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const targetExp = this.exploded ? 1.0 : 0.0;
    this.explosionFactor += (targetExp - this.explosionFactor) * 0.08;

    this.group.rotation.x += 0.008 * speedMultiplier;
    this.group.rotation.y += 0.012 * speedMultiplier;
    this.innerFullerene.rotation.y -= 0.018 * speedMultiplier;
    this.innerFullerene.rotation.z += 0.01 * speedMultiplier;

    // Molecular breathing pulsation
    const pulse = 1.0 + Math.sin(time * 4) * 0.04;
    this.electronCloud.scale.set(pulse, pulse, pulse);

    // Exploded view expands outer carbon shell away from inner core
    const shellScale = 1.0 + this.explosionFactor * 0.65;
    this.cageWire.scale.set(shellScale, shellScale, shellScale);
    this.carbonNodes.scale.set(shellScale, shellScale, shellScale);
  }
}
