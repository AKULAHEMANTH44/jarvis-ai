import * as THREE from 'three';
import {
  ComponentLabel2D,
  DispersionPhase,
  HologramModelId,
  HologramRenderMode,
  LayoutFormation,
  SpatialObjectState
} from '../types/hologram';
import { VisionSphereObject } from './objects/VisionSphere';
import { ArcReactorObject } from './objects/ArcReactor';
import { QuantumTesseractObject } from './objects/QuantumTesseract';
import { IronManArmorObject } from './objects/IronManArmor';
import { HolographicGlobeObject } from './objects/HolographicGlobe';
import { MolecularHelixObject } from './objects/MolecularHelix';
import { CarbonBuckyballObject } from './objects/CarbonBuckyball';
import { HolographicDataChartObject } from './objects/HolographicDataChart';
import { ReconstructedHologramObject } from './objects/ReconstructedHologram';
import {
  RealWorldHologramObject,
  RealWorldModelId,
  ComponentAnchor
} from './objects/RealWorldCatalog';

const _projVec = new THREE.Vector3();

const REAL_WORLD_IDS: ReadonlySet<HologramModelId> = new Set([
  'sports_car',
  'cyber_motorcycle',
  'holo_smartphone',
  'quantum_workstation',
  'jet_turbine_engine',
  'stark_skyscraper',
  'industrial_robot_arm',
  'planetary_gearbox',
  'atom_orbital_model'
]);

interface DisintegrationData {
  points: THREE.Points;
  basePositions: Float32Array;
  burstVelocities: Float32Array;
  count: number;
}

export interface SpatialInstance {
  id: string;
  modelId: HologramModelId;
  name: string;
  group: THREE.Group;
  modelGroup: THREE.Group;
  selectionBox: THREE.Group;
  scanRing: THREE.Mesh;
  scanProgress: number;
  isScanning: boolean;
  targetPosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  targetRotation: THREE.Euler;
  currentRotation: THREE.Euler;
  targetScale: number;
  currentScale: number;
  isSelected: boolean;
  isLocked: boolean;
  isFrozen: boolean;
  isDisintegrated: boolean;
  targetDisintegration: number;
  currentDisintegration: number;
  dispersionPhase: DispersionPhase;
  disintegration?: DisintegrationData;
  isReconstructed: boolean;
  reconstructionMethodLabel?: string;
  vertexCount: number;
  faceCount: number;
  componentCount: number;
  renderMode: HologramRenderMode;
  groupId?: string;
  reconstructedObj?: ReconstructedHologramObject;
  realWorldObj?: RealWorldHologramObject;
  visionSphereObj?: VisionSphereObject;
  update: (time: number, speedMultiplier: number, delta?: number) => void;
  setExplodedView: (exploded: boolean) => void;
  setColorTheme: (hex: number) => void;
}

export class SpatialObjectManager {
  private sceneRoot: THREE.Group;
  private instances: Map<string, SpatialInstance> = new Map();
  private selectedInstanceId: string | null = null;
  private colorHex: number;
  private showBoundingBoxes: boolean = true;
  private activeRenderMode: HologramRenderMode = 'HYBRID';
  private activeGlowIntensity: number = 1.5;
  private activeClippingPlanes: THREE.Plane[] = [];

  constructor(sceneRoot: THREE.Group, colorHex: number = 0x00f0ff) {
    this.sceneRoot = sceneRoot;
    this.colorHex = colorHex;
  }

  private createSelectionBracket(size: number = 3.0): THREE.Group {
    const group = new THREE.Group();
    group.visible = false;

    const s = size / 2;
    const c = s * 0.35;
    const points: THREE.Vector3[] = [];

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

  private createScanRing(): THREE.Mesh {
    const geo = new THREE.RingGeometry(1.55, 1.68, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.visible = false;
    return mesh;
  }

  private computeGeometryStats(root: THREE.Object3D): {
    vertexCount: number;
    faceCount: number;
    componentCount: number;
  } {
    let vertexCount = 0;
    let faceCount = 0;
    let componentCount = 0;

    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry) {
        componentCount++;
        const pos = obj.geometry.getAttribute('position');
        if (pos) {
          vertexCount += pos.count;
          const idx = obj.geometry.getIndex();
          faceCount += idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
        }
      }
    });

    return { vertexCount, faceCount, componentCount: Math.max(1, componentCount) };
  }

  private buildDisintegrationCloud(inst: SpatialInstance): DisintegrationData {
    inst.modelGroup.updateMatrixWorld(true);
    const invRoot = inst.modelGroup.matrixWorld.clone().invert();
    const sampled: number[] = [];

    inst.modelGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry) {
        const pos = obj.geometry.getAttribute('position');
        if (!pos || pos.count === 0) return;
        const step = Math.max(1, Math.floor(pos.count / 450));
        const localMat = new THREE.Matrix4().multiplyMatrices(invRoot, obj.matrixWorld);
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(localMat);
          sampled.push(v.x, v.y, v.z);
        }
      }
    });

    // Fallback ring/sphere sample if a model has minimal mesh vertices
    if (sampled.length < 300) {
      for (let i = sampled.length / 3; i < 600; i++) {
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = Math.random() * Math.PI * 2;
        const r = 0.6 + Math.random() * 0.9;
        sampled.push(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        );
      }
    }

    const maxParticles = 3200;
    const rawCount = Math.min(maxParticles, Math.floor(sampled.length / 3));
    const basePositions = new Float32Array(rawCount * 3);
    const currentPositions = new Float32Array(rawCount * 3);
    const burstVelocities = new Float32Array(rawCount * 3);

    for (let i = 0; i < rawCount; i++) {
      const x = sampled[i * 3];
      const y = sampled[i * 3 + 1];
      const z = sampled[i * 3 + 2];
      basePositions[i * 3] = x;
      basePositions[i * 3 + 1] = y;
      basePositions[i * 3 + 2] = z;
      currentPositions[i * 3] = x;
      currentPositions[i * 3 + 1] = y;
      currentPositions[i * 3 + 2] = z;

      const len = Math.hypot(x, y, z) || 1;
      const spread = 1.6 + Math.random() * 2.4;
      burstVelocities[i * 3] = (x / len) * spread + (Math.random() - 0.5) * 1.1;
      burstVelocities[i * 3 + 1] = (y / len) * spread + (Math.random() - 0.5) * 1.1;
      burstVelocities[i * 3 + 2] = (z / len) * spread + (Math.random() - 0.5) * 1.1;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: this.colorHex,
      size: 0.06,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const points = new THREE.Points(geo, mat);
    points.visible = false;
    inst.group.add(points);

    return { points, basePositions, burstVelocities, count: rawCount };
  }

  private registerInstance(
    id: string,
    modelId: HologramModelId,
    name: string,
    modelObject: {
      group: THREE.Group;
      update: (time: number, speedMultiplier: number, delta?: number) => void;
      setExplodedView: (exploded: boolean) => void;
      setColorTheme: (hex: number) => void;
    },
    position: THREE.Vector3,
    isReconstructed: boolean,
    reconstructedObj?: ReconstructedHologramObject,
    realWorldObj?: RealWorldHologramObject,
    reconstructionMethodLabel?: string,
    visionSphereObj?: VisionSphereObject
  ): SpatialInstance {
    const group = new THREE.Group();
    group.add(modelObject.group);
    group.position.copy(position);

    const selectionBox = this.createSelectionBracket();
    group.add(selectionBox);

    const scanRing = this.createScanRing();
    group.add(scanRing);

    this.sceneRoot.add(group);

    const stats = reconstructedObj
      ? {
          vertexCount: reconstructedObj.vertexCount,
          faceCount: reconstructedObj.faceCount,
          componentCount: reconstructedObj.componentCount
        }
      : this.computeGeometryStats(modelObject.group);

    const instance: SpatialInstance = {
      id,
      modelId,
      name,
      group,
      modelGroup: modelObject.group,
      selectionBox,
      scanRing,
      scanProgress: 0,
      isScanning: true,
      targetPosition: position.clone(),
      currentPosition: position.clone(),
      targetRotation: new THREE.Euler(0, 0, 0),
      currentRotation: new THREE.Euler(0, 0, 0),
      targetScale: 1.0,
      currentScale: 0.2,
      isSelected: false,
      isLocked: false,
      isFrozen: false,
      isDisintegrated: false,
      targetDisintegration: 0,
      currentDisintegration: 0,
      dispersionPhase: 'COMPLETE',
      isReconstructed,
      reconstructionMethodLabel,
      vertexCount: visionSphereObj
        ? stats.vertexCount + visionSphereObj.getParticleEngine().getActiveCount()
        : stats.vertexCount,
      faceCount: stats.faceCount,
      componentCount: visionSphereObj
        ? visionSphereObj.getComponentAnchors().length
        : realWorldObj
        ? realWorldObj.getComponentAnchors().length
        : stats.componentCount,
      renderMode: this.activeRenderMode,
      reconstructedObj,
      realWorldObj,
      visionSphereObj,
      update: modelObject.update.bind(modelObject),
      setExplodedView: modelObject.setExplodedView.bind(modelObject),
      setColorTheme: modelObject.setColorTheme.bind(modelObject)
    };

    if (reconstructedObj) {
      reconstructedObj.setRenderMode(this.activeRenderMode);
      reconstructedObj.setGlowIntensity(this.activeGlowIntensity);
    } else {
      this.applyRenderModeToModel(instance, this.activeRenderMode);
    }
    this.applyClippingPlanesToInstance(instance, this.activeClippingPlanes);

    this.instances.set(id, instance);
    this.select(id);
    return instance;
  }

  public createInstance(modelId: HologramModelId, position = new THREE.Vector3(0, 0, 0)): SpatialInstance {
    const id = `holo-${modelId}-${Math.random().toString(36).substring(2, 7)}`;

    const friendlyNames: Record<HologramModelId, string> = {
      vision_sphere: 'VISION 1.2 CORE',
      arc_reactor: 'Arc Reactor MK-VII',
      quantum_tesseract: 'Quantum Tesseract',
      ironman_armor: 'Iron Man Mark VII',
      planetary_defense: 'Stark Defense Grid',
      molecular_dna: 'Nanotech DNA',
      carbon_buckyball: 'Fullerene C60 Buckyball',
      hologram_datachart: 'Holographic Telemetry Chart',
      sports_car: 'Hypercar Aero Chassis',
      cyber_motorcycle: 'Autonomous Superbike',
      holo_smartphone: 'Holo-Glass Smartphone',
      quantum_workstation: 'Quantum Compute Tower',
      jet_turbine_engine: 'Turbofan Jet Engine',
      stark_skyscraper: 'Stark Spire Architecture',
      industrial_robot_arm: '6-DOF Assembly Robot',
      planetary_gearbox: 'Planetary Reduction Gearbox',
      atom_orbital_model: 'Quantum Atomic Lattice',
      reconstructed_object: 'Reconstructed Specimen'
    };

    if (modelId === 'vision_sphere') {
      const visionObj = new VisionSphereObject(this.colorHex);
      return this.registerInstance(
        id,
        modelId,
        friendlyNames.vision_sphere,
        visionObj,
        position,
        false,
        undefined,
        undefined,
        undefined,
        visionObj
      );
    }

    if (REAL_WORLD_IDS.has(modelId)) {
      const realObj = new RealWorldHologramObject(modelId as RealWorldModelId, this.colorHex);
      return this.registerInstance(
        id,
        modelId,
        friendlyNames[modelId],
        realObj,
        position,
        false,
        undefined,
        realObj
      );
    }

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
      case 'reconstructed_object': {
        const defaultGeo = new THREE.TorusKnotGeometry(0.9, 0.28, 120, 18, 2, 3);
        const rec = new ReconstructedHologramObject(defaultGeo, this.colorHex);
        return this.registerInstance(id, 'reconstructed_object', 'Reconstructed Specimen', rec, position, true, rec);
      }
      case 'arc_reactor':
      default:
        modelObject = new ArcReactorObject(this.colorHex);
        break;
    }

    return this.registerInstance(
      id,
      modelId,
      friendlyNames[modelId] || modelId,
      modelObject,
      position,
      false
    );
  }

  public createReconstructedInstance(
    name: string,
    geometryOrGroup: THREE.BufferGeometry | THREE.Group,
    position = new THREE.Vector3(0, 0, 0),
    methodLabel?: string
  ): SpatialInstance {
    const id = `holo-recon-${Math.random().toString(36).substring(2, 7)}`;
    const rec = new ReconstructedHologramObject(geometryOrGroup, this.colorHex);
    return this.registerInstance(
      id,
      'reconstructed_object',
      name,
      rec,
      position,
      true,
      rec,
      undefined,
      methodLabel
    );
  }

  private refreshSelectionVisibility() {
    const showMultiBox = this.instances.size > 1;
    this.instances.forEach((inst) => {
      inst.selectionBox.visible = showMultiBox && inst.isSelected && this.showBoundingBoxes;
    });
  }

  public select(id: string | null) {
    this.selectedInstanceId = id;
    this.instances.forEach((inst) => {
      inst.isSelected = inst.id === id;
    });
    this.refreshSelectionVisibility();
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
    return Array.from(this.instances.values()).map((inst) => ({
      id: inst.id,
      modelId: inst.modelId,
      name: inst.name,
      position: { x: inst.targetPosition.x, y: inst.targetPosition.y, z: inst.targetPosition.z },
      rotation: { x: inst.targetRotation.x, y: inst.targetRotation.y, z: inst.targetRotation.z },
      scale: inst.targetScale,
      isSelected: inst.isSelected,
      groupId: inst.groupId,
      isLocked: inst.isLocked,
      isFrozen: inst.isFrozen,
      isDisintegrated: inst.isDisintegrated,
      disintegrationProgress: inst.visionSphereObj
        ? inst.visionSphereObj.getDispersion()
        : inst.currentDisintegration,
      dispersionPhase: inst.dispersionPhase,
      isReconstructed: inst.isReconstructed,
      reconstructionMethodLabel: inst.reconstructionMethodLabel,
      vertexCount: inst.vertexCount,
      faceCount: inst.faceCount,
      componentCount: inst.componentCount,
      reconstructionProgress: inst.isScanning ? inst.scanProgress : 1,
      renderMode: inst.renderMode
    }));
  }

  public setLocked(id: string, locked: boolean): boolean {
    const inst = this.instances.get(id);
    if (!inst) return false;
    inst.isLocked = locked;
    return inst.isLocked;
  }

  public toggleLock(id: string): boolean {
    const inst = this.instances.get(id);
    if (!inst) return false;
    inst.isLocked = !inst.isLocked;
    return inst.isLocked;
  }

  public setFrozen(id: string, frozen: boolean): boolean {
    const inst = this.instances.get(id);
    if (!inst) return false;
    inst.isFrozen = frozen;
    return inst.isFrozen;
  }

  public setObjectTransform(
    id: string,
    transform: {
      position?: Partial<{ x: number; y: number; z: number }>;
      rotation?: Partial<{ x: number; y: number; z: number }>;
      scale?: number;
    }
  ) {
    const inst = this.instances.get(id);
    if (!inst || inst.isLocked || inst.isFrozen) return;

    if (transform.position) {
      if (transform.position.x !== undefined) {
        inst.targetPosition.x = Math.max(-4.5, Math.min(4.5, transform.position.x));
      }
      if (transform.position.y !== undefined) {
        inst.targetPosition.y = Math.max(-3.0, Math.min(3.0, transform.position.y));
      }
      if (transform.position.z !== undefined) {
        inst.targetPosition.z = Math.max(-3.0, Math.min(3.0, transform.position.z));
      }
    }
    if (transform.rotation) {
      if (transform.rotation.x !== undefined) inst.targetRotation.x = transform.rotation.x;
      if (transform.rotation.y !== undefined) inst.targetRotation.y = transform.rotation.y;
      if (transform.rotation.z !== undefined) inst.targetRotation.z = transform.rotation.z;
    }
    if (transform.scale !== undefined) {
      inst.targetScale = Math.max(0.3, Math.min(3.2, transform.scale));
    }
  }

  public triggerRotate360(id?: string): boolean {
    const target = id ? this.instances.get(id) : this.getSelected();
    if (!target || target.isLocked) return false;
    target.isFrozen = false;
    target.targetRotation.y += Math.PI * 2;
    return true;
  }

  public disintegrate(id?: string): boolean {
    const target = id ? this.instances.get(id) : this.getSelected();
    if (!target) return false;

    if (target.visionSphereObj) {
      target.visionSphereObj.setDispersion(1.0);
      target.isDisintegrated = true;
      target.targetDisintegration = 1.0;
      target.dispersionPhase = 'DISPERSED';
      return true;
    }

    if (!target.disintegration) {
      target.disintegration = this.buildDisintegrationCloud(target);
    }
    target.isDisintegrated = true;
    target.targetDisintegration = 1.0;
    target.dispersionPhase = 'DISPERSED';
    return true;
  }

  public reconstruct(id?: string): boolean {
    const target = id ? this.instances.get(id) : this.getSelected();
    if (!target) return false;

    if (target.visionSphereObj) {
      target.visionSphereObj.setDispersion(0.0);
    }
    target.isDisintegrated = false;
    target.targetDisintegration = 0.0;
    target.dispersionPhase = 'COMPLETE';
    target.modelGroup.visible = true;
    target.isFrozen = false;
    this.setExplosionAmount(0);
    this.triggerReconstructionScan(target.id);
    return true;
  }

  public setGlobalDispersion(amount: number, explicitPhase?: DispersionPhase) {
    const clamped = Math.max(0, Math.min(1, amount));
    this.instances.forEach((inst) => {
      if (inst.visionSphereObj) {
        inst.visionSphereObj.setDispersion(clamped);
        inst.targetDisintegration = clamped;
        inst.isDisintegrated = clamped >= 0.85;
        const pState = inst.visionSphereObj.getDispersionState();
        inst.dispersionPhase =
          explicitPhase ||
          (pState === 'DISPERSED'
            ? 'DISPERSED'
            : pState === 'RECONSTRUCTING'
            ? 'RECONSTRUCTING'
            : pState === 'EXPANDING'
            ? 'EXPANDING'
            : 'COMPLETE');
      } else {
        if (clamped > 0.02 && !inst.disintegration) {
          inst.disintegration = this.buildDisintegrationCloud(inst);
        }
        inst.targetDisintegration = clamped;
        inst.isDisintegrated = clamped >= 0.85;
        inst.dispersionPhase =
          explicitPhase ||
          (clamped <= 0.04
            ? 'COMPLETE'
            : clamped >= 0.85
            ? 'DISPERSED'
            : clamped < inst.currentDisintegration
            ? 'RECONSTRUCTING'
            : 'EXPANDING');
      }
    });
  }

  public triggerReconstructionScan(id?: string) {
    const target = id ? this.instances.get(id) : this.getSelected();
    if (!target) return;
    target.isScanning = true;
    target.scanProgress = 0;
    target.scanRing.visible = true;
    target.reconstructedObj?.triggerScan();
  }

  public getSelectedComponentLabels(
    camera: THREE.Camera,
    viewportWidth: number,
    viewportHeight: number
  ): ComponentLabel2D[] {
    const selected = this.getSelected();
    if (!selected || selected.isDisintegrated || viewportWidth <= 0 || viewportHeight <= 0) {
      return [];
    }

    let anchors: ComponentAnchor[] = [];
    if (selected.visionSphereObj) {
      anchors = selected.visionSphereObj.getComponentAnchors();
    } else if (selected.realWorldObj) {
      anchors = selected.realWorldObj.getComponentAnchors();
    } else if (selected.reconstructedObj) {
      anchors = selected.reconstructedObj.getComponentAnchors();
    } else {
      let idx = 0;
      selected.modelGroup.children.forEach((child) => {
        if (idx < 6 && (child instanceof THREE.Mesh || child instanceof THREE.Group)) {
          idx++;
          anchors.push({
            id: `sub-${idx}`,
            name: (child.userData.componentLabel as string) || child.name || `Sub-Assembly ${idx}`,
            object: child
          });
        }
      });
    }

    selected.group.updateMatrixWorld(true);
    const labels: ComponentLabel2D[] = [];

    for (const anchor of anchors) {
      anchor.object.getWorldPosition(_projVec);
      _projVec.project(camera);
      if (_projVec.z > 1) continue;

      const x = (_projVec.x * 0.5 + 0.5) * viewportWidth;
      const y = (-_projVec.y * 0.5 + 0.5) * viewportHeight;

      if (x >= 24 && x <= viewportWidth - 24 && y >= 24 && y <= viewportHeight - 24) {
        labels.push({ id: anchor.id, name: anchor.name, x, y });
      }
    }

    return labels;
  }

  private applyRenderModeToModel(inst: SpatialInstance, mode: HologramRenderMode) {
    inst.renderMode = mode;
    if (inst.reconstructedObj) {
      inst.reconstructedObj.setRenderMode(mode);
      return;
    }
    if (inst.visionSphereObj) {
      return;
    }

    inst.modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
        if ('wireframe' in mat) {
          if (mode === 'WIREFRAME' || mode === 'POINT_CLOUD') {
            mat.wireframe = true;
          } else if (mode === 'SOLID_HOLO') {
            mat.wireframe = false;
          } else {
            mat.wireframe = true;
          }
        }
      }
    });
  }

  public setGlobalRenderMode(mode: HologramRenderMode) {
    this.activeRenderMode = mode;
    this.instances.forEach((inst) => this.applyRenderModeToModel(inst, mode));
  }

  public setShowBoundingBoxes(show: boolean) {
    this.showBoundingBoxes = show;
    this.refreshSelectionVisibility();
  }

  public setInitializationProgress(progress: number) {
    this.instances.forEach((inst) => {
      inst.visionSphereObj?.setInitProgress(progress);
    });
  }

  public setCoreActivity(activity: {
    isListening?: boolean;
    isSpeaking?: boolean;
    isProcessing?: boolean;
  }) {
    this.instances.forEach((inst) => {
      inst.visionSphereObj?.setCoreActivity(activity);
    });
  }

  public setGlowIntensity(intensity: number) {
    this.activeGlowIntensity = Math.max(0.4, Math.min(3.0, intensity));
    this.instances.forEach((inst) => {
      if (inst.reconstructedObj) {
        inst.reconstructedObj.setGlowIntensity(this.activeGlowIntensity);
      } else {
        inst.modelGroup.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
            child.material.emissiveIntensity = 0.55 * this.activeGlowIntensity;
          }
        });
      }
    });
  }

  public setPulseEnabled(enabled: boolean) {
    this.instances.forEach((inst) => {
      inst.reconstructedObj?.setPulseEnabled(enabled);
    });
  }

  public setExplosionAmount(amount: number) {
    const clamped = Math.max(0, Math.min(1, amount));
    const exploded = clamped > 0.05;
    this.instances.forEach((inst) => {
      if (inst.visionSphereObj) {
        inst.visionSphereObj.setExplosionAmount(clamped);
      } else if (inst.reconstructedObj) {
        inst.reconstructedObj.setExplosionAmount(clamped);
      } else if (inst.realWorldObj) {
        inst.realWorldObj.setExplosionAmount(clamped);
      } else {
        inst.setExplodedView(exploded);
      }
    });
  }

  private applyClippingPlanesToInstance(inst: SpatialInstance, planes: THREE.Plane[]) {
    inst.modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (m) {
            m.clippingPlanes = planes;
            m.needsUpdate = true;
          }
        });
      }
    });
  }

  public applyClippingPlanes(planes: THREE.Plane[]) {
    this.activeClippingPlanes = planes;
    this.instances.forEach((inst) => this.applyClippingPlanesToInstance(inst, planes));
  }

  public duplicate(id: string): SpatialInstance | null {
    const source = this.instances.get(id);
    if (!source) return null;

    const newPos = source.targetPosition.clone().add(new THREE.Vector3(1.2, 0.4, 0));

    let newInst: SpatialInstance;
    if (source.isReconstructed) {
      let clonedGeo: THREE.BufferGeometry | null = null;
      source.modelGroup.traverse((child) => {
        if (!clonedGeo && child instanceof THREE.Mesh && child.geometry) {
          clonedGeo = child.geometry.clone();
        }
      });
      newInst = clonedGeo
        ? this.createReconstructedInstance(`${source.name} Clone`, clonedGeo, newPos, source.reconstructionMethodLabel)
        : this.createInstance(source.modelId, newPos);
    } else {
      newInst = this.createInstance(source.modelId, newPos);
    }

    newInst.targetScale = source.targetScale;
    newInst.targetRotation.copy(source.targetRotation);
    return newInst;
  }

  public delete(id: string): boolean {
    const inst = this.instances.get(id);
    if (!inst) return false;

    inst.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
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
    ids.forEach((id) => {
      const inst = this.instances.get(id);
      if (inst) inst.groupId = groupId;
    });
    return groupId;
  }

  public ungroupObject(id: string) {
    const inst = this.instances.get(id);
    if (inst) inst.groupId = undefined;
  }

  public applyFormation(formation: LayoutFormation) {
    const list = Array.from(this.instances.values());
    const count = list.length;
    if (count === 0) return;

    if (formation === 'SINGLE') {
      list.forEach((inst, idx) => {
        if (inst.isLocked) return;
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
        if (inst.isLocked) return;
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
        if (inst.isLocked) return;
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
        if (inst.isLocked) return;
        inst.targetPosition.set((idx - (count - 1) / 2) * spacing, 0, 0);
        inst.targetScale = 0.8;
      });
    }
  }

  public setColorTheme(hex: number) {
    this.colorHex = hex;
    this.instances.forEach((inst) => {
      inst.setColorTheme(hex);
      (inst.scanRing.material as THREE.MeshBasicMaterial).color.setHex(hex);
      if (inst.disintegration) {
        (inst.disintegration.points.material as THREE.PointsMaterial).color.setHex(hex);
      }
    });
  }

  public setExplodedView(exploded: boolean) {
    this.instances.forEach((inst) => inst.setExplodedView(exploded));
  }

  public update(time: number, speedMultiplier: number = 1.0, delta: number = 0.016) {
    const clampedDt = Math.max(0.001, Math.min(0.1, delta));
    const lerpFactor = 1 - Math.exp(-8.5 * clampedDt);

    this.instances.forEach((inst) => {
      inst.currentPosition.lerp(inst.targetPosition, lerpFactor);
      inst.group.position.copy(inst.currentPosition);

      inst.currentScale += (inst.targetScale - inst.currentScale) * lerpFactor;
      inst.group.scale.set(inst.currentScale, inst.currentScale, inst.currentScale);

      inst.currentRotation.x += (inst.targetRotation.x - inst.currentRotation.x) * lerpFactor;
      inst.currentRotation.y += (inst.targetRotation.y - inst.currentRotation.y) * lerpFactor;
      inst.currentRotation.z += (inst.targetRotation.z - inst.currentRotation.z) * lerpFactor;
      inst.group.rotation.copy(inst.currentRotation);

      if (inst.selectionBox.visible) {
        inst.selectionBox.rotation.y += inst.isFrozen ? 0.002 : 0.015;
      }

      // Particle Disintegration & Reversible Convergence Animation
      if (inst.disintegration) {
        inst.currentDisintegration += (inst.targetDisintegration - inst.currentDisintegration) * 0.08;
        const d = inst.currentDisintegration;

        if (d > 0.015) {
          inst.disintegration.points.visible = true;
          inst.modelGroup.visible = d < 0.42;

          const posAttr = inst.disintegration.points.geometry.getAttribute('position') as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          const base = inst.disintegration.basePositions;
          const vel = inst.disintegration.burstVelocities;
          const swirl = d * 1.4;
          const cosS = Math.cos(swirl);
          const sinS = Math.sin(swirl);

          for (let i = 0; i < inst.disintegration.count; i++) {
            const idx = i * 3;
            const ox = base[idx] + vel[idx] * d;
            const oy = base[idx + 1] + vel[idx + 1] * d + Math.sin(time * 2 + i * 0.05) * 0.08 * d;
            const oz = base[idx + 2] + vel[idx + 2] * d;

            arr[idx] = ox * cosS - oz * sinS;
            arr[idx + 1] = oy;
            arr[idx + 2] = ox * sinS + oz * cosS;
          }
          posAttr.needsUpdate = true;
          (inst.disintegration.points.material as THREE.PointsMaterial).opacity = Math.max(0.25, 0.95 - d * 0.4);
        } else {
          inst.disintegration.points.visible = false;
          inst.modelGroup.visible = true;
        }
      }

      // Holographic Laser Reconstruction Sweep Ring
      if (inst.isScanning) {
        inst.scanProgress += 0.024;
        inst.scanRing.visible = true;
        inst.scanRing.position.y = -1.7 + inst.scanProgress * 3.4;
        const mat = inst.scanRing.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.sin(Math.min(1, inst.scanProgress) * Math.PI) * 0.85;
        if (inst.scanProgress >= 1.0) {
          inst.isScanning = false;
          inst.scanRing.visible = false;
        }
      }

      if (inst.visionSphereObj) {
        inst.visionSphereObj.update(time, inst.isFrozen ? 0.12 : speedMultiplier, delta);
        inst.currentDisintegration = inst.visionSphereObj.getDispersion();
        const st = inst.visionSphereObj.getDispersionState();
        if (st === 'DISPERSED') inst.dispersionPhase = 'DISPERSED';
        else if (st === 'RECONSTRUCTING') inst.dispersionPhase = 'RECONSTRUCTING';
        else if (st === 'EXPANDING') inst.dispersionPhase = 'EXPANDING';
        else inst.dispersionPhase = 'COMPLETE';
      } else {
        inst.update(time, inst.isFrozen ? 0.15 : speedMultiplier);
      }
    });
  }

  public clearAll() {
    Array.from(this.instances.keys()).forEach((id) => this.delete(id));
  }
}
