import * as THREE from 'three';
import { HologramModelId, LayoutFormation, SpatialObjectState } from '../types/hologram';
import { ArcReactorObject } from './objects/ArcReactor';
import { QuantumTesseractObject } from './objects/QuantumTesseract';
import { IronManArmorObject } from './objects/IronManArmor';
import { HolographicGlobeObject } from './objects/HolographicGlobe';
import { MolecularHelixObject } from './objects/MolecularHelix';
import { CarbonBuckyballObject } from './objects/CarbonBuckyball';
import { HolographicDataChartObject } from './objects/HolographicDataChart';

export interface SpatialInstance {
  id: string;
  modelId: HologramModelId;
  name: string;
  group: THREE.Group;
  selectionBox: THREE.Group;
  targetPosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  targetRotation: THREE.Euler;
  currentRotation: THREE.Euler;
  targetScale: number;
  currentScale: number;
  isSelected: boolean;
  groupId?: string;
  update: (time: number, speedMultiplier: number) => void;
  setExplodedView: (exploded: boolean) => void;
  setColorTheme: (hex: number) => void;
}

export class SpatialObjectManager {
  private sceneRoot: THREE.Group;
  private instances: Map<string, SpatialInstance> = new Map();
  private selectedInstanceId: string | null = null;
  private colorHex: number;

  constructor(sceneRoot: THREE.Group, colorHex: number = 0x00f0ff) {
    this.sceneRoot = sceneRoot;
    this.colorHex = colorHex;
  }

  // Create a selection bounding box with cyberpunk corner brackets
  private createSelectionBracket(size: number = 3.0): THREE.Group {
    const group = new THREE.Group();
    group.visible = false;

    // Corner bracket line segments
    const s = size / 2;
    const c = s * 0.35; // corner length
    const points: THREE.Vector3[] = [];

    // 8 corners of a cube
    const signs = [
      [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
      [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
    ];

    signs.forEach(([sx, sy, sz]) => {
      const p = new THREE.Vector3(sx * s, sy * s, sz * s);
      points.push(p, new THREE.Vector3(sx * (s - c), sy * s, sz * s));
      points.push(p, new THREE.Vector3(sx * s, sy * (s - c), sz * s));
      points.push(p, new THREE.Vector3(sx * s, sy * s, sz * (s - c)));
    });

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const line = new THREE.LineSegments(geo, mat);
    group.add(line);

    // Orbiting selection ring
    const ringGeo = new THREE.RingGeometry(s * 1.05, s * 1.08, 36);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    return group;
  }

  public createInstance(modelId: HologramModelId, position = new THREE.Vector3(0, 0, 0)): SpatialInstance {
    const id = `holo-${modelId}-${Math.random().toString(36).substring(2, 7)}`;
    const group = new THREE.Group();

    let modelObject: {
      group: THREE.Group;
      update: (time: number, speedMultiplier: number) => void;
      setExplodedView: (exploded: boolean) => void;
      setColorTheme: (hex: number) => void;
    };

    switch (modelId) {
      case 'quantum_tesseract':
        modelObject = new QuantumTesseractObject(this.colorHex);
        break;
      case 'ironman_armor':
        modelObject = new IronManArmorObject(this.colorHex);
        break;
      case 'planetary_defense':
        modelObject = new HolographicGlobeObject(this.colorHex);
        break;
      case 'molecular_dna':
        modelObject = new MolecularHelixObject(this.colorHex);
        break;
      case 'carbon_buckyball':
        modelObject = new CarbonBuckyballObject(this.colorHex);
        break;
      case 'hologram_datachart':
        modelObject = new HolographicDataChartObject(this.colorHex);
        break;
      case 'arc_reactor':
      default:
        modelObject = new ArcReactorObject(this.colorHex);
        break;
    }

    group.add(modelObject.group);
    group.position.copy(position);

    const selectionBox = this.createSelectionBracket();
    group.add(selectionBox);

    this.sceneRoot.add(group);

    const friendlyNames: Record<HologramModelId, string> = {
      arc_reactor: 'Arc Reactor MK-VII',
      quantum_tesseract: 'Quantum Tesseract',
      ironman_armor: 'Iron Man Mark VII',
      planetary_defense: 'Stark Defense Grid',
      molecular_dna: 'Nanotech DNA',
      carbon_buckyball: 'Fullerene C60 Buckyball',
      hologram_datachart: 'Holographic Telemetry Chart'
    };

    const instance: SpatialInstance = {
      id,
      modelId,
      name: friendlyNames[modelId] || modelId,
      group,
      selectionBox,
      targetPosition: position.clone(),
      currentPosition: position.clone(),
      targetRotation: new THREE.Euler(0, 0, 0),
      currentRotation: new THREE.Euler(0, 0, 0),
      targetScale: 1.0,
      currentScale: 0.2, // Entrance pop
      isSelected: false,
      update: modelObject.update.bind(modelObject),
      setExplodedView: modelObject.setExplodedView.bind(modelObject),
      setColorTheme: modelObject.setColorTheme.bind(modelObject)
    };

    this.instances.set(id, instance);
    this.select(id);
    return instance;
  }

  public select(id: string | null) {
    this.selectedInstanceId = id;
    this.instances.forEach((inst) => {
      inst.isSelected = inst.id === id;
      inst.selectionBox.visible = inst.isSelected;
    });
  }

  public getSelected(): SpatialInstance | null {
    if (!this.selectedInstanceId) return null;
    return this.instances.get(this.selectedInstanceId) || null;
  }

  public getSelectedId(): string | null {
    return this.selectedInstanceId;
  }

  public getAll(): SpatialInstance[] {
    return Array.from(this.instances.values());
  }

  public getStates(): SpatialObjectState[] {
    return Array.from(this.instances.values()).map(inst => ({
      id: inst.id,
      modelId: inst.modelId,
      name: inst.name,
      position: { x: inst.targetPosition.x, y: inst.targetPosition.y, z: inst.targetPosition.z },
      rotation: { x: inst.targetRotation.x, y: inst.targetRotation.y, z: inst.targetRotation.z },
      scale: inst.targetScale,
      isSelected: inst.isSelected,
      groupId: inst.groupId,
      isLocked: false
    }));
  }

  public duplicate(id: string): SpatialInstance | null {
    const source = this.instances.get(id);
    if (!source) return null;

    const newPos = source.targetPosition.clone().add(new THREE.Vector3(1.2, 0.4, 0));
    const newInst = this.createInstance(source.modelId, newPos);
    newInst.targetScale = source.targetScale;
    newInst.targetRotation.copy(source.targetRotation);
    return newInst;
  }

  public delete(id: string): boolean {
    const inst = this.instances.get(id);
    if (!inst) return false;

    // Dispose geometries and materials cleanly to prevent WebGL memory leaks
    inst.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    });

    this.sceneRoot.remove(inst.group);
    this.instances.delete(id);

    if (this.selectedInstanceId === id) {
      const remaining = Array.from(this.instances.keys());
      this.select(remaining.length > 0 ? remaining[0] : null);
    }
    return true;
  }

  public groupObjects(ids: string[]): string {
    const groupId = `group-${Math.random().toString(36).substring(2, 6)}`;
    ids.forEach(id => {
      const inst = this.instances.get(id);
      if (inst) inst.groupId = groupId;
    });
    return groupId;
  }

  public ungroupObject(id: string) {
    const inst = this.instances.get(id);
    if (inst) inst.groupId = undefined;
  }

  // Apply spatial layout formations
  public applyFormation(formation: LayoutFormation) {
    const list = Array.from(this.instances.values());
    const count = list.length;
    if (count === 0) return;

    if (formation === 'SINGLE') {
      list.forEach((inst, idx) => {
        if (inst.id === this.selectedInstanceId) {
          inst.targetPosition.set(0, 0, 0);
          inst.targetScale = 1.0;
        } else {
          inst.targetPosition.set((idx - count / 2) * 2.8, -3.5, -2.0);
          inst.targetScale = 0.45;
        }
      });
    } else if (formation === 'GRID') {
      const cols = Math.ceil(Math.sqrt(count));
      const spacing = 2.4;
      list.forEach((inst, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        inst.targetPosition.set(
          (col - (cols - 1) / 2) * spacing,
          (1 - row) * (spacing * 0.8),
          0
        );
        inst.targetScale = 0.75;
      });
    } else if (formation === 'ORBIT') {
      const radius = 3.0;
      list.forEach((inst, idx) => {
        const angle = (idx / count) * Math.PI * 2;
        inst.targetPosition.set(
          Math.cos(angle) * radius,
          Math.sin(angle * 0.7) * 0.8,
          Math.sin(angle) * radius * 0.8
        );
        inst.targetScale = 0.65;
      });
    } else if (formation === 'LINE') {
      const spacing = 2.6;
      list.forEach((inst, idx) => {
        inst.targetPosition.set((idx - (count - 1) / 2) * spacing, 0, 0);
        inst.targetScale = 0.8;
      });
    }
  }

  public setColorTheme(hex: number) {
    this.colorHex = hex;
    this.instances.forEach(inst => inst.setColorTheme(hex));
  }

  public setExplodedView(exploded: boolean) {
    this.instances.forEach(inst => inst.setExplodedView(exploded));
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const lerpFactor = 0.12;

    this.instances.forEach((inst) => {
      // Lerp position
      inst.currentPosition.lerp(inst.targetPosition, lerpFactor);
      inst.group.position.copy(inst.currentPosition);

      // Lerp scale
      inst.currentScale += (inst.targetScale - inst.currentScale) * lerpFactor;
      inst.group.scale.set(inst.currentScale, inst.currentScale, inst.currentScale);

      // Lerp rotation
      inst.currentRotation.x += (inst.targetRotation.x - inst.currentRotation.x) * lerpFactor;
      inst.currentRotation.y += (inst.targetRotation.y - inst.currentRotation.y) * lerpFactor;
      inst.currentRotation.z += (inst.targetRotation.z - inst.currentRotation.z) * lerpFactor;
      inst.group.rotation.copy(inst.currentRotation);

      // Animate selection brackets
      if (inst.isSelected) {
        inst.selectionBox.rotation.y += 0.015;
      }

      // Update inner model
      inst.update(time, speedMultiplier);
    });
  }

  public clearAll() {
    Array.from(this.instances.keys()).forEach(id => this.delete(id));
  }
}
