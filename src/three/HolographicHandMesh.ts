import * as THREE from 'three';
import { Landmark3D } from '../types/gesture';

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [9, 13], [13, 14], [14, 15], [15, 16],// Ring
  [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
  [0, 17]                               // Palm base
];

export class HolographicHandMesh {
  public group: THREE.Group;
  private jointSpheres: THREE.Mesh[] = [];
  private boneLines: THREE.LineSegments;
  private glowMaterial: THREE.MeshBasicMaterial;
  private lineMaterial: THREE.LineBasicMaterial;
  private isVisibleState: boolean = false;

  constructor(colorHex: number = 0x00f0ff) {
    this.group = new THREE.Group();
    this.group.name = 'HolographicHand3D';

    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });

    this.lineMaterial = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });

    // Create 21 joint spheres
    const sphereGeo = new THREE.SphereGeometry(0.022, 16, 16);
    for (let i = 0; i < 21; i++) {
      const joint = new THREE.Mesh(sphereGeo, this.glowMaterial.clone());
      this.jointSpheres.push(joint);
      this.group.add(joint);
    }

    // Create bone line segments (21 points, 23 connections * 2 vertices)
    const boneGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(HAND_CONNECTIONS.length * 2 * 3);
    boneGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.boneLines = new THREE.LineSegments(boneGeo, this.lineMaterial);
    this.group.add(this.boneLines);

    this.group.visible = false;
  }

  public setColorTheme(colorHex: number) {
    this.glowMaterial.color.setHex(colorHex);
    this.lineMaterial.color.setHex(colorHex);
    this.jointSpheres.forEach((m) => {
      (m.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    });
  }

  public updateLandmarks(landmarks: Landmark3D[]) {
    if (!landmarks || landmarks.length < 21) {
      if (this.isVisibleState) {
        this.group.visible = false;
        this.isVisibleState = false;
      }
      return;
    }

    if (!this.isVisibleState) {
      this.group.visible = true;
      this.isVisibleState = true;
    }

    // Map MediaPipe normalized landmarks to 3D scene space (center around 0, scale appropriately)
    // MediaPipe x: 0..1, y: 0..1, z: depth
    const positionsAttr = this.boneLines.geometry.attributes.position as THREE.BufferAttribute;
    let posIdx = 0;

    for (let i = 0; i < landmarks.length; i++) {
      const pt = landmarks[i];
      // Convert to Stark holographic space centered at origin
      const x = (pt.x - 0.5) * 3.5;
      const y = -(pt.y - 0.5) * 3.5;
      const z = (pt.z || 0) * 2.0;

      if (this.jointSpheres[i]) {
        this.jointSpheres[i].position.set(x, y, z);
      }
    }

    for (const [i1, i2] of HAND_CONNECTIONS) {
      const p1 = this.jointSpheres[i1].position;
      const p2 = this.jointSpheres[i2].position;

      positionsAttr.setXYZ(posIdx++, p1.x, p1.y, p1.z);
      positionsAttr.setXYZ(posIdx++, p2.x, p2.y, p2.z);
    }

    positionsAttr.needsUpdate = true;
  }

  public setVisible(visible: boolean) {
    this.isVisibleState = visible;
    this.group.visible = visible;
  }

  public dispose() {
    this.glowMaterial.dispose();
    this.lineMaterial.dispose();
    this.jointSpheres.forEach((m) => {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.boneLines.geometry.dispose();
  }
}
