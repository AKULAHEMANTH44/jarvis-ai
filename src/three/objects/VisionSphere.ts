import * as THREE from 'three';
import {
  ParticleFormationState,
  ParticleSeedPoint,
  ReversibleParticleEngine
} from '../effects/ReversibleParticleEngine';
import { ComponentAnchor } from './RealWorldCatalog';

export interface VisionSphereLayerParams {
  rotationSpeed?: number;
  particleIntensity?: number;
  orbitalSpeed?: number;
  coreBrightness?: number;
  dispersionIntensity?: number;
  scanSpeed?: number;
  glowIntensity?: number;
  reducedEffects?: boolean;
}

const CORE_FRESNEL_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CORE_FRESNEL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBrightness;
  uniform float uTime;
  uniform float uDispersion;

  varying vec3 vNormal;
  varying vec3 vViewPos;

  void main() {
    vec3 viewDir = normalize(vViewPos);
    float ndotv = clamp(dot(viewDir, vNormal), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, 2.2);
    float coreCenter = pow(ndotv, 3.0);
    float pulse = 0.88 + 0.12 * sin(uTime * 5.0);

    vec3 col = mix(uColor, vec3(0.92, 0.99, 1.0), coreCenter * 0.85 + fresnel * 0.45);
    float alpha = (fresnel * 0.85 + coreCenter * 0.65) * pulse * (1.0 - uDispersion * 0.65);
    gl_FragColor = vec4(col * uBrightness, clamp(alpha, 0.0, 1.0));
  }
`;

export class VisionSphereObject {
  public group: THREE.Group;

  // Coordinated layers (all attached to this.group so rotation preserves alignment)
  private outerRingsGroup: THREE.Group;
  private innerRingsGroup: THREE.Group;
  private latLongGroup: THREE.Group;
  private markersGroup: THREE.Group;
  private trajectoriesGroup: THREE.Group;
  private coreGroup: THREE.Group;
  private scanGroup: THREE.Group;
  private radialTicks: THREE.LineSegments;
  private particleEngine: ReversibleParticleEngine;

  private outerArcs: THREE.Object3D[] = [];
  private innerRings: THREE.Object3D[] = [];
  private trajectoryBeads: { mesh: THREE.Mesh; radius: number; tiltX: number; tiltZ: number; speed: number; phase: number }[] = [];
  private scanRingH: THREE.Mesh;
  private scanArcV: THREE.Mesh;
  private coreShaderMat: THREE.ShaderMaterial;
  private coreAuraMat: THREE.MeshBasicMaterial;
  private geodesicMat: THREE.MeshBasicMaterial;
  private latLongLineMat: THREE.LineBasicMaterial;
  private markerMat: THREE.MeshBasicMaterial;
  private outerRingMats: THREE.Material[] = [];
  private innerRingMats: THREE.Material[] = [];
  private anchorNodes: ComponentAnchor[] = [];

  private colorHex: number;
  private targetDispersion: number = 0;
  private currentDispersion: number = 0;
  private targetExplosion: number = 0;
  private currentExplosion: number = 0;

  // Independent layer parameters
  private layerRotationSpeed: number = 1.0;
  private particleIntensity: number = 1.25;
  private orbitalSpeed: number = 1.0;
  private coreBrightness: number = 1.35;
  private dispersionIntensity: number = 1.0;
  private scanSpeed: number = 1.0;
  private glowIntensity: number = 1.5;
  private reducedEffects: boolean = false;
  private baseParticleBudget: number = 3600;

  constructor(colorThemeHex = 0x00f0ff, particleCount = 3600) {
    this.colorHex = colorThemeHex;
    this.baseParticleBudget = Math.max(800, Math.min(5000, particleCount));
    this.group = new THREE.Group();

    const electricBlue = 0x1e88ff;

    // 1. Outer Rotating Orbital Arcs & Rings
    this.outerRingsGroup = new THREE.Group();
    const outerSpecs = [
      { inner: 2.34, outer: 2.38, start: 0, len: Math.PI * 1.45, z: 0.0, opacity: 0.72, color: colorThemeHex },
      { inner: 2.48, outer: 2.53, start: Math.PI * 0.4, len: Math.PI * 0.85, z: 0.14, opacity: 0.55, color: 0xffffff },
      { inner: 2.62, outer: 2.65, start: Math.PI * 1.1, len: Math.PI * 1.15, z: -0.14, opacity: 0.48, color: electricBlue },
      { inner: 2.18, outer: 2.21, start: 0, len: Math.PI * 2, z: 0.0, opacity: 0.38, color: colorThemeHex }
    ];
    outerSpecs.forEach((spec, idx) => {
      const geo = new THREE.RingGeometry(spec.inner, spec.outer, 96, 1, spec.start, spec.len);
      const mat = new THREE.MeshBasicMaterial({
        color: spec.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: spec.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = spec.z;
      mesh.rotation.x = idx === 1 ? 0.18 : idx === 2 ? -0.16 : 0;
      this.outerRingMats.push(mat);
      this.outerArcs.push(mesh);
      this.outerRingsGroup.add(mesh);
    });
    this.group.add(this.outerRingsGroup);

    // 2. Outer Radial Tick Marks (72 precision radial ticks + major degree markings)
    const tickPts: THREE.Vector3[] = [];
    const tickCount = 72;
    for (let i = 0; i < tickCount; i++) {
      const angle = (i / tickCount) * Math.PI * 2;
      const isMajor = i % 6 === 0;
      const rIn = isMajor ? 1.94 : 2.04;
      const rOut = isMajor ? 2.15 : 2.11;
      tickPts.push(
        new THREE.Vector3(Math.cos(angle) * rIn, Math.sin(angle) * rIn, 0),
        new THREE.Vector3(Math.cos(angle) * rOut, Math.sin(angle) * rOut, 0)
      );
    }
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPts);
    const tickMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });
    this.radialTicks = new THREE.LineSegments(tickGeo, tickMat);
    this.outerRingMats.push(tickMat);
    this.outerRingsGroup.add(this.radialTicks);

    // 3. Inner Inclined Gyroscopic Orbital Rings
    this.innerRingsGroup = new THREE.Group();
    const innerSpecs = [
      { r: 1.72, tube: 0.015, tiltX: Math.PI / 3.2, tiltY: 0.4, color: colorThemeHex, op: 0.72 },
      { r: 1.56, tube: 0.012, tiltX: -Math.PI / 3.6, tiltY: -0.6, color: 0xffffff, op: 0.55 },
      { r: 1.86, tube: 0.018, tiltX: 0.25, tiltY: Math.PI / 2.4, color: electricBlue, op: 0.65 },
      { r: 1.38, tube: 0.011, tiltX: Math.PI / 2.1, tiltY: 0.15, color: colorThemeHex, op: 0.6 }
    ];
    innerSpecs.forEach((s) => {
      const torusGeo = new THREE.TorusGeometry(s.r, s.tube, 10, 96);
      const mat = new THREE.MeshBasicMaterial({
        color: s.color,
        transparent: true,
        opacity: s.op,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(torusGeo, mat);
      mesh.rotation.set(s.tiltX, s.tiltY, 0);
      this.innerRingMats.push(mat);
      this.innerRings.push(mesh);
      this.innerRingsGroup.add(mesh);
    });
    this.group.add(this.innerRingsGroup);

    // 4. Latitude / Longitude Spherical Grid & Geodesic Wireframe
    this.latLongGroup = new THREE.Group();
    const sphereRadius = 1.3;
    const gridPts: THREE.Vector3[] = [];
    // Latitude parallels
    [-0.75, -0.4, 0, 0.4, 0.75].forEach((latFrac) => {
      const y = latFrac * sphereRadius;
      const r = Math.sqrt(Math.max(0.01, sphereRadius * sphereRadius - y * y));
      const segs = 64;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        gridPts.push(
          new THREE.Vector3(Math.cos(a0) * r, y, Math.sin(a0) * r),
          new THREE.Vector3(Math.cos(a1) * r, y, Math.sin(a1) * r)
        );
      }
    });
    // Longitude meridians
    for (let m = 0; m < 8; m++) {
      const phi = (m / 8) * Math.PI;
      const segs = 48;
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * Math.PI * 2;
        const t1 = ((i + 1) / segs) * Math.PI * 2;
        gridPts.push(
          new THREE.Vector3(Math.cos(t0) * Math.cos(phi) * sphereRadius, Math.sin(t0) * sphereRadius, Math.cos(t0) * Math.sin(phi) * sphereRadius),
          new THREE.Vector3(Math.cos(t1) * Math.cos(phi) * sphereRadius, Math.sin(t1) * sphereRadius, Math.cos(t1) * Math.sin(phi) * sphereRadius)
        );
      }
    }
    const latLongGeo = new THREE.BufferGeometry().setFromPoints(gridPts);
    this.latLongLineMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending
    });
    this.latLongGroup.add(new THREE.LineSegments(latLongGeo, this.latLongLineMat));

    const geodesicGeo = new THREE.IcosahedronGeometry(1.26, 2);
    this.geodesicMat = new THREE.MeshBasicMaterial({
      color: electricBlue,
      wireframe: true,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending
    });
    const geodesicMesh = new THREE.Mesh(geodesicGeo, this.geodesicMat);
    this.latLongGroup.add(geodesicMesh);
    this.group.add(this.latLongGroup);

    // 5. Energy Trajectory Layer (elliptical glowing paths + orbiting pulses)
    this.trajectoriesGroup = new THREE.Group();
    const trajConfigs = [
      { radius: 1.62, tiltX: 0.65, tiltZ: 0.35, speed: 1.15, phase: 0 },
      { radius: 1.78, tiltX: -0.75, tiltZ: -0.45, speed: -0.9, phase: 2.1 },
      { radius: 1.46, tiltX: 0.2, tiltZ: 1.15, speed: 1.45, phase: 4.2 }
    ];
    const beadGeo = new THREE.SphereGeometry(0.052, 10, 10);
    trajConfigs.forEach((cfg) => {
      const beadMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      });
      const bead = new THREE.Mesh(beadGeo, beadMat);
      this.trajectoriesGroup.add(bead);
      this.trajectoryBeads.push({ mesh: bead, ...cfg });
    });
    this.group.add(this.trajectoriesGroup);

    // 6. Technical Markers & Projected Callout Anchors
    this.markersGroup = new THREE.Group();
    const markerGeo = new THREE.OctahedronGeometry(0.055, 0);
    this.markerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const markerDefs: { id: string; name: string; pos: THREE.Vector3 }[] = [
      { id: 'v-core', name: 'NEURAL CORE // 142.8 GHz', pos: new THREE.Vector3(0, 0.55, 0) },
      { id: 'v-alpha', name: 'ORBITAL ARC α // 18.4 T', pos: new THREE.Vector3(1.85, 0.85, 0.25) },
      { id: 'v-beta', name: 'SECTOR 07 // COHERENCE 0.998', pos: new THREE.Vector3(-1.82, 0.72, -0.3) },
      { id: 'v-gamma', name: 'LAT/LONG GRID // V1.2', pos: new THREE.Vector3(1.42, -1.12, 0.45) },
      { id: 'v-delta', name: 'FLUX TELEMETRY // 3.2 GJ', pos: new THREE.Vector3(-1.45, -1.08, 0.35) },
      { id: 'v-zenith', name: 'ZENITH SCANNER // SYNC', pos: new THREE.Vector3(0, 1.98, 0) }
    ];
    markerDefs.forEach((def) => {
      const marker = new THREE.Mesh(markerGeo, this.markerMat);
      marker.position.copy(def.pos);
      marker.userData.basePos = def.pos.clone();
      marker.userData.componentLabel = def.name;
      this.markersGroup.add(marker);
      this.anchorNodes.push({ id: def.id, name: def.name, object: marker });
    });
    this.group.add(this.markersGroup);

    // 7. Central Energy Core (Fresnel Plasma + Inner Aura)
    this.coreGroup = new THREE.Group();
    const coreGeo = new THREE.SphereGeometry(0.56, 36, 36);
    this.coreShaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colorThemeHex) },
        uBrightness: { value: this.coreBrightness },
        uTime: { value: 0 },
        uDispersion: { value: 0 }
      },
      vertexShader: CORE_FRESNEL_VERT,
      fragmentShader: CORE_FRESNEL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const coreSphere = new THREE.Mesh(coreGeo, this.coreShaderMat);
    this.coreGroup.add(coreSphere);

    const auraGeo = new THREE.SphereGeometry(0.86, 28, 28);
    this.coreAuraMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    });
    this.coreGroup.add(new THREE.Mesh(auraGeo, this.coreAuraMat));
    this.group.add(this.coreGroup);

    // 8. Scanning Arc Layer (Horizontal Sweep Ring + Meridian Scan Arc)
    this.scanGroup = new THREE.Group();
    const scanRingGeo = new THREE.RingGeometry(1.36, 1.42, 72);
    const scanRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.scanRingH = new THREE.Mesh(scanRingGeo, scanRingMat);
    this.scanRingH.rotation.x = Math.PI / 2;
    this.scanGroup.add(this.scanRingH);

    const scanArcGeo = new THREE.TorusGeometry(2.02, 0.016, 8, 64, Math.PI * 0.65);
    const scanArcMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.scanArcV = new THREE.Mesh(scanArcGeo, scanArcMat);
    this.scanGroup.add(this.scanArcV);
    this.group.add(this.scanGroup);

    // 9. GPU Reversible Particle Shell (sampled directly from the actual VisionSphere layers!)
    const seedPoints = this.buildStructureSeedPoints(this.baseParticleBudget);
    this.particleEngine = new ReversibleParticleEngine(seedPoints, colorThemeHex, 5000);
    this.group.add(this.particleEngine.points);
  }

  private buildStructureSeedPoints(count: number): ParticleSeedPoint[] {
    const seeds: ParticleSeedPoint[] = [];

    // Distribute particles authentically across the sphere's real anatomical structures:
    // ~45% Geodesic Sphere Shell, ~25% Outer Orbital Rings, ~20% Inner Gyro Rings, ~10% Energy Core
    const shellCount = Math.floor(count * 0.45);
    const outerCount = Math.floor(count * 0.25);
    const innerCount = Math.floor(count * 0.2);
    const coreCount = Math.max(100, count - shellCount - outerCount - innerCount);

    // Fibonacci sphere lattice points (exact organized shell)
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < shellCount; i++) {
      const y = 1 - (i / Math.max(1, shellCount - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = goldenAngle * i;
      const r = 1.3 + ((i % 5) - 2) * 0.012;
      const origin = new THREE.Vector3(Math.cos(theta) * radiusAtY * r, y * r, Math.sin(theta) * radiusAtY * r);
      seeds.push({
        origin,
        size: i % 11 === 0 ? 4.4 : 2.5,
        colorMix: (i % 9) / 8
      });
    }

    // Outer orbital ring points
    const outerRadii = [2.19, 2.36, 2.5, 2.64];
    for (let i = 0; i < outerCount; i++) {
      const r = outerRadii[i % outerRadii.length];
      const angle = (i / outerCount) * Math.PI * 2 * 3;
      const z = ((i % 3) - 1) * 0.1;
      const origin = new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
      seeds.push({
        origin,
        size: i % 9 === 0 ? 3.8 : 2.1,
        colorMix: 0.25 + ((i % 5) / 8)
      });
    }

    // Inner gyroscopic tilted rings
    const innerTilts = [
      new THREE.Euler(Math.PI / 3.2, 0.4, 0),
      new THREE.Euler(-Math.PI / 3.6, -0.6, 0),
      new THREE.Euler(0.25, Math.PI / 2.4, 0)
    ];
    const innerRadii = [1.72, 1.56, 1.86];
    for (let i = 0; i < innerCount; i++) {
      const ringIdx = i % innerTilts.length;
      const r = innerRadii[ringIdx];
      const a = (i / innerCount) * Math.PI * 2 * 4;
      const origin = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0).applyEuler(innerTilts[ringIdx]);
      seeds.push({
        origin,
        size: 2.6,
        colorMix: 0.5
      });
    }

    // Central plasma energy core points
    for (let i = 0; i < coreCount; i++) {
      const u = ((i * 7919) % 1000) / 1000;
      const v = ((i * 6271) % 1000) / 1000;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = 0.25 + ((i % 13) / 13) * 0.42;
      const origin = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
      seeds.push({
        origin,
        size: 3.4,
        colorMix: 0.1
      });
    }

    return seeds;
  }

  public getComponentAnchors(): ComponentAnchor[] {
    return this.anchorNodes;
  }

  public getParticleEngine(): ReversibleParticleEngine {
    return this.particleEngine;
  }

  public getDispersion(): number {
    return this.currentDispersion;
  }

  public getDispersionState(): ParticleFormationState {
    return this.particleEngine.getState();
  }

  public setDispersion(amount: number) {
    this.targetDispersion = Math.max(0, Math.min(1, amount));
    this.particleEngine.setTargetDispersion(this.targetDispersion);
  }

  public setExplodedView(exploded: boolean) {
    this.targetExplosion = exploded ? 1.0 : 0.0;
  }

  public setExplosionAmount(amount: number) {
    this.targetExplosion = Math.max(0, Math.min(1, amount));
  }

  public setParticleCount(count: number) {
    const adjusted = this.reducedEffects ? Math.min(1200, count) : count;
    this.particleEngine.setActiveCount(adjusted);
  }

  public setParameters(params: VisionSphereLayerParams) {
    if (params.rotationSpeed !== undefined) this.layerRotationSpeed = params.rotationSpeed;
    if (params.particleIntensity !== undefined) this.particleIntensity = params.particleIntensity;
    if (params.orbitalSpeed !== undefined) this.orbitalSpeed = params.orbitalSpeed;
    if (params.coreBrightness !== undefined) this.coreBrightness = params.coreBrightness;
    if (params.dispersionIntensity !== undefined) this.dispersionIntensity = params.dispersionIntensity;
    if (params.scanSpeed !== undefined) this.scanSpeed = params.scanSpeed;
    if (params.glowIntensity !== undefined) this.glowIntensity = params.glowIntensity;
    if (params.reducedEffects !== undefined) {
      this.reducedEffects = params.reducedEffects;
      this.setParticleCount(this.baseParticleBudget);
    }

    this.particleEngine.setParameters({
      intensity: 0.9 * this.particleIntensity * (0.6 + this.glowIntensity * 0.3),
      repulsion: 0.25 * this.dispersionIntensity
    });
    this.coreShaderMat.uniforms.uBrightness.value = this.coreBrightness;
  }

  public setColorTheme(hex: number) {
    this.colorHex = hex;
    (this.coreShaderMat.uniforms.uColor.value as THREE.Color).setHex(hex);
    this.coreAuraMat.color.setHex(hex);
    this.latLongLineMat.color.setHex(hex);
    (this.scanArcV.material as THREE.MeshBasicMaterial).color.setHex(hex);
    this.outerRingMats.forEach((m, idx) => {
      if (idx !== 1 && 'color' in m) {
        (m as THREE.MeshBasicMaterial).color.setHex(hex);
      }
    });
    this.innerRingMats.forEach((m, idx) => {
      if (idx !== 1 && 'color' in m) {
        (m as THREE.MeshBasicMaterial).color.setHex(hex);
      }
    });
    this.particleEngine.setColorTheme(hex);
  }

  public update(time: number, speedMultiplier: number = 1.0, delta: number = 0.016) {
    const dt = Math.max(0.001, Math.min(0.1, delta));
    const smooth = 1 - Math.exp(-8.5 * dt);

    this.currentDispersion += (this.targetDispersion - this.currentDispersion) * smooth;
    if (Math.abs(this.targetDispersion - this.currentDispersion) < 0.0005) {
      this.currentDispersion = this.targetDispersion;
    }
    this.currentExplosion += (this.targetExplosion - this.currentExplosion) * smooth;

    const d = this.currentDispersion;
    const exp = this.currentExplosion;
    const structuralSeparation = 1 + d * 0.65 * this.dispersionIntensity + exp * 0.45;

    // 1. Update GPU reversible particle engine with deterministic origin preservation
    this.particleEngine.update(time, dt);
    this.particleEngine.setParameters({
      intensity: (0.85 + d * 0.45) * this.particleIntensity * (0.65 + this.glowIntensity * 0.25),
      opacity: Math.min(1, 0.88 + d * 0.12),
      repulsion: 0.25 * this.dispersionIntensity
    });

    // 2. Smoothly dissolve/reconstruct structural lines & rings with dispersion
    const ringFade = Math.max(0.0, 1.0 - Math.pow(d, 1.15) * 1.12);
    const rotMult = Math.max(0.05, speedMultiplier * this.layerRotationSpeed * this.orbitalSpeed);

    this.outerRingsGroup.scale.setScalar(1 + d * 0.55 + exp * 0.3);
    this.outerRingsGroup.visible = ringFade > 0.02;
    this.outerArcs.forEach((arc, i) => {
      arc.rotation.z += (i % 2 === 0 ? 0.004 : -0.0055) * rotMult;
      arc.position.z = ((i - 1.5) * 0.12) * (1 + exp * 2.2 + d * 1.5);
    });
    this.radialTicks.rotation.z -= 0.0022 * rotMult;
    this.outerRingMats.forEach((m, idx) => {
      const baseOp = idx === 0 ? 0.72 : idx === 1 ? 0.55 : idx === 2 ? 0.48 : idx === 3 ? 0.38 : 0.65;
      (m as THREE.MeshBasicMaterial).opacity = baseOp * ringFade;
    });

    // 3. Inner gyroscopic orbital rings
    this.innerRingsGroup.scale.setScalar(structuralSeparation);
    this.innerRingsGroup.visible = ringFade > 0.02;
    this.innerRings.forEach((ring, i) => {
      ring.rotation.z += (i % 2 === 0 ? 0.01 : -0.008) * rotMult;
      ring.rotation.x += (i % 2 === 0 ? 0.003 : -0.0025) * rotMult;
    });
    this.innerRingMats.forEach((m, idx) => {
      const baseOp = idx === 0 ? 0.72 : idx === 1 ? 0.55 : idx === 2 ? 0.65 : 0.6;
      (m as THREE.MeshBasicMaterial).opacity = baseOp * ringFade;
    });

    // 4. Lat/Long Grid & Geodesic Shell
    this.latLongGroup.rotation.y += 0.0028 * rotMult;
    this.latLongGroup.scale.setScalar(1 + d * 0.42 + exp * 0.25);
    this.latLongGroup.visible = ringFade > 0.03;
    this.latLongLineMat.opacity = 0.34 * ringFade;
    this.geodesicMat.opacity = 0.24 * ringFade;

    // 5. Energy trajectories
    this.trajectoriesGroup.visible = ringFade > 0.04;
    this.trajectoryBeads.forEach((b) => {
      const angle = time * b.speed * rotMult + b.phase;
      const r = b.radius * structuralSeparation;
      b.mesh.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
      b.mesh.position.applyAxisAngle(_xAxis, b.tiltX);
      b.mesh.position.applyAxisAngle(_zAxis, b.tiltZ);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * ringFade;
    });

    // 6. Technical Markers expand proportionally with shell so anchors stay registered
    this.markersGroup.children.forEach((child) => {
      const base = child.userData.basePos as THREE.Vector3 | undefined;
      if (base) {
        child.position.copy(base).multiplyScalar(1 + d * 0.6 + exp * 0.45);
        child.rotation.y += 0.03;
      }
    });
    this.markerMat.opacity = 0.9 * Math.max(0.15, ringFade);

    // 7. Central Energy Core
    this.coreShaderMat.uniforms.uTime.value = time;
    this.coreShaderMat.uniforms.uDispersion.value = d;
    this.coreShaderMat.uniforms.uBrightness.value = this.coreBrightness * (0.75 + this.glowIntensity * 0.25);
    const corePulse = 1 + Math.sin(time * 4.2) * 0.06 + d * 0.35;
    this.coreGroup.scale.setScalar(corePulse);
    this.coreAuraMat.opacity = Math.max(0.05, (0.22 - d * 0.14) * this.coreBrightness);

    // 8. Horizontal Scanning Beam & Meridian Scan Arc
    const scanT = time * 1.4 * this.scanSpeed;
    this.scanRingH.position.y = Math.sin(scanT) * 1.38 * (1 + d * 0.25);
    const scanRingRadiusScale = Math.sqrt(Math.max(0.25, 1.0 - Math.pow(Math.sin(scanT), 2) * 0.65)) * (1 + d * 0.5);
    this.scanRingH.scale.set(scanRingRadiusScale, scanRingRadiusScale, 1);
    (this.scanRingH.material as THREE.MeshBasicMaterial).opacity = (0.48 + d * 0.25) * Math.max(0.25, 1 - d * 0.4);

    this.scanArcV.rotation.y = scanT * 0.9;
    this.scanArcV.rotation.z = Math.cos(scanT * 0.6) * 0.4;
    this.scanArcV.scale.setScalar(1 + d * 0.55);
    (this.scanArcV.material as THREE.MeshBasicMaterial).opacity = 0.7 * Math.max(0.12, ringFade);
  }

  public dispose() {
    this.particleEngine.dispose();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose();
      }
    });
  }
}

const _xAxis = new THREE.Vector3(1, 0, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
