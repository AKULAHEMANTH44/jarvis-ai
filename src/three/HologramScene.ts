import * as THREE from 'three';
import { HologramModelId, HologramVisualSettings } from '../types/hologram';
import { ArcReactorObject } from './objects/ArcReactor';
import { QuantumTesseractObject } from './objects/QuantumTesseract';
import { IronManArmorObject } from './objects/IronManArmor';
import { HolographicGlobeObject } from './objects/HolographicGlobe';
import { MolecularHelixObject } from './objects/MolecularHelix';
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

  // Active models
  private currentModelId: HologramModelId = 'arc_reactor';
  private modelRoot: THREE.Group;
  private arcReactor: ArcReactorObject;
  private tesseract: QuantumTesseractObject;
  private ironArmor: IronManArmorObject;
  private holoGlobe: HolographicGlobeObject;
  private molecularHelix: MolecularHelixObject;

  // Visual Effects
  private shockwave: EnergyShockwaveEffect;
  private particleField: ParticleFieldEffect;
  private ringGimbals: RingGimbalsEffect;

  // Transforms & Inertia
  public targetPosition = new THREE.Vector3(0, 0, 0);
  public currentPosition = new THREE.Vector3(0, 0, 0);
  public targetRotation = new THREE.Euler(0, 0, 0);
  public currentRotation = new THREE.Euler(0, 0, 0);
  public targetScale: number = 1.0;
  public currentScale: number = 1.0;
  public autoRotate: boolean = true;
  public rotationSpeed: number = 1.0;

  private isDragging: boolean = false;
  private settings: HologramVisualSettings;

  constructor(container: HTMLElement, initialSettings: HologramVisualSettings) {
    this.container = container;
    this.settings = initialSettings;
    this.clock = new THREE.Clock();

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
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 7.5);

    // 3. Lighting
    const ambient = new THREE.AmbientLight(0x003355, 1.2);
    this.scene.add(ambient);

    const dirLight1 = new THREE.DirectionalLight(0x00f0ff, 2.0);
    dirLight1.position.set(5, 5, 5);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x0077ff, 1.5);
    dirLight2.position.set(-5, -3, 3);
    this.scene.add(dirLight2);

    const pointLight = new THREE.PointLight(0xffffff, 2.0, 12);
    pointLight.position.set(0, 0, 2);
    this.scene.add(pointLight);

    // 4. Model Group
    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    // Color theme hex
    const colorHex = this.getThemeHex(initialSettings.colorTheme);

    // Instantiate 3D Models
    this.arcReactor = new ArcReactorObject(colorHex);
    this.tesseract = new QuantumTesseractObject(colorHex);
    this.ironArmor = new IronManArmorObject(colorHex);
    this.holoGlobe = new HolographicGlobeObject(colorHex);
    this.molecularHelix = new MolecularHelixObject(colorHex);

    // Add all to root, make default visible
    this.modelRoot.add(this.arcReactor.group);
    this.modelRoot.add(this.tesseract.group);
    this.modelRoot.add(this.ironArmor.group);
    this.modelRoot.add(this.holoGlobe.group);
    this.modelRoot.add(this.molecularHelix.group);

    this.setModel(this.currentModelId);

    // 5. Environmental & Cinematic Effects
    this.ringGimbals = new RingGimbalsEffect(colorHex);
    this.scene.add(this.ringGimbals.group);

    this.particleField = new ParticleFieldEffect(1200, colorHex);
    this.scene.add(this.particleField.points);

    this.shockwave = new EnergyShockwaveEffect(colorHex);
    this.scene.add(this.shockwave.group);

    // 6. Event Listeners
    window.addEventListener('resize', this.onWindowResize);

    // Start Render Loop
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

  public setModel(modelId: HologramModelId) {
    this.currentModelId = modelId;
    this.arcReactor.group.visible = modelId === 'arc_reactor';
    this.tesseract.group.visible = modelId === 'quantum_tesseract';
    this.ironArmor.group.visible = modelId === 'ironman_armor';
    this.holoGlobe.group.visible = modelId === 'planetary_defense';
    this.molecularHelix.group.visible = modelId === 'molecular_dna';

    // Model entrance pop animation
    this.currentScale = 0.4;
  }

  public getModelId(): HologramModelId {
    return this.currentModelId;
  }

  public nextModel(): HologramModelId {
    const list: HologramModelId[] = [
      'arc_reactor',
      'quantum_tesseract',
      'ironman_armor',
      'planetary_defense',
      'molecular_dna'
    ];
    const idx = list.indexOf(this.currentModelId);
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
      'molecular_dna'
    ];
    const idx = list.indexOf(this.currentModelId);
    const prevIdx = (idx - 1 + list.length) % list.length;
    this.setModel(list[prevIdx]);
    return list[prevIdx];
  }

  public updateVisualSettings(settings: Partial<HologramVisualSettings>) {
    this.settings = { ...this.settings, ...settings };
    if (settings.colorTheme) {
      const hex = this.getThemeHex(settings.colorTheme);
      this.arcReactor.setColorTheme(hex);
      this.tesseract.setColorTheme(hex);
      this.ironArmor.setColorTheme(hex);
      this.holoGlobe.setColorTheme(hex);
      this.molecularHelix.setColorTheme(hex);
      this.ringGimbals.setColorTheme(hex);
      this.particleField.setColorTheme(hex);
      this.shockwave.setColorTheme(hex);
    }
    if (settings.explodedView !== undefined) {
      this.arcReactor.setExplodedView(settings.explodedView);
      this.tesseract.setExplodedView(settings.explodedView);
      this.ironArmor.setExplodedView(settings.explodedView);
      this.holoGlobe.setExplodedView(settings.explodedView);
      this.molecularHelix.setExplodedView(settings.explodedView);
    }
  }

  public triggerShockwave() {
    this.shockwave.trigger(this.modelRoot.position.clone());
  }

  public resetTransform() {
    this.targetPosition.set(0, 0, 0);
    this.targetRotation.set(0, 0, 0);
    this.targetScale = 1.0;
  }

  public applyDeltaTranslation(dx: number, dy: number, dz: number) {
    this.targetPosition.x += dx;
    this.targetPosition.y += dy;
    this.targetPosition.z += dz;

    // Constrain within bounds
    this.targetPosition.x = Math.max(-3.5, Math.min(3.5, this.targetPosition.x));
    this.targetPosition.y = Math.max(-2.5, Math.min(2.5, this.targetPosition.y));
    this.targetPosition.z = Math.max(-2.0, Math.min(2.0, this.targetPosition.z));
  }

  public applyDeltaRotation(rx: number, ry: number, rz: number) {
    this.targetRotation.x += rx;
    this.targetRotation.y += ry;
    this.targetRotation.z += rz;
  }

  public applyScaleMultiplier(multiplier: number) {
    this.targetScale *= multiplier;
    this.targetScale = Math.max(0.4, Math.min(2.8, this.targetScale));
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

    // Smooth transform damping (Interpolation / Lerp)
    const lerpFactor = 0.12;
    this.currentPosition.lerp(this.targetPosition, lerpFactor);
    this.modelRoot.position.copy(this.currentPosition);

    this.currentScale += (this.targetScale - this.currentScale) * lerpFactor;
    this.modelRoot.scale.set(this.currentScale, this.currentScale, this.currentScale);

    // Idle floating levitation
    const levitationY = Math.sin(elapsedTime * 1.5) * 0.08;
    this.modelRoot.position.y += levitationY;

    // Rotation interpolation
    if (this.autoRotate) {
      this.targetRotation.y += 0.008 * this.rotationSpeed;
    }
    this.currentRotation.x += (this.targetRotation.x - this.currentRotation.x) * lerpFactor;
    this.currentRotation.y += (this.targetRotation.y - this.currentRotation.y) * lerpFactor;
    this.currentRotation.z += (this.targetRotation.z - this.currentRotation.z) * lerpFactor;
    this.modelRoot.rotation.copy(this.currentRotation);

    // Update active 3D model
    const speed = this.settings.rotationSpeed;
    if (this.currentModelId === 'arc_reactor') {
      this.arcReactor.update(elapsedTime, speed);
    } else if (this.currentModelId === 'quantum_tesseract') {
      this.tesseract.update(elapsedTime, speed);
    } else if (this.currentModelId === 'ironman_armor') {
      this.ironArmor.update(elapsedTime, speed);
    } else if (this.currentModelId === 'planetary_defense') {
      this.holoGlobe.update(elapsedTime, speed);
    } else if (this.currentModelId === 'molecular_dna') {
      this.molecularHelix.update(elapsedTime, speed);
    }

    // Update Environmental Effects
    this.ringGimbals.update(elapsedTime, speed);
    this.particleField.update(elapsedTime);
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
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
