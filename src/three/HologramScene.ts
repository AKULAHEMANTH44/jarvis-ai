import * as THREE from 'three';
import { HologramModelId, HologramVisualSettings, LayoutFormation, SpatialObjectState } from '../types/hologram';
import { SpatialObjectManager, SpatialInstance } from './SpatialObjectManager';
import { EnergyShockwaveEffect } from './effects/EnergyShockwave';
import { ParticleFieldEffect } from './effects/ParticleField';
import { RingGimbalsEffect } from './effects/RingGimbals';

export class HologramSceneManager {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
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

  public autoRotate: boolean = true;
  public rotationSpeed: number = 1.0;

  private lastUserInteractionTime: number = 0;
  private activeHandCentroid?: { x: number; y: number; z: number };
  private settings: HologramVisualSettings;

  constructor(container: HTMLElement, initialSettings: HologramVisualSettings) {
    this.container = container;
    this.settings = initialSettings;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();

    // 1. Scene & Renderer
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 7.8);

    // 3. Lighting
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

    // 4. Model Root & Spatial Manager
    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    const colorHex = this.getThemeHex(initialSettings.colorTheme);
    this.spatialManager = new SpatialObjectManager(this.modelRoot, colorHex);

    // Create initial central Arc Reactor
    this.spatialManager.createInstance('arc_reactor', new THREE.Vector3(0, 0, 0));

    // 5. Environmental & Cinematic Effects
    this.ringGimbals = new RingGimbalsEffect(colorHex);
    this.scene.add(this.ringGimbals.group);

    this.particleField = new ParticleFieldEffect(1500, colorHex);
    this.scene.add(this.particleField.points);

    this.shockwave = new EnergyShockwaveEffect(colorHex);
    this.scene.add(this.shockwave.group);

    // 6. Listeners
    window.addEventListener('resize', this.onWindowResize);

    // Start render loop
    this.animate();
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
    return selected ? selected.modelId : 'arc_reactor';
  }

  public nextModel(): HologramModelId {
    const list: HologramModelId[] = [
      'arc_reactor',
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
      'arc_reactor',
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

  // Raycasting for point / click selection in 3D
  public raycastSelect(ndcX: number, ndcY: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const instances = this.spatialManager.getAll();

    for (const inst of instances) {
      const intersects = this.raycaster.intersectObjects(inst.group.children, true);
      if (intersects.length > 0) {
        this.spatialManager.select(inst.id);
        return inst.id;
      }
    }
    return null;
  }

  public updateVisualSettings(settings: Partial<HologramVisualSettings>) {
    this.settings = { ...this.settings, ...settings };
    if (settings.colorTheme) {
      const hex = this.getThemeHex(settings.colorTheme);
      this.spatialManager.setColorTheme(hex);
      this.ringGimbals.setColorTheme(hex);
      this.particleField.setColorTheme(hex);
      this.shockwave.setColorTheme(hex);
    }
    if (settings.explodedView !== undefined) {
      this.spatialManager.setExplodedView(settings.explodedView);
    }
    if (settings.spatialFormation !== undefined) {
      this.spatialManager.applyFormation(settings.spatialFormation);
    }
  }

  public setHandCentroid(centroid?: { x: number; y: number; z: number }) {
    this.activeHandCentroid = centroid;
  }

  public triggerShockwave() {
    const selected = this.spatialManager.getSelected();
    const origin = selected ? selected.group.position.clone() : new THREE.Vector3(0, 0, 0);
    this.shockwave.trigger(origin);
  }

  public resetTransform() {
    const selected = this.spatialManager.getSelected();
    if (selected) {
      selected.targetPosition.set(0, 0, 0);
      selected.currentRotation.x %= (Math.PI * 2);
      selected.currentRotation.y %= (Math.PI * 2);
      selected.currentRotation.z %= (Math.PI * 2);
      selected.targetRotation.set(0, 0, 0);
      selected.targetScale = 1.0;
    }
  }

  public applyDeltaTranslation(dx: number, dy: number, dz: number) {
    this.lastUserInteractionTime = performance.now();
    const selected = this.spatialManager.getSelected();
    if (!selected) return;

    // If part of a group, move the whole group together!
    const targetInstances = selected.groupId
      ? this.spatialManager.getAll().filter(i => i.groupId === selected.groupId)
      : [selected];

    targetInstances.forEach(inst => {
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
    if (!selected) return;

    selected.targetRotation.x += rx;
    selected.targetRotation.y += ry;
    selected.targetRotation.z += rz;
  }

  public applyScaleMultiplier(multiplier: number) {
    this.lastUserInteractionTime = performance.now();
    const selected = this.spatialManager.getSelected();
    if (!selected) return;

    selected.targetScale *= multiplier;
    selected.targetScale = Math.max(0.3, Math.min(3.2, selected.targetScale));
  }

  private onWindowResize = () => {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private animate = () => {
    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();
    const now = performance.now();

    const speed = this.settings.rotationSpeed;
    const isUserActive = (now - this.lastUserInteractionTime) < 1200;

    // Auto-rotate selected object when user is idle
    const selected = this.spatialManager.getSelected();
    if (this.autoRotate && !isUserActive && selected) {
      selected.targetRotation.y += 0.008 * speed;
    }

    // Update all spatial instances
    this.spatialManager.update(elapsedTime, speed);

    // Update Environmental Effects
    this.ringGimbals.update(elapsedTime, speed);
    this.particleField.update(elapsedTime, this.activeHandCentroid);
    this.shockwave.update(delta);

    // Render Scene
    this.renderer.render(this.scene, this.camera);

    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  public destroy() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.onWindowResize);
    this.spatialManager.clearAll();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
