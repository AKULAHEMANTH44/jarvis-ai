import * as THREE from 'three';

export class QuantumTesseractObject {
  public group: THREE.Group;
  private outerCube: THREE.LineSegments;
  private innerCube: THREE.LineSegments;
  private hyperEdges: THREE.LineSegments;
  private singularity: THREE.Mesh;
  private orbitRings: THREE.Group;
  private exploded: boolean = false;
  private explosionFactor: number = 0;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();

    const lineMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      linewidth: 2,
      transparent: true,
      opacity: 0.85
    });

    // Outer cube
    const outerGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
    const outerEdges = new THREE.EdgesGeometry(outerGeo);
    this.outerCube = new THREE.LineSegments(outerEdges, lineMat);
    this.group.add(this.outerCube);

    // Inner cube
    const innerGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const innerEdges = new THREE.EdgesGeometry(innerGeo);
    this.innerCube = new THREE.LineSegments(innerEdges, lineMat.clone());
    this.group.add(this.innerCube);

    // Hyper-dimensional connecting lines between outer and inner 8 vertices
    const hyperPts: THREE.Vector3[] = [];
    const outerCorners = [
      new THREE.Vector3(-1.2, -1.2, -1.2), new THREE.Vector3(1.2, -1.2, -1.2),
      new THREE.Vector3(1.2, 1.2, -1.2), new THREE.Vector3(-1.2, 1.2, -1.2),
      new THREE.Vector3(-1.2, -1.2, 1.2), new THREE.Vector3(1.2, -1.2, 1.2),
      new THREE.Vector3(1.2, 1.2, 1.2), new THREE.Vector3(-1.2, 1.2, 1.2),
    ];
    for (const c of outerCorners) {
      hyperPts.push(c.clone());
      hyperPts.push(c.clone().multiplyScalar(0.5));
    }
    const hyperGeo = new THREE.BufferGeometry().setFromPoints(hyperPts);
    this.hyperEdges = new THREE.LineSegments(hyperGeo, lineMat.clone());
    this.group.add(this.hyperEdges);

    // Core Quantum Singularity Sphere
    const singGeo = new THREE.OctahedronGeometry(0.5, 2);
    const singMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    this.singularity = new THREE.Mesh(singGeo, singMat);
    this.group.add(this.singularity);

    // Orbital containment rings
    this.orbitRings = new THREE.Group();
    for (let r = 0; r < 3; r++) {
      const ringGeo = new THREE.TorusGeometry(1.9 + r * 0.35, 0.02, 8, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: colorThemeHex,
        transparent: true,
        opacity: 0.45
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = (r * Math.PI) / 3;
      ringMesh.rotation.y = (r * Math.PI) / 4;
      this.orbitRings.add(ringMesh);
    }
    this.group.add(this.orbitRings);
  }

  public setExplodedView(exploded: boolean) {
    this.exploded = exploded;
  }

  public setColorTheme(hex: number) {
    this.group.traverse((child) => {
      if (child instanceof THREE.LineSegments) {
        (child.material as THREE.LineBasicMaterial).color.setHex(hex);
      } else if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshBasicMaterial).color.setHex(hex);
      }
    });
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const targetExp = this.exploded ? 1.0 : 0.0;
    this.explosionFactor += (targetExp - this.explosionFactor) * 0.08;

    // 4D tumbling rotation
    this.outerCube.rotation.x += 0.007 * speedMultiplier;
    this.outerCube.rotation.y += 0.011 * speedMultiplier;

    this.innerCube.rotation.x -= 0.015 * speedMultiplier;
    this.innerCube.rotation.z += 0.018 * speedMultiplier;

    this.singularity.rotation.y += 0.03 * speedMultiplier;
    this.orbitRings.rotation.x += 0.008 * speedMultiplier;
    this.orbitRings.rotation.y += 0.012 * speedMultiplier;

    const scale4D = 0.5 + Math.sin(time * 3) * 0.15;
    this.innerCube.scale.set(scale4D, scale4D, scale4D);

    const outerScale = 1.0 + this.explosionFactor * 0.7;
    this.outerCube.scale.set(outerScale, outerScale, outerScale);
  }
}
