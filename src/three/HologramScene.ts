import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  ComponentLabel2D,
  DispersionPhase,
  HologramModelId,
  HologramVisualSettings,
  LaserTargetInfo,
  LayoutFormation,
  ReconstructionPresetId,
  SliceAxis,
  SpatialObjectState
} from '../types/hologram';
import { SpatialObjectManager, SpatialInstance } from './SpatialObjectManager';
import { EnergyShockwaveEffect } from './effects/EnergyShockwave';
import { ParticleFieldEffect } from './effects/ParticleField';
import { RingGimbalsEffect } from './effects/RingGimbals';
import {
  buildDepthReliefGeometry,
  buildPresetGeometry,
  parseGLTFOrGLB,
  parseOBJ,
  parseSTL,
  reconstructFromImageFiles
} from './objects/ReconstructedHologram';

export class HologramSceneManager {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private isSoftwareGl: boolean = false;
  private animationFrameId: number | null = null;
  private clock: THREE.Clock;
  private raycaster: THREE.Raycaster;

  // Multi-Object Spatial Manager
  public spatialManager: SpatialObjectManager;
  private modelRoot: THREE.Group;

  // Visual Effects
  private shockwave: EnergyShockwaveEffect;
  private particleField: ParticleFieldEffect;
  private ringGimbals: RingGimbalsEffect;

  // Tomography Slice Plane & Visual Frame
  private slicePlane: THREE.Plane;
  private sliceFrame: THREE.LineSegments;

  // 3D Laser Pointer Reticle (Two-Finger Point / Inspection)
  private laserReticle: THREE.Group;

  public autoRotate: boolean = true;
  public rotationSpeed: number = 1.0;

  private lastUserInteractionTime: number = 0;
  private activeHandCentroid?: { x: number; y: number; z: number };
  private settings: HologramVisualSettings;
  private angularVelocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private lastDispersionAmount: number = 0;
  private lastDispersionShockwaveTime: number = 0;

  constructor(container: HTMLElement, initialSettings: HologramVisualSettings) {
    this.container = container;
    this.settings = initialSettings;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();

    // 1. Scene & Renderer
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02070e);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.localClippingEnabled = true;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);

    // Detect software WebGL rasterizers where multi-pass bloom degrades FPS
    try {
      const gl = this.renderer.getContext();
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const unmaskedRenderer = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : '';
      this.isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(unmaskedRenderer);
    } catch {
      this.isSoftwareGl = false;
    }

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 7.8);

    // 3. Post-Processing Bloom Pipeline (skipped on software GL or reducedEffects mode)
    if (!this.isSoftwareGl && !initialSettings.reducedEffects) {
      this.initComposer(width, height, initialSettings.glowIntensity);
    }

    // 4. Lighting
    const ambient = new THREE.AmbientLight(0x003355, 1.4);
    this.scene.add(ambient);

    const dirLight1 = new THREE.DirectionalLight(0x00f0ff, 2.2);
    dirLight1.position.set(5, 5, 5);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x0077ff, 1.6);
    dirLight2.position.set(-5, -3, 3);
    this.scene.add(dirLight2);

    const pointLight = new THREE.PointLight(0xffffff, 2.2, 14);
    pointLight.position.set(0, 0, 2);
    this.scene.add(pointLight);

    // 5. Model Root & Spatial Manager (Default to VISION 1.2 CORE)
    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    const colorHex = this.getThemeHex(initialSettings.colorTheme);
    this.spatialManager = new SpatialObjectManager(this.modelRoot, colorHex);
    this.spatialManager.createInstance('vision_sphere', new THREE.Vector3(0, 0, 0));

    // 6. Environmental & Cinematic Effects
    this.ringGimbals = new RingGimbalsEffect(colorHex);
    this.scene.add(this.ringGimbals.group);

    const initialParticles = initialSettings.reducedEffects
      ? Math.min(1100, initialSettings.particleCount || 1100)
      : initialSettings.particleCount || 1500;
    this.particleField = new ParticleFieldEffect(initialParticles, colorHex);
    this.scene.add(this.particleField.points);

    this.shockwave = new EnergyShockwaveEffect(colorHex);
    this.scene.add(this.shockwave.group);

    // 7. Tomography Cross-Section Clipping Plane & Visual Guide Frame
    this.slicePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.sliceFrame = this.createSliceFrame(colorHex);
    this.sliceFrame.visible = false;
    this.scene.add(this.sliceFrame);

    // 8. 3D Laser Targeting Reticle
    this.laserReticle = this.createLaserReticle();
    this.laserReticle.visible = false;
    this.scene.add(this.laserReticle);

    // Apply initial visual settings cleanly
    this.updateVisualSettings(initialSettings);

    // 9. Listeners
    window.addEventListener('resize', this.onWindowResize);

    this.animate();
  }

  private initComposer(width: number, height: number, glowIntensity: number) {
    if (this.composer) return;
    try {
      const composer = new EffectComposer(this.renderer);
      const renderPass = new RenderPass(this.scene, this.camera);
      composer.addPass(renderPass);

      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        Math.min(0.85, 0.28 + glowIntensity * 0.16),
        0.52,
        0.38
      );
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());

      this.composer = composer;
      this.bloomPass = bloomPass;
    } catch {
      this.composer = null;
      this.bloomPass = null;
    }
  }

  private disposeComposer() {
    if (this.bloomPass) {
      this.bloomPass.dispose();
      this.bloomPass = null;
    }
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
  }

  private createSliceFrame(colorHex: number): THREE.LineSegments {
    const s = 2.2;
    const pts = [
      new THREE.Vector3(-s, 0, -s), new THREE.Vector3(s, 0, -s),
      new THREE.Vector3(s, 0, -s), new THREE.Vector3(s, 0, s),
      new THREE.Vector3(s, 0, s), new THREE.Vector3(-s, 0, s),
      new THREE.Vector3(-s, 0, s), new THREE.Vector3(-s, 0, -s),
      new THREE.Vector3(-s, 0, 0), new THREE.Vector3(s, 0, 0),
      new THREE.Vector3(0, 0, -s), new THREE.Vector3(0, 0, s)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    return new THREE.LineSegments(geo, mat);
  }

  private createLaserReticle(): THREE.Group {
    const group = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.14, 0.19, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    group.add(ring);

    const dotGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    group.add(dot);

    return group;
  }

  private getThemeHex(theme: HologramVisualSettings['colorTheme']): number {
    switch (theme) {
      case 'orange': return 0xff8800;
      case 'matrix_green': return 0x00ffaa;
      case 'red_alert': return 0xff2244;
      case 'cyan':
      default: return 0x00f0ff;
    }
  }

  // Model switching / creation
  public setModel(modelId: HologramModelId) {
    const selected = this.spatialManager.getSelected();
    if (selected) {
      const pos = selected.targetPosition.clone();
      this.spatialManager.delete(selected.id);
      this.spatialManager.createInstance(modelId, pos);
    } else {
      this.spatialManager.createInstance(modelId, new THREE.Vector3(0, 0, 0));
    }
  }

  public getModelId(): HologramModelId {
    const selected = this.spatialManager.getSelected();
    return selected ? selected.modelId : 'vision_sphere';
  }

  public nextModel(): HologramModelId {
    const list: HologramModelId[] = [
      'vision_sphere',
      'arc_reactor',
      'sports_car',
      'cyber_motorcycle',
      'jet_turbine_engine',
      'holo_smartphone',
      'quantum_workstation',
      'stark_skyscraper',
      'industrial_robot_arm',
      'planetary_gearbox',
      'atom_orbital_model',
      'quantum_tesseract',
      'ironman_armor',
      'planetary_defense',
      'molecular_dna',
      'carbon_buckyball',
      'hologram_datachart'
    ];
    const current = this.getModelId();
    const idx = list.indexOf(current);
    const nextIdx = (idx + 1) % list.length;
    this.setModel(list[nextIdx]);
    return list[nextIdx];
  }

  public prevModel(): HologramModelId {
    const list: HologramModelId[] = [
      'vision_sphere',
      'arc_reactor',
      'sports_car',
      'cyber_motorcycle',
      'jet_turbine_engine',
      'holo_smartphone',
      'quantum_workstation',
      'stark_skyscraper',
      'industrial_robot_arm',
      'planetary_gearbox',
      'atom_orbital_model',
      'quantum_tesseract',
      'ironman_armor',
      'planetary_defense',
      'molecular_dna',
      'carbon_buckyball',
      'hologram_datachart'
    ];
    const current = this.getModelId();
    const idx = list.indexOf(current);
    const prevIdx = (idx - 1 + list.length) % list.length;
    this.setModel(list[prevIdx]);
    return list[prevIdx];
  }

  public addSpatialObject(modelId: HologramModelId, position?: THREE.Vector3): SpatialInstance {
    const defaultPos = position || new THREE.Vector3(
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 2,
      0
    );
    return this.spatialManager.createInstance(modelId, defaultPos);
  }

  // Reconstruction Lab: synthesize procedural preset specimen
  public synthesizePreset(presetId: ReconstructionPresetId): SpatialInstance {
    const { name, geometry } = buildPresetGeometry(presetId);
    return this.spatialManager.createReconstructedInstance(
      name,
      geometry,
      new THREE.Vector3(0, 0, 0),
      'PROCEDURAL STARK LAB SPECIMEN'
    );
  }

  // Reconstruction Lab: import local .GLB, .GLTF, .OBJ or .STL mesh
  public async importMeshFromFile(file: File): Promise<SpatialInstance> {
    const lower = file.name.toLowerCase();
    const cleanName = file.name.replace(/\.(glb|gltf|obj|stl)$/i, '').slice(0, 28) || 'Imported Model';

    if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
      const buf = await file.arrayBuffer();
      const parsed = await parseGLTFOrGLB(buf, file.name);
      return this.spatialManager.createReconstructedInstance(
        cleanName,
        parsed.group,
        new THREE.Vector3(0, 0, 0),
        `IMPORTED GLTF/GLB MESH (${parsed.componentCount} parts)`
      );
    }

    let geometry: THREE.BufferGeometry;
    if (lower.endsWith('.obj')) {
      const text = await file.text();
      geometry = parseOBJ(text);
    } else if (lower.endsWith('.stl')) {
      const buf = await file.arrayBuffer();
      geometry = parseSTL(buf);
    } else {
      throw new Error('Unsupported format. Please select a .glb, .gltf, .obj, or .stl file.');
    }

    return this.spatialManager.createReconstructedInstance(
      cleanName,
      geometry,
      new THREE.Vector3(0, 0, 0),
      `IMPORTED ${lower.endsWith('.obj') ? 'OBJ' : 'STL'} GEOMETRY`
    );
  }

  // Honest Image / Multi-View Upload Reconstruction
  public async reconstructFromImages(files: File[]): Promise<SpatialInstance> {
    const { name, geometry, methodLabel } = await reconstructFromImageFiles(files);
    return this.spatialManager.createReconstructedInstance(
      name,
      geometry,
      new THREE.Vector3(0, 0, 0),
      methodLabel
    );
  }

  // Reconstruction Lab: capture live webcam frame into an illustrative 2.5D depth-relief mesh
  public reconstructFromVideo(videoEl: HTMLVideoElement): SpatialInstance | null {
    if (!videoEl || videoEl.readyState < 2) return null;

    const canvas = document.createElement('canvas');
    const w = 96;
    const h = 72;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(videoEl, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const geometry = buildDepthReliefGeometry(imageData.data, w, h, 48, 36);
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    return this.spatialManager.createReconstructedInstance(
      `Optical Scan ${timestamp}`,
      geometry,
      new THREE.Vector3(0, 0, 0),
      'ILLUSTRATIVE 2.5D DEPTH RELIEF (Live optical camera frame)'
    );
  }

  public triggerReconstructionScan(id?: string) {
    this.spatialManager.triggerReconstructionScan(id);
  }

  public disintegrateObject(id?: string): boolean {
    const ok = this.spatialManager.disintegrate(id);
    if (ok) {
      this.ringGimbals.setCoreActivity({ energyBoost: 1.0 });
      this.triggerShockwave();
    }
    return ok;
  }

  public reconstructObject(id?: string): boolean {
    const ok = this.spatialManager.reconstruct(id);
    if (ok) {
      this.ringGimbals.setCoreActivity({ energyBoost: 0.9 });
    }
    return ok;
  }

  public rotate360(id?: string): boolean {
    this.lastUserInteractionTime = performance.now();
    return this.spatialManager.triggerRotate360(id);
  }

  public setCoreActivity(activity: { isListening?: boolean; isSpeaking?: boolean; energyBoost?: number }) {
    this.ringGimbals.setCoreActivity(activity);
  }

  public getProjectedComponentLabels(): ComponentLabel2D[] {
    if (!this.container) return [];
    return this.spatialManager.getSelectedComponentLabels(
      this.camera,
      this.container.clientWidth,
      this.container.clientHeight
    );
  }

  public toggleObjectLock(id: string): boolean {
    return this.spatialManager.toggleLock(id);
  }

  public setObjectTransform(
    id: string,
    transform: {
      position?: Partial<{ x: number; y: number; z: number }>;
      rotation?: Partial<{ x: number; y: number; z: number }>;
      scale?: number;
    }
  ) {
    this.lastUserInteractionTime = performance.now();
    this.spatialManager.setObjectTransform(id, transform);
  }

  public duplicateSelected(): SpatialInstance | null {
    const selected = this.spatialManager.getSelected();
    if (!selected) return null;
    return this.spatialManager.duplicate(selected.id);
  }

  public deleteSelected(): boolean {
    const selected = this.spatialManager.getSelected();
    if (!selected) return false;
    return this.spatialManager.delete(selected.id);
  }

  public applyFormation(formation: LayoutFormation) {
    this.settings.spatialFormation = formation;
    this.spatialManager.applyFormation(formation);
  }

  public getSpatialStates(): SpatialObjectState[] {
    return this.spatialManager.getStates();
  }

  public selectObject(id: string | null) {
    this.spatialManager.select(id);
  }

  public raycastSelect(ndcX: number, ndcY: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const instances = this.spatialManager.getAll();

    for (const inst of instances) {
      const intersects = this.raycaster.intersectObjects(inst.modelGroup.children, true);
      if (intersects.length > 0) {
        this.spatialManager.select(inst.id);
        return inst.id;
      }
    }
    return null;
  }

  // Precision 3D Laser Pointer / Two-Finger Point targeting reticle
  public updateLaserPointer(ndcX: number, ndcY: number, active: boolean): LaserTargetInfo | null {
    if (!active) {
      this.laserReticle.visible = false;
      return null;
    }

    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const instances = this.spatialManager.getAll();

    let closestHit: { dist: number; point: THREE.Vector3; inst: SpatialInstance } | null = null;
    for (const inst of instances) {
      const intersects = this.raycaster.intersectObjects(inst.modelGroup.children, true);
      if (intersects.length > 0) {
        const hit = intersects[0];
        if (!closestHit || hit.distance < closestHit.dist) {
          closestHit = { dist: hit.distance, point: hit.point, inst };
        }
      }
    }

    if (closestHit) {
      this.laserReticle.visible = true;
      this.laserReticle.position.copy(closestHit.point);
      this.laserReticle.lookAt(this.camera.position);
      return {
        objectId: closestHit.inst.id,
        objectName: closestHit.inst.name,
        point: {
          x: closestHit.point.x,
          y: closestHit.point.y,
          z: closestHit.point.z
        }
      };
    }

    // Project onto Z=0 plane if no direct mesh hit
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.z) > 0.001) {
      const t = -ray.origin.z / ray.direction.z;
      if (t > 0) {
        const pt = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
        this.laserReticle.visible = true;
        this.laserReticle.position.copy(pt);
        this.laserReticle.lookAt(this.camera.position);
      }
    }
    return null;
  }

  private updateSlicePlane(enabled: boolean, axis: SliceAxis, offset: number) {
    if (!enabled) {
      this.sliceFrame.visible = false;
      this.spatialManager.applyClippingPlanes([]);
      return;
    }

    if (axis === 'x') {
      this.slicePlane.normal.set(-1, 0, 0);
      this.sliceFrame.rotation.set(0, 0, Math.PI / 2);
      this.sliceFrame.position.set(offset, 0, 0);
    } else if (axis === 'z') {
      this.slicePlane.normal.set(0, 0, -1);
      this.sliceFrame.rotation.set(Math.PI / 2, 0, 0);
      this.sliceFrame.position.set(0, 0, offset);
    } else {
      this.slicePlane.normal.set(0, -1, 0);
      this.sliceFrame.rotation.set(0, 0, 0);
      this.sliceFrame.position.set(0, offset, 0);
    }

    this.slicePlane.constant = offset;
    this.sliceFrame.visible = true;
    this.spatialManager.applyClippingPlanes([this.slicePlane]);
  }

  public updateVisualSettings(settings: Partial<HologramVisualSettings>) {
    this.settings = { ...this.settings, ...settings };

    if (settings.reducedEffects !== undefined && !this.isSoftwareGl) {
      if (settings.reducedEffects) {
        this.disposeComposer();
      } else if (this.container) {
        this.initComposer(
          Math.max(1, this.container.clientWidth),
          Math.max(1, this.container.clientHeight),
          this.settings.glowIntensity
        );
      }
    }

    if (settings.colorTheme) {
      const hex = this.getThemeHex(settings.colorTheme);
      this.spatialManager.setColorTheme(hex);
      this.ringGimbals.setColorTheme(hex);
      this.particleField.setColorTheme(hex);
      this.shockwave.setColorTheme(hex);
      (this.sliceFrame.material as THREE.LineBasicMaterial).color.setHex(hex);
    }
    if (settings.renderMode !== undefined) {
      this.spatialManager.setGlobalRenderMode(settings.renderMode);
    }
    if (settings.glowIntensity !== undefined) {
      this.spatialManager.setGlowIntensity(settings.glowIntensity);
      this.particleField.setGlowIntensity(settings.glowIntensity);
      if (this.bloomPass) {
        this.bloomPass.strength = Math.min(0.85, 0.25 + settings.glowIntensity * 0.16);
      }
    }
    if (settings.particleCount !== undefined || settings.reducedEffects !== undefined) {
      const targetCount = this.settings.reducedEffects
        ? Math.min(1100, this.settings.particleCount)
        : this.settings.particleCount;
      this.particleField.setParticleCount(targetCount);
      this.spatialManager.getAll().forEach((inst) => {
        inst.visionSphereObj?.setParticleCount(targetCount);
      });
    }
    if (settings.pulseEnabled !== undefined) {
      this.spatialManager.setPulseEnabled(settings.pulseEnabled);
    }
    if (settings.showBoundingBoxes !== undefined) {
      this.spatialManager.setShowBoundingBoxes(settings.showBoundingBoxes);
    }
    if (settings.explosionAmount !== undefined) {
      this.spatialManager.setExplosionAmount(settings.explosionAmount);
    } else if (settings.explodedView !== undefined) {
      this.spatialManager.setExplodedView(settings.explodedView);
    }
    if (settings.dispersionAmount !== undefined) {
      this.setDispersion(settings.dispersionAmount);
    }
    if (settings.spatialFormation !== undefined) {
      this.spatialManager.applyFormation(settings.spatialFormation);
    }
    if (
      settings.sliceEnabled !== undefined ||
      settings.sliceAxis !== undefined ||
      settings.sliceOffset !== undefined
    ) {
      this.updateSlicePlane(
        this.settings.sliceEnabled,
        this.settings.sliceAxis,
        this.settings.sliceOffset
      );
    }

    // Forward VISION 1.2 independent layer tuning parameters
    this.spatialManager.getAll().forEach((inst) => {
      inst.visionSphereObj?.setParameters({
        rotationSpeed: this.settings.rotationSpeed,
        particleIntensity: this.settings.particleIntensity,
        orbitalSpeed: this.settings.orbitalSpeed,
        coreBrightness: this.settings.coreBrightness,
        scanSpeed: this.settings.scanSpeed,
        glowIntensity: this.settings.glowIntensity,
        reducedEffects: this.settings.reducedEffects
      });
    });
  }

  public setDispersion(amount: number, phase?: DispersionPhase) {
    const clamped = Math.max(0, Math.min(1, amount));
    this.spatialManager.setGlobalDispersion(clamped, phase);
    this.ringGimbals.setCoreActivity({ energyBoost: 0.25 + clamped * 0.65 });
    if (this.bloomPass) {
      this.bloomPass.strength = Math.min(0.95, 0.25 + this.settings.glowIntensity * 0.16 + clamped * 0.18);
    }

    const now = performance.now();
    if (
      this.lastDispersionAmount < 0.88 &&
      clamped >= 0.88 &&
      now - this.lastDispersionShockwaveTime > 900
    ) {
      this.lastDispersionShockwaveTime = now;
      this.triggerShockwave();
    }
    this.lastDispersionAmount = clamped;
  }

  public setHandCentroid(centroid?: { x: number; y: number; z: number }) {
    this.activeHandCentroid = centroid;
  }

  public triggerShockwave() {
    const selected = this.spatialManager.getSelected();
    const origin = selected ? selected.group.position.clone() : new THREE.Vector3(0, 0, 0);
    this.ringGimbals.setCoreActivity({ energyBoost: 0.85 });
    this.shockwave.trigger(origin);
  }

  public resetTransform() {
    this.angularVelocity.set(0, 0, 0);
    const selected = this.spatialManager.getSelected();
    if (selected && !selected.isLocked) {
      selected.isFrozen = false;
      selected.targetPosition.set(0, 0, 0);
      selected.currentRotation.x %= Math.PI * 2;
      selected.currentRotation.y %= Math.PI * 2;
      selected.currentRotation.z %= Math.PI * 2;
      selected.targetRotation.set(0, 0, 0);
      selected.targetScale = 1.0;
    }
  }

  public applyDeltaTranslation(dx: number, dy: number, dz: number) {
    this.lastUserInteractionTime = performance.now();
    const selected = this.spatialManager.getSelected();
    if (!selected || selected.isLocked || selected.isFrozen) return;

    const targetInstances = selected.groupId
      ? this.spatialManager.getAll().filter((i) => i.groupId === selected.groupId)
      : [selected];

    targetInstances.forEach((inst) => {
      if (inst.isLocked || inst.isFrozen) return;
      inst.targetPosition.x += dx;
      inst.targetPosition.y += dy;
      inst.targetPosition.z += dz;

      inst.targetPosition.x = Math.max(-4.5, Math.min(4.5, inst.targetPosition.x));
      inst.targetPosition.y = Math.max(-3.0, Math.min(3.0, inst.targetPosition.y));
      inst.targetPosition.z = Math.max(-3.0, Math.min(3.0, inst.targetPosition.z));
    });
  }

  public applyDeltaRotation(rx: number, ry: number, rz: number) {
    this.lastUserInteractionTime = performance.now();
    const selected = this.spatialManager.getSelected();
    if (!selected || selected.isLocked || selected.isFrozen) return;

    selected.targetRotation.x += rx;
    selected.targetRotation.y += ry;
    selected.targetRotation.z += rz;
  }

  public applySphericalRotation(rx: number, ry: number, rz: number = 0) {
    this.lastUserInteractionTime = performance.now();
    const selected = this.spatialManager.getSelected();
    if (!selected || selected.isLocked || selected.isFrozen) return;

    // Immediate crisp response + smooth momentum impulse
    selected.targetRotation.x = Math.max(-1.35, Math.min(1.35, selected.targetRotation.x + rx));
    selected.targetRotation.y += ry;
    selected.targetRotation.z += rz;

    this.angularVelocity.x = Math.max(-0.08, Math.min(0.08, this.angularVelocity.x * 0.4 + rx * 0.45));
    this.angularVelocity.y = Math.max(-0.12, Math.min(0.12, this.angularVelocity.y * 0.4 + ry * 0.45));
    this.angularVelocity.z = Math.max(-0.06, Math.min(0.06, this.angularVelocity.z * 0.4 + rz * 0.35));
  }

  public applyScaleMultiplier(multiplier: number) {
    this.lastUserInteractionTime = performance.now();
    const selected = this.spatialManager.getSelected();
    if (!selected || selected.isLocked || selected.isFrozen) return;

    selected.targetScale *= multiplier;
    selected.targetScale = Math.max(0.3, Math.min(3.2, selected.targetScale));
  }

  private onWindowResize = () => {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.setSize(width, height);
    }
  };

  private animate = () => {
    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();
    const now = performance.now();

    const speed = this.settings.rotationSpeed;
    const isUserActive = now - this.lastUserInteractionTime < 1200;

    const selected = this.spatialManager.getSelected();
    if (selected && !selected.isLocked && !selected.isFrozen) {
      // Exponential rotational inertia & damping
      if (this.angularVelocity.lengthSq() > 1e-8) {
        selected.targetRotation.x = Math.max(
          -1.35,
          Math.min(1.35, selected.targetRotation.x + this.angularVelocity.x)
        );
        selected.targetRotation.y += this.angularVelocity.y;
        selected.targetRotation.z += this.angularVelocity.z;

        const damp = Math.exp(-6.5 * Math.max(0.001, Math.min(0.1, delta)));
        this.angularVelocity.multiplyScalar(damp);
        if (this.angularVelocity.lengthSq() < 1e-7) {
          this.angularVelocity.set(0, 0, 0);
        }
      } else if (this.autoRotate && !isUserActive && speed > 0) {
        selected.targetRotation.y += 0.008 * speed;
      }
    } else {
      this.angularVelocity.set(0, 0, 0);
    }

    this.spatialManager.update(elapsedTime, speed, delta);

    this.ringGimbals.update(elapsedTime, speed);
    this.particleField.update(elapsedTime, this.activeHandCentroid);
    this.shockwave.update(delta);

    if (this.laserReticle.visible) {
      const pulse = 1 + Math.sin(elapsedTime * 10) * 0.15;
      this.laserReticle.scale.set(pulse, pulse, pulse);
    }

    if (this.composer && !this.isSoftwareGl && !this.settings.reducedEffects) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  public destroy() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.onWindowResize);
    this.disposeComposer();
    this.spatialManager.clearAll();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
