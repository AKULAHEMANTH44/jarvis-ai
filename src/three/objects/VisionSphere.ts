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

const CORE_PLASMA_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec3 vLocalPos;
  void main() {
    vLocalPos = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CORE_PLASMA_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBrightness;
  uniform float uTime;
  uniform float uDispersion;
  uniform float uVoiceEnergy;
  uniform float uProcessing;
  uniform float uInitProgress;

  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec3 vLocalPos;

  float plasmaNoise(vec3 p) {
    return sin(p.x * 5.2 + uTime * 2.1) * cos(p.y * 5.4 - uTime * 1.7) * sin(p.z * 5.0 + uTime * 2.4);
  }

  void main() {
    vec3 viewDir = normalize(vViewPos);
    float ndotv = clamp(dot(viewDir, vNormal), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, 2.0);
    float coreCenter = pow(ndotv, 2.6);

    float turb = plasmaNoise(vLocalPos * 2.4 + vec3(uTime * 0.45)) * 0.5 + 0.5;
    float harmonic = 0.86 + 0.14 * sin(uTime * (4.5 + uVoiceEnergy * 8.0 + uProcessing * 6.0));
    float activityGlow = 1.0 + uVoiceEnergy * 0.55 + uProcessing * 0.45;
    float initFade = smoothstep(0.12, 0.72, uInitProgress);

    vec3 iceBlue = vec3(0.68, 0.95, 1.0);
    vec3 whiteCore = vec3(0.94, 0.99, 1.0);
    vec3 col = mix(uColor, iceBlue, turb * 0.45 + fresnel * 0.48);
    col = mix(col, whiteCore, coreCenter * 0.52 + uVoiceEnergy * 0.16);

    float alpha = (fresnel * 0.85 + coreCenter * 0.58 + turb * 0.16) * harmonic * initFade * (1.0 - uDispersion * 0.82);
    gl_FragColor = vec4(col * uBrightness * activityGlow, clamp(alpha, 0.0, 0.92));
  }
`;

interface OuterSectorArc {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  baseOpacity: number;
  baseZ: number;
  rotSpeed: number;
  sepVector: THREE.Vector3;
  isAccentWhite: boolean;
}

interface EllipticalComet {
  curve: THREE.EllipseCurve;
  tilt: THREE.Euler;
  bead: THREE.Mesh;
  trailLine: THREE.Line;
  trailGeo: THREE.BufferGeometry;
  trailPositions: Float32Array;
  speed: number;
  phase: number;
  baseRadius: number;
}

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

  private outerSectors: OuterSectorArc[] = [];
  private innerRings: THREE.Object3D[] = [];
  private innerRingMats: THREE.Material[] = [];
  private orbitCurves: THREE.LineLoop[] = [];
  private orbitCurveMats: THREE.LineBasicMaterial[] = [];
  private comets: EllipticalComet[] = [];
  private waveformRing: THREE.LineLoop;
  private waveformGeo: THREE.BufferGeometry;
  private waveformPositions: Float32Array;
  private waveformMat: THREE.LineBasicMaterial;
  private scanRingH: THREE.Mesh;
  private scanArcV: THREE.Mesh;
  private coreShaderMat: THREE.ShaderMaterial;
  private coreAuraMat: THREE.MeshBasicMaterial;
  private geodesicMat: THREE.MeshBasicMaterial;
  private outerGeodesicMat: THREE.MeshBasicMaterial;
  private latLongLineMat: THREE.LineBasicMaterial;
  private markerMat: THREE.MeshBasicMaterial;
  private tickMat: THREE.LineBasicMaterial;
  private anchorNodes: ComponentAnchor[] = [];

  private colorHex: number;
  private targetDispersion: number = 0;
  private currentDispersion: number = 0;
  private targetExplosion: number = 0;
  private currentExplosion: number = 0;
  private initProgress: number = 1.0;

  // Reactive voice & AI state
  private isListening: boolean = false;
  private isSpeaking: boolean = false;
  private isProcessing: boolean = false;
  private voiceEnergy: number = 0;
  private processingEnergy: number = 0;

  // Independent layer parameters
  private layerRotationSpeed: number = 1.0;
  private particleIntensity: number = 1.25;
  private orbitalSpeed: number = 1.0;
  private coreBrightness: number = 1.4;
  private dispersionIntensity: number = 1.0;
  private scanSpeed: number = 1.0;
  private glowIntensity: number = 1.5;
  private reducedEffects: boolean = false;
  private baseParticleBudget: number = 4200;

  constructor(colorThemeHex = 0x00f0ff, particleCount = 4200) {
    this.colorHex = colorThemeHex;
    this.baseParticleBudget = Math.max(800, Math.min(5000, particleCount));
    this.group = new THREE.Group();

    const electricBlue = 0x1e88ff;

    // 1. Segmented Outer Orbital Arcs (individual sectors separate independently on dispersion/explode)
    this.outerRingsGroup = new THREE.Group();
    const sectorSpecs = [
      { inner: 2.38, outer: 2.416, start: 0.1, len: Math.PI * 0.72, z: 0.04, opacity: 0.76, color: colorThemeHex, white: false, speed: 0.0045 },
      { inner: 2.38, outer: 2.416, start: Math.PI * 1.05, len: Math.PI * 0.78, z: -0.04, opacity: 0.7, color: colorThemeHex, white: false, speed: 0.0045 },
      { inner: 2.54, outer: 2.572, start: Math.PI * 0.35, len: Math.PI * 0.58, z: 0.15, opacity: 0.62, color: 0xffffff, white: true, speed: -0.0055 },
      { inner: 2.54, outer: 2.572, start: Math.PI * 1.35, len: Math.PI * 0.52, z: -0.15, opacity: 0.58, color: electricBlue, white: false, speed: -0.0055 },
      { inner: 2.71, outer: 2.735, start: Math.PI * 0.75, len: Math.PI * 0.92, z: -0.08, opacity: 0.45, color: colorThemeHex, white: false, speed: 0.0032 },
      { inner: 2.22, outer: 2.245, start: 0, len: Math.PI * 2, z: 0.0, opacity: 0.38, color: colorThemeHex, white: false, speed: -0.002 }
    ];
    sectorSpecs.forEach((spec, idx) => {
      const geo = new THREE.RingGeometry(spec.inner, spec.outer, 84, 1, spec.start, spec.len);
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
      mesh.rotation.x = idx === 2 ? 0.16 : idx === 3 ? -0.16 : 0;
      const midAngle = spec.start + spec.len * 0.5;
      const sepVector = new THREE.Vector3(
        Math.cos(midAngle) * 0.85,
        Math.sin(midAngle) * 0.85,
        (idx % 2 === 0 ? 1 : -1) * 0.55
      );
      this.outerSectors.push({
        mesh,
        material: mat,
        baseOpacity: spec.opacity,
        baseZ: spec.z,
        rotSpeed: spec.speed,
        sepVector,
        isAccentWhite: spec.white
      });
      this.outerRingsGroup.add(mesh);
    });
    this.group.add(this.outerRingsGroup);

    // 2. Precision Radial Vernier Tick Markings (120 degree ticks)
    const tickPts: THREE.Vector3[] = [];
    const tickCount = 120;
    for (let i = 0; i < tickCount; i++) {
      const angle = (i / tickCount) * Math.PI * 2;
      const isMajor = i % 10 === 0;
      const isMedium = i % 5 === 0;
      const rIn = isMajor ? 1.96 : isMedium ? 2.04 : 2.09;
      const rOut = isMajor ? 2.2 : 2.16;
      tickPts.push(
        new THREE.Vector3(Math.cos(angle) * rIn, Math.sin(angle) * rIn, 0),
        new THREE.Vector3(Math.cos(angle) * rOut, Math.sin(angle) * rOut, 0)
      );
    }
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPts);
    this.tickMat = new THREE.LineBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });
    this.radialTicks = new THREE.LineSegments(tickGeo, this.tickMat);
    this.outerRingsGroup.add(this.radialTicks);

    // 3. Inner Inclined Gyroscopic Orbital Rings
    this.innerRingsGroup = new THREE.Group();
    const innerSpecs = [
      { r: 1.76, tube: 0.011, tiltX: Math.PI / 3.1, tiltY: 0.42, color: colorThemeHex, op: 0.74 },
      { r: 1.58, tube: 0.009, tiltX: -Math.PI / 3.5, tiltY: -0.58, color: 0xffffff, op: 0.56 },
      { r: 1.9, tube: 0.012, tiltX: 0.24, tiltY: Math.PI / 2.3, color: electricBlue, op: 0.66 },
      { r: 1.4, tube: 0.008, tiltX: Math.PI / 2.1, tiltY: 0.18, color: colorThemeHex, op: 0.6 }
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

    // 4. Dual Geodesic Lattice & Latitude / Longitude Spherical Grid
    this.latLongGroup = new THREE.Group();
    const sphereRadius = 1.32;
    const gridPts: THREE.Vector3[] = [];
    [-0.78, -0.45, 0, 0.45, 0.78].forEach((latFrac) => {
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
    for (let m = 0; m < 10; m++) {
      const phi = (m / 10) * Math.PI;
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

    const geodesicGeo = new THREE.IcosahedronGeometry(1.25, 2);
    this.geodesicMat = new THREE.MeshBasicMaterial({
      color: electricBlue,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending
    });
    this.latLongGroup.add(new THREE.Mesh(geodesicGeo, this.geodesicMat));

    const outerGeo = new THREE.IcosahedronGeometry(1.52, 1);
    this.outerGeodesicMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending
    });
    this.latLongGroup.add(new THREE.Mesh(outerGeo, this.outerGeodesicMat));
    this.group.add(this.latLongGroup);

    // 5. Elliptical Energy Trajectories + Luminous Orbiting Comets WITH Tail Trails
    this.trajectoriesGroup = new THREE.Group();
    const trajConfigs = [
      { rx: 1.85, ry: 1.48, tilt: new THREE.Euler(0.68, 0.25, 0.35), speed: 1.05, phase: 0 },
      { rx: 1.98, ry: 1.56, tilt: new THREE.Euler(-0.78, -0.3, -0.45), speed: -0.88, phase: 2.1 },
      { rx: 1.66, ry: 1.38, tilt: new THREE.Euler(0.22, 0.65, 1.12), speed: 1.38, phase: 4.2 },
      { rx: 2.12, ry: 1.72, tilt: new THREE.Euler(1.15, -0.42, 0.15), speed: -0.72, phase: 1.05 }
    ];
    const beadGeo = new THREE.SphereGeometry(0.052, 10, 10);
    const trailSteps = 18;
    trajConfigs.forEach((cfg) => {
      const curve = new THREE.EllipseCurve(0, 0, cfg.rx, cfg.ry, 0, Math.PI * 2, false, 0);
      const pts2d = curve.getPoints(80);
      const orbitPts = pts2d.map((p) => new THREE.Vector3(p.x, p.y, 0).applyEuler(cfg.tilt));
      const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
      const orbitMat = new THREE.LineBasicMaterial({
        color: electricBlue,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending
      });
      const orbitLoop = new THREE.LineLoop(orbitGeo, orbitMat);
      this.orbitCurves.push(orbitLoop);
      this.orbitCurveMats.push(orbitMat);
      this.trajectoriesGroup.add(orbitLoop);

      const beadMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.96,
        blending: THREE.AdditiveBlending
      });
      const bead = new THREE.Mesh(beadGeo, beadMat);
      this.trajectoriesGroup.add(bead);

      const trailPositions = new Float32Array(trailSteps * 3);
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
      const trailMat = new THREE.LineBasicMaterial({
        color: 0xe6fbff,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending
      });
      const trailLine = new THREE.Line(trailGeo, trailMat);
      this.trajectoriesGroup.add(trailLine);

      this.comets.push({
        curve,
        tilt: cfg.tilt,
        bead,
        trailLine,
        trailGeo,
        trailPositions,
        speed: cfg.speed,
        phase: cfg.phase,
        baseRadius: cfg.rx
      });
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
      { id: 'v-core', name: 'NEURAL CORE // 142.8 GHz', pos: new THREE.Vector3(0, 0.58, 0) },
      { id: 'v-alpha', name: 'ORBITAL ARC α // 18.4 T', pos: new THREE.Vector3(1.88, 0.88, 0.25) },
      { id: 'v-beta', name: 'SECTOR 07 // COHERENCE 0.998', pos: new THREE.Vector3(-1.85, 0.74, -0.3) },
      { id: 'v-gamma', name: 'LAT/LONG GRID // VISION X', pos: new THREE.Vector3(1.44, -1.14, 0.45) },
      { id: 'v-delta', name: 'FLUX TELEMETRY // 3.2 GJ', pos: new THREE.Vector3(-1.46, -1.1, 0.35) },
      { id: 'v-zenith', name: 'ZENITH SCANNER // SYNC', pos: new THREE.Vector3(0, 2.02, 0) }
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

    // 7. Central Energy Core (Fresnel Plasma Shader + Corona Aura + Harmonic Voice Waveform Ring)
    this.coreGroup = new THREE.Group();
    const coreGeo = new THREE.SphereGeometry(0.56, 36, 36);
    this.coreShaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colorThemeHex) },
        uBrightness: { value: this.coreBrightness },
        uTime: { value: 0 },
        uDispersion: { value: 0 },
        uVoiceEnergy: { value: 0 },
        uProcessing: { value: 0 },
        uInitProgress: { value: 1.0 }
      },
      vertexShader: CORE_PLASMA_VERT,
      fragmentShader: CORE_PLASMA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.coreGroup.add(new THREE.Mesh(coreGeo, this.coreShaderMat));

    const auraGeo = new THREE.SphereGeometry(0.92, 28, 28);
    this.coreAuraMat = new THREE.MeshBasicMaterial({
      color: colorThemeHex,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    });
    this.coreGroup.add(new THREE.Mesh(auraGeo, this.coreAuraMat));

    // 3D Voice & Processing Harmonic Waveform Ring inside the core halo
    const waveSegs = 96;
    this.waveformPositions = new Float32Array(waveSegs * 3);
    this.waveformGeo = new THREE.BufferGeometry();
    this.waveformGeo.setAttribute('position', new THREE.BufferAttribute(this.waveformPositions, 3));
    this.waveformMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });
    this.waveformRing = new THREE.LineLoop(this.waveformGeo, this.waveformMat);
    this.coreGroup.add(this.waveformRing);

    this.group.add(this.coreGroup);

    // 8. Scanning Arc Layer (Horizontal Sweep Beam + Meridian Scan Arc)
    this.scanGroup = new THREE.Group();
    const scanRingGeo = new THREE.RingGeometry(1.36, 1.43, 72);
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

    const scanArcGeo = new THREE.TorusGeometry(2.04, 0.016, 8, 64, Math.PI * 0.72);
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

    // 9. GPU Reversible Particle Shell & Constellation/Trail Filament Web
    const seedPoints = this.buildStructureSeedPoints(this.baseParticleBudget);
    this.particleEngine = new ReversibleParticleEngine(seedPoints, colorThemeHex, 5000);
    this.group.add(this.particleEngine.points);
    this.group.add(this.particleEngine.filamentLines);
  }

  private buildStructureSeedPoints(count: number): ParticleSeedPoint[] {
    const seeds: ParticleSeedPoint[] = [];

    const shellCount = Math.floor(count * 0.44);
    const outerCount = Math.floor(count * 0.25);
    const innerCount = Math.floor(count * 0.21);
    const coreCount = Math.max(120, count - shellCount - outerCount - innerCount);

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < shellCount; i++) {
      const y = 1 - (i / Math.max(1, shellCount - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = goldenAngle * i;
      const r = 1.32 + ((i % 5) - 2) * 0.015;
      const origin = new THREE.Vector3(Math.cos(theta) * radiusAtY * r, y * r, Math.sin(theta) * radiusAtY * r);
      seeds.push({
        origin,
        size: i % 11 === 0 ? 4.6 : 2.6,
        colorMix: (i % 9) / 8
      });
    }

    const outerRadii = [2.23, 2.4, 2.56, 2.72];
    for (let i = 0; i < outerCount; i++) {
      const r = outerRadii[i % outerRadii.length];
      const angle = (i / outerCount) * Math.PI * 2 * 3;
      const z = ((i % 3) - 1) * 0.1;
      const origin = new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
      seeds.push({
        origin,
        size: i % 9 === 0 ? 4.0 : 2.2,
        colorMix: 0.25 + ((i % 5) / 8)
      });
    }

    const innerTilts = [
      new THREE.Euler(Math.PI / 3.1, 0.42, 0),
      new THREE.Euler(-Math.PI / 3.5, -0.58, 0),
      new THREE.Euler(0.24, Math.PI / 2.3, 0)
    ];
    const innerRadii = [1.76, 1.58, 1.9];
    for (let i = 0; i < innerCount; i++) {
      const ringIdx = i % innerTilts.length;
      const r = innerRadii[ringIdx];
      const a = (i / innerCount) * Math.PI * 2 * 4;
      const origin = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0).applyEuler(innerTilts[ringIdx]);
      seeds.push({
        origin,
        size: 2.7,
        colorMix: 0.5
      });
    }

    for (let i = 0; i < coreCount; i++) {
      const u = ((i * 7919) % 1000) / 1000;
      const v = ((i * 6271) % 1000) / 1000;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = 0.24 + ((i % 13) / 13) * 0.44;
      const origin = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
      seeds.push({
        origin,
        size: 3.5,
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

  public setInitProgress(progress: number) {
    this.initProgress = Math.max(0, Math.min(1, progress));
    this.coreShaderMat.uniforms.uInitProgress.value = this.initProgress;
    this.particleEngine.setInitProgress(this.initProgress);
  }

  public setCoreActivity(activity: {
    isListening?: boolean;
    isSpeaking?: boolean;
    isProcessing?: boolean;
  }) {
    if (activity.isListening !== undefined) this.isListening = activity.isListening;
    if (activity.isSpeaking !== undefined) this.isSpeaking = activity.isSpeaking;
    if (activity.isProcessing !== undefined) this.isProcessing = activity.isProcessing;
  }

  public setExplodedView(exploded: boolean) {
    this.targetExplosion = exploded ? 1.0 : 0.0;
  }

  public setExplosionAmount(amount: number) {
    this.targetExplosion = Math.max(0, Math.min(1, amount));
  }

  public setParticleCount(count: number) {
    const adjusted = this.reducedEffects ? Math.min(1400, count) : count;
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
    this.outerGeodesicMat.color.setHex(hex);
    this.tickMat.color.setHex(hex);
    (this.scanArcV.material as THREE.MeshBasicMaterial).color.setHex(hex);
    this.outerSectors.forEach((sec) => {
      if (!sec.isAccentWhite) sec.material.color.setHex(hex);
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

    const targetVoice = this.isSpeaking ? 1.0 : this.isListening ? 0.55 : 0.0;
    const targetProc = this.isProcessing ? 1.0 : 0.0;
    this.voiceEnergy += (targetVoice - this.voiceEnergy) * smooth;
    this.processingEnergy += (targetProc - this.processingEnergy) * smooth;

    const d = this.currentDispersion;
    const exp = this.currentExplosion;
    const initP = this.initProgress;
    const structuralSeparation = 1 + d * 0.65 * this.dispersionIntensity + exp * 0.45;

    // 1. Update GPU reversible particle engine & light-trail filament web
    this.particleEngine.update(time, dt);
    this.particleEngine.setParameters({
      intensity: (0.9 + d * 0.48 + this.voiceEnergy * 0.25) * this.particleIntensity * (0.65 + this.glowIntensity * 0.25),
      opacity: Math.min(1, 0.9 + d * 0.1),
      repulsion: 0.25 * this.dispersionIntensity,
      voiceEnergy: this.voiceEnergy
    });

    const ringInit = THREE.MathUtils.smoothstep(initP, 0.35, 0.95);
    const gridInit = THREE.MathUtils.smoothstep(initP, 0.25, 0.85);
    const ringFade = Math.max(0.0, 1.0 - Math.pow(d, 1.15) * 1.12) * ringInit;
    const rotMult = Math.max(0.05, speedMultiplier * this.layerRotationSpeed * this.orbitalSpeed * (1 + this.processingEnergy * 0.65));

    // 2. Outer Segmented Orbital Arcs separate individually along unique sector vectors
    this.outerRingsGroup.scale.setScalar((0.88 + 0.12 * ringInit) * (1 + d * 0.42 + exp * 0.22));
    this.outerRingsGroup.visible = ringFade > 0.015;
    const sectorSpread = d * 1.35 * this.dispersionIntensity + exp * 0.85;
    this.outerSectors.forEach((sec) => {
      sec.mesh.rotation.z += sec.rotSpeed * rotMult;
      sec.mesh.position.set(
        sec.sepVector.x * sectorSpread,
        sec.sepVector.y * sectorSpread,
        sec.baseZ + sec.sepVector.z * sectorSpread * 1.25
      );
      sec.material.opacity = sec.baseOpacity * ringFade;
    });
    this.radialTicks.rotation.z -= 0.0022 * rotMult;
    this.tickMat.opacity = 0.65 * ringFade;

    // 3. Inner gyroscopic orbital rings
    this.innerRingsGroup.scale.setScalar((0.85 + 0.15 * ringInit) * structuralSeparation);
    this.innerRingsGroup.visible = ringFade > 0.015;
    this.innerRings.forEach((ring, i) => {
      ring.rotation.z += (i % 2 === 0 ? 0.01 : -0.008) * rotMult;
      ring.rotation.x += (i % 2 === 0 ? 0.003 : -0.0025) * rotMult;
    });
    this.innerRingMats.forEach((m, idx) => {
      const baseOp = idx === 0 ? 0.74 : idx === 1 ? 0.56 : idx === 2 ? 0.66 : 0.6;
      (m as THREE.MeshBasicMaterial).opacity = baseOp * ringFade;
    });

    // 4. Lat/Long Grid & Dual Geodesic Lattice
    this.latLongGroup.rotation.y += 0.0028 * rotMult;
    this.latLongGroup.scale.setScalar((0.88 + 0.12 * gridInit) * (1 + d * 0.42 + exp * 0.25));
    const gridFade = Math.max(0.0, 1.0 - Math.pow(d, 1.15) * 1.12) * gridInit;
    this.latLongGroup.visible = gridFade > 0.02;
    this.latLongLineMat.opacity = 0.34 * gridFade;
    this.geodesicMat.opacity = 0.25 * gridFade;
    this.outerGeodesicMat.opacity = 0.14 * gridFade;

    // 5. Elliptical Energy Trajectories + Luminous Comets with Tail Trails
    this.trajectoriesGroup.visible = ringFade > 0.03;
    this.trajectoriesGroup.scale.setScalar(structuralSeparation);
    this.orbitCurveMats.forEach((m) => {
      m.opacity = 0.28 * ringFade;
    });
    const pt2d = _tmpVec2;
    const trailSteps = 18;
    this.comets.forEach((c) => {
      const tNorm = ((time * c.speed * 0.18 * rotMult + c.phase) % (Math.PI * 2)) / (Math.PI * 2);
      const safeU = ((tNorm % 1) + 1) % 1;
      c.curve.getPointAt(safeU, pt2d);
      _tmpVec3.set(pt2d.x, pt2d.y, 0).applyEuler(c.tilt);
      c.bead.position.copy(_tmpVec3);
      (c.bead.material as THREE.MeshBasicMaterial).opacity = 0.96 * ringFade;

      const trailSpan = 0.11;
      const dirSign = c.speed >= 0 ? -1 : 1;
      for (let s = 0; s < trailSteps; s++) {
        const u = (((safeU + dirSign * (s / (trailSteps - 1)) * trailSpan) % 1) + 1) % 1;
        c.curve.getPointAt(u, pt2d);
        _tmpVec3.set(pt2d.x, pt2d.y, 0).applyEuler(c.tilt);
        c.trailPositions[s * 3] = _tmpVec3.x;
        c.trailPositions[s * 3 + 1] = _tmpVec3.y;
        c.trailPositions[s * 3 + 2] = _tmpVec3.z;
      }
      (c.trailGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (c.trailLine.material as THREE.LineBasicMaterial).opacity = 0.72 * ringFade;
    });

    // 6. Technical Markers expand proportionally with shell so anchors stay registered
    this.markersGroup.visible = initP > 0.35;
    this.markersGroup.children.forEach((child) => {
      const base = child.userData.basePos as THREE.Vector3 | undefined;
      if (base) {
        child.position.copy(base).multiplyScalar(1 + d * 0.6 + exp * 0.45);
        child.rotation.y += 0.03;
      }
    });
    this.markerMat.opacity = 0.9 * Math.max(0.15, ringFade);

    // 7. Central Energy Core & Harmonic Voice Waveform Ring
    this.coreShaderMat.uniforms.uTime.value = time;
    this.coreShaderMat.uniforms.uDispersion.value = d;
    this.coreShaderMat.uniforms.uVoiceEnergy.value = this.voiceEnergy;
    this.coreShaderMat.uniforms.uProcessing.value = this.processingEnergy;
    this.coreShaderMat.uniforms.uBrightness.value = this.coreBrightness * (0.75 + this.glowIntensity * 0.25);

    const corePulse = (0.4 + 0.6 * THREE.MathUtils.smoothstep(initP, 0.1, 0.7)) *
      (1 + Math.sin(time * (4.2 + this.voiceEnergy * 5.0)) * (0.055 + this.voiceEnergy * 0.05) + d * 0.35);
    this.coreGroup.scale.setScalar(corePulse);
    this.coreAuraMat.opacity = Math.max(0.02, (0.14 + this.voiceEnergy * 0.12) * (1.0 - d * 0.78) * this.coreBrightness * initP);

    const waveCount = this.waveformPositions.length / 3;
    const waveAmp = 0.025 + this.voiceEnergy * 0.14 + this.processingEnergy * 0.08;
    const waveR = 0.72 + d * 0.18;
    for (let i = 0; i < waveCount; i++) {
      const a = (i / waveCount) * Math.PI * 2;
      const mod =
        Math.sin(a * 6 + time * 8.5) * waveAmp * 0.6 +
        Math.cos(a * 11 - time * 12.0) * waveAmp * 0.4;
      const r = waveR + mod;
      this.waveformPositions[i * 3] = Math.cos(a) * r;
      this.waveformPositions[i * 3 + 1] = Math.sin(a) * r;
      this.waveformPositions[i * 3 + 2] = Math.sin(a * 3 + time * 4.0) * waveAmp * 0.8;
    }
    (this.waveformGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.waveformRing.rotation.x = Math.PI * 0.32 + Math.sin(time * 0.7) * 0.18;
    this.waveformRing.rotation.y = time * 0.55;
    this.waveformMat.opacity = (0.35 + this.voiceEnergy * 0.5 + this.processingEnergy * 0.35) * THREE.MathUtils.smoothstep(initP, 0.2, 0.8);

    // 8. Horizontal Scanning Beam & Meridian Scan Arc
    const scanT = time * 1.4 * this.scanSpeed;
    this.scanGroup.visible = ringFade > 0.02;
    this.scanRingH.position.y = Math.sin(scanT) * 1.38 * (1 + d * 0.25);
    const scanRingRadiusScale = Math.sqrt(Math.max(0.25, 1.0 - Math.pow(Math.sin(scanT), 2) * 0.65)) * (1 + d * 0.5);
    this.scanRingH.scale.set(scanRingRadiusScale, scanRingRadiusScale, 1);
    (this.scanRingH.material as THREE.MeshBasicMaterial).opacity = (0.48 + d * 0.25) * Math.max(0.25, 1 - d * 0.4) * ringInit;

    this.scanArcV.rotation.y = scanT * 0.9;
    this.scanArcV.rotation.z = Math.cos(scanT * 0.6) * 0.4;
    this.scanArcV.scale.setScalar(1 + d * 0.55);
    (this.scanArcV.material as THREE.MeshBasicMaterial).opacity = 0.72 * Math.max(0.12, ringFade);
  }

  public dispose() {
    this.particleEngine.dispose();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Line || obj instanceof THREE.LineLoop) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose();
      }
    });
  }
}

const _tmpVec2 = new THREE.Vector2();
const _tmpVec3 = new THREE.Vector3();
