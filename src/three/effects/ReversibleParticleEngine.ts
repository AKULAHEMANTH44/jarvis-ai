import * as THREE from 'three';

export type ParticleFormationState =
  | 'NORMAL'
  | 'EXPANDING'
  | 'DISPERSED'
  | 'RECONSTRUCTING'
  | 'RECONSTRUCTED';

export interface ParticleSeedPoint {
  origin: THREE.Vector3;
  dispersionDir?: THREE.Vector3;
  size?: number;
  colorMix?: number;
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec3 aTarget;
  attribute vec3 aDispersionDir;
  attribute float aSize;
  attribute float aSeed;
  attribute float aColorMix;

  uniform float uTime;
  uniform float uDispersion;
  uniform float uAttraction;
  uniform float uRepulsion;
  uniform float uSizeScale;
  uniform float uSwirlSpeed;
  uniform float uPixelRatio;
  uniform float uInitProgress;
  uniform float uVoiceEnergy;

  varying float vColorMix;
  varying float vDispersion;
  varying float vSeed;
  varying float vInitAlpha;

  void main() {
    vColorMix = aColorMix;
    vDispersion = uDispersion;
    vSeed = aSeed;

    float d = clamp(uDispersion, 0.0, 1.0);
    float easeD = d * d * (3.0 - 2.0 * d);

    // Base formation interpolates from exact original coordinates toward target dispersion coordinates
    vec3 basePos = mix(aOrigin, aTarget, easeD);

    // Subtle harmonic orbital breathing + voice energy micro-vibration when intact
    float microAmp = 0.014 + uVoiceEnergy * 0.025;
    float microPulse = sin(uTime * (2.0 + uVoiceEnergy * 5.0) + aSeed * 12.56) * microAmp * (1.0 - easeD * 0.5);
    vec3 radialDir = length(aOrigin) > 0.001 ? normalize(aOrigin) : vec3(0.0, 1.0, 0.0);
    basePos += radialDir * microPulse;

    // Live 3D initialization convergence (0 -> particles swirl inward from ambient mist into aOrigin)
    float initT = clamp(uInitProgress, 0.0, 1.0);
    float initEase = initT * initT * (3.0 - 2.0 * initT);
    float initScatter = (1.0 - initEase) * (2.2 + aSeed * 2.5);
    basePos += radialDir * initScatter;

    // Controlled 3D dispersion + helical swirl trajectory
    float swirlAngle = easeD * uSwirlSpeed * (1.2 + aSeed * 0.95) + sin(uTime * 0.6 + aSeed * 6.28) * 0.28 * easeD;
    float c = cos(swirlAngle);
    float s = sin(swirlAngle);

    vec3 offset = aDispersionDir * (easeD * (2.6 + uRepulsion * 1.4));
    offset.y += sin(uTime * 1.5 + aSeed * 18.0) * 0.24 * easeD;

    vec3 rotatedOffset = vec3(
      offset.x * c - offset.z * s,
      offset.y,
      offset.x * s + offset.z * c
    );

    vec3 worldPos = basePos + rotatedOffset * (1.0 - uAttraction * 0.35);

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float distScale = clamp(18.0 / max(1.0, -mvPosition.z), 0.75, 4.2);
    float burstSize = 1.0 + sin(easeD * 3.14159) * 0.65 + uVoiceEnergy * 0.16;
    vInitAlpha = smoothstep(0.0, 0.35, initT + aSeed * 0.18);
    gl_PointSize = aSize * uSizeScale * burstSize * distScale * uPixelRatio * (0.65 + 0.35 * initEase);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColorPrimary;
  uniform vec3 uColorSecondary;
  uniform vec3 uColorHighlight;
  uniform float uOpacity;
  uniform float uIntensity;
  uniform float uTime;

  varying float vColorMix;
  varying float vDispersion;
  varying float vSeed;
  varying float vInitAlpha;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv);
    if (dist > 0.5) discard;

    float core = smoothstep(0.22, 0.0, dist);
    float halo = pow(clamp(1.0 - dist * 2.0, 0.0, 1.0), 2.0);
    float alpha = (core * 0.88 + halo * 0.65) * uOpacity * vInitAlpha;

    float twinkle = 0.82 + 0.18 * sin(uTime * 3.2 + vSeed * 31.4159);
    alpha *= twinkle;

    vec3 baseCol = mix(uColorPrimary, uColorSecondary, vColorMix);
    vec3 finalCol = mix(baseCol, uColorHighlight, clamp(core * 0.78 + vDispersion * 0.28, 0.0, 1.0));
    gl_FragColor = vec4(finalCol * uIntensity, clamp(alpha, 0.0, 1.0));
  }
`;

const FILAMENT_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec3 aTarget;
  attribute vec3 aDispersionDir;
  attribute float aSeed;
  attribute float aIsTrailEnd;

  uniform float uTime;
  uniform float uDispersion;
  uniform float uAttraction;
  uniform float uRepulsion;
  uniform float uSwirlSpeed;
  uniform float uInitProgress;

  varying float vStreak;
  varying float vDispersion;

  vec3 computeDispersedPos(vec3 orig, vec3 targ, vec3 dDir, float seed, float d) {
    float easeD = d * d * (3.0 - 2.0 * d);
    vec3 basePos = mix(orig, targ, easeD);
    float swirlAngle = easeD * uSwirlSpeed * (1.2 + seed * 0.95) + sin(uTime * 0.6 + seed * 6.28) * 0.28 * easeD;
    float c = cos(swirlAngle);
    float s = sin(swirlAngle);

    vec3 offset = dDir * (easeD * (2.6 + uRepulsion * 1.4));
    offset.y += sin(uTime * 1.5 + seed * 18.0) * 0.24 * easeD;

    vec3 rotatedOffset = vec3(
      offset.x * c - offset.z * s,
      offset.y,
      offset.x * s + offset.z * c
    );
    return basePos + rotatedOffset * (1.0 - uAttraction * 0.35);
  }

  void main() {
    float d = clamp(uDispersion, 0.0, 1.0);
    // Trail tail lags behind current dispersion slightly when expanding/reconstructing to draw luminous velocity streaks
    float lagD = clamp(d - aIsTrailEnd * (0.12 + 0.16 * sin(d * 3.14159)), 0.0, 1.0);
    vec3 pos = computeDispersedPos(aOrigin, aTarget, aDispersionDir, aSeed, lagD);

    float initT = smoothstep(0.25, 0.95, clamp(uInitProgress, 0.0, 1.0));
    pos *= (0.85 + 0.15 * initT);

    vStreak = 1.0 - aIsTrailEnd;
    vDispersion = d;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FILAMENT_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColorPrimary;
  uniform vec3 uColorHighlight;
  uniform float uInitProgress;

  varying float vStreak;
  varying float vDispersion;

  void main() {
    float initFade = smoothstep(0.32, 0.95, clamp(uInitProgress, 0.0, 1.0));
    float motionGlow = sin(clamp(vDispersion, 0.0, 1.0) * 3.14159);
    float alpha = 0.78 * motionGlow * (0.28 + 0.72 * vStreak) * initFade;
    vec3 col = mix(uColorPrimary, uColorHighlight, 0.42 + 0.48 * motionGlow);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.88));
  }
`;

export class ReversibleParticleEngine {
  public readonly points: THREE.Points;
  public readonly filamentLines: THREE.LineSegments;
  public readonly maxCount: number;
  private activeCount: number;

  private origins: Float32Array;
  private targets: Float32Array;
  private dispersionDirs: Float32Array;
  private sizes: Float32Array;
  private seeds: Float32Array;
  private colorMixes: Float32Array;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  private filamentGeometry: THREE.BufferGeometry;
  private filamentMaterial: THREE.ShaderMaterial;
  private maxFilamentCount: number = 900;

  private currentDispersion: number = 0;
  private targetDispersion: number = 0;
  private state: ParticleFormationState = 'NORMAL';

  constructor(seedPoints: ParticleSeedPoint[], colorThemeHex = 0x00f0ff, maxCount = 5000) {
    this.maxCount = Math.max(seedPoints.length, maxCount);
    this.activeCount = Math.min(this.maxCount, seedPoints.length);

    this.origins = new Float32Array(this.maxCount * 3);
    this.targets = new Float32Array(this.maxCount * 3);
    this.dispersionDirs = new Float32Array(this.maxCount * 3);
    this.sizes = new Float32Array(this.maxCount);
    this.seeds = new Float32Array(this.maxCount);
    this.colorMixes = new Float32Array(this.maxCount);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.origins, 3));
    this.geometry.setAttribute('aOrigin', new THREE.BufferAttribute(this.origins, 3));
    this.geometry.setAttribute('aTarget', new THREE.BufferAttribute(this.targets, 3));
    this.geometry.setAttribute('aDispersionDir', new THREE.BufferAttribute(this.dispersionDirs, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    this.geometry.setAttribute('aColorMix', new THREE.BufferAttribute(this.colorMixes, 1));

    const primary = new THREE.Color(colorThemeHex);
    const secondary = primary.clone().offsetHSL(0.05, 0.05, -0.14);

    const pixelRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDispersion: { value: 0 },
        uAttraction: { value: 0 },
        uRepulsion: { value: 0.25 },
        uSizeScale: { value: 1.0 },
        uSwirlSpeed: { value: 1.65 },
        uPixelRatio: { value: pixelRatio },
        uInitProgress: { value: 1.0 },
        uVoiceEnergy: { value: 0.0 },
        uColorPrimary: { value: primary },
        uColorSecondary: { value: secondary },
        uColorHighlight: { value: new THREE.Color(0xe6fbff) },
        uOpacity: { value: 0.92 },
        uIntensity: { value: 1.2 }
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;

    // GPU Constellation & Dispersion Light-Trail Web
    this.filamentGeometry = new THREE.BufferGeometry();
    const filVertCount = this.maxFilamentCount * 2;
    this.filamentGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(filVertCount * 3), 3));
    this.filamentGeometry.setAttribute('aOrigin', new THREE.BufferAttribute(new Float32Array(filVertCount * 3), 3));
    this.filamentGeometry.setAttribute('aTarget', new THREE.BufferAttribute(new Float32Array(filVertCount * 3), 3));
    this.filamentGeometry.setAttribute('aDispersionDir', new THREE.BufferAttribute(new Float32Array(filVertCount * 3), 3));
    this.filamentGeometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(filVertCount), 1));
    this.filamentGeometry.setAttribute('aIsTrailEnd', new THREE.BufferAttribute(new Float32Array(filVertCount), 1));

    this.filamentMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDispersion: { value: 0 },
        uAttraction: { value: 0 },
        uRepulsion: { value: 0.25 },
        uSwirlSpeed: { value: 1.65 },
        uInitProgress: { value: 1.0 },
        uColorPrimary: { value: primary.clone() },
        uColorHighlight: { value: new THREE.Color(0xe6fbff) }
      },
      vertexShader: FILAMENT_VERTEX_SHADER,
      fragmentShader: FILAMENT_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.filamentLines = new THREE.LineSegments(this.filamentGeometry, this.filamentMaterial);
    this.filamentLines.frustumCulled = false;

    this.populatePoints(seedPoints);
  }

  public populatePoints(seedPoints: ParticleSeedPoint[]) {
    const len = seedPoints.length;
    if (len === 0) return;

    this.activeCount = Math.min(this.maxCount, len);

    for (let i = 0; i < this.maxCount; i++) {
      const src = seedPoints[i % len];
      const idx = i * 3;
      const ox = src.origin.x;
      const oy = src.origin.y;
      const oz = src.origin.z;

      this.origins[idx] = ox;
      this.origins[idx + 1] = oy;
      this.origins[idx + 2] = oz;

      let dx = src.dispersionDir?.x;
      let dy = src.dispersionDir?.y;
      let dz = src.dispersionDir?.z;

      if (dx === undefined || dy === undefined || dz === undefined) {
        const mag = Math.hypot(ox, oy, oz) || 1;
        const jitter = ((i * 73856093) % 100) / 100 - 0.5;
        dx = ox / mag + jitter * 0.45;
        dy = oy / mag + ((((i * 19349663) % 100) / 100) - 0.5) * 0.45;
        dz = oz / mag + ((((i * 83492791) % 100) / 100) - 0.5) * 0.45;
      }

      const dLen = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / dLen;
      const ny = dy / dLen;
      const nz = dz / dLen;

      this.dispersionDirs[idx] = nx;
      this.dispersionDirs[idx + 1] = ny;
      this.dispersionDirs[idx + 2] = nz;

      const targetRadius = 1.4 + ((i * 2654435761) % 100) / 100;
      this.targets[idx] = ox + nx * targetRadius;
      this.targets[idx + 1] = oy + ny * targetRadius;
      this.targets[idx + 2] = oz + nz * targetRadius;

      this.sizes[i] = src.size ?? (2.4 + ((i * 31) % 10) * 0.35);
      this.seeds[i] = ((i * 16807) % 2147483647) / 2147483647;
      this.colorMixes[i] = src.colorMix ?? ((i % 7) / 6);
    }

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aOrigin') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aTarget') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aDispersionDir') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSeed') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColorMix') as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, this.activeCount);

    this.rebuildFilaments();
  }

  private rebuildFilaments() {
    const fPos = this.filamentGeometry.getAttribute('position') as THREE.BufferAttribute;
    const fOrig = this.filamentGeometry.getAttribute('aOrigin') as THREE.BufferAttribute;
    const fTarg = this.filamentGeometry.getAttribute('aTarget') as THREE.BufferAttribute;
    const fDir = this.filamentGeometry.getAttribute('aDispersionDir') as THREE.BufferAttribute;
    const fSeed = this.filamentGeometry.getAttribute('aSeed') as THREE.BufferAttribute;
    const fTrail = this.filamentGeometry.getAttribute('aIsTrailEnd') as THREE.BufferAttribute;

    const count = Math.min(this.maxFilamentCount, this.activeCount);
    const step = Math.max(1, Math.floor(this.activeCount / count));
    let segs = 0;

    for (let i = 0; i < this.activeCount && segs < this.maxFilamentCount; i += step) {
      const v0 = segs * 2;
      const v1 = v0 + 1;

      fPos.setXYZ(v0, this.origins[i * 3], this.origins[i * 3 + 1], this.origins[i * 3 + 2]);
      fPos.setXYZ(v1, this.origins[i * 3], this.origins[i * 3 + 1], this.origins[i * 3 + 2]);

      fOrig.setXYZ(v0, this.origins[i * 3], this.origins[i * 3 + 1], this.origins[i * 3 + 2]);
      fOrig.setXYZ(v1, this.origins[i * 3], this.origins[i * 3 + 1], this.origins[i * 3 + 2]);

      fTarg.setXYZ(v0, this.targets[i * 3], this.targets[i * 3 + 1], this.targets[i * 3 + 2]);
      fTarg.setXYZ(v1, this.targets[i * 3], this.targets[i * 3 + 1], this.targets[i * 3 + 2]);

      fDir.setXYZ(v0, this.dispersionDirs[i * 3], this.dispersionDirs[i * 3 + 1], this.dispersionDirs[i * 3 + 2]);
      fDir.setXYZ(v1, this.dispersionDirs[i * 3], this.dispersionDirs[i * 3 + 1], this.dispersionDirs[i * 3 + 2]);

      fSeed.setX(v0, this.seeds[i]);
      fSeed.setX(v1, this.seeds[i]);

      fTrail.setX(v0, 0.0);
      fTrail.setX(v1, 1.0);

      segs++;
    }

    fPos.needsUpdate = true;
    fOrig.needsUpdate = true;
    fTarg.needsUpdate = true;
    fDir.needsUpdate = true;
    fSeed.needsUpdate = true;
    fTrail.needsUpdate = true;
    this.filamentGeometry.setDrawRange(0, segs * 2);
  }

  public setActiveCount(count: number) {
    this.activeCount = Math.max(200, Math.min(this.maxCount, Math.round(count)));
    this.geometry.setDrawRange(0, this.activeCount);
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public setTargetDispersion(value: number) {
    this.targetDispersion = Math.max(0, Math.min(1, value));
  }

  public getDispersion(): number {
    return this.currentDispersion;
  }

  public getState(): ParticleFormationState {
    return this.state;
  }

  public setInitProgress(progress: number) {
    const p = Math.max(0, Math.min(1, progress));
    this.material.uniforms.uInitProgress.value = p;
    this.filamentMaterial.uniforms.uInitProgress.value = p;
  }

  public getOriginalPosition(index: number, out = new THREE.Vector3()): THREE.Vector3 {
    const idx = Math.max(0, Math.min(this.maxCount - 1, index)) * 3;
    return out.set(this.origins[idx], this.origins[idx + 1], this.origins[idx + 2]);
  }

  public getTargetPosition(index: number, out = new THREE.Vector3()): THREE.Vector3 {
    const idx = Math.max(0, Math.min(this.maxCount - 1, index)) * 3;
    return out.set(this.targets[idx], this.targets[idx + 1], this.targets[idx + 2]);
  }

  public computeParticlePositionAt(index: number, dispersion: number, out = new THREE.Vector3()): THREE.Vector3 {
    const idx = Math.max(0, Math.min(this.maxCount - 1, index)) * 3;
    const d = Math.max(0, Math.min(1, dispersion));
    const easeD = d * d * (3 - 2 * d);
    const ox = this.origins[idx];
    const oy = this.origins[idx + 1];
    const oz = this.origins[idx + 2];
    const tx = this.targets[idx];
    const ty = this.targets[idx + 1];
    const tz = this.targets[idx + 2];
    const dx = this.dispersionDirs[idx];
    const dy = this.dispersionDirs[idx + 1];
    const dz = this.dispersionDirs[idx + 2];
    const rep = this.material.uniforms.uRepulsion.value as number;
    const spread = easeD * (2.6 + rep * 1.4);

    return out.set(
      ox + (tx - ox) * easeD + dx * spread,
      oy + (ty - oy) * easeD + dy * spread,
      oz + (tz - oz) * easeD + dz * spread
    );
  }

  public setParameters(params: {
    intensity?: number;
    opacity?: number;
    sizeScale?: number;
    attraction?: number;
    repulsion?: number;
    swirlSpeed?: number;
    voiceEnergy?: number;
  }) {
    if (params.intensity !== undefined) this.material.uniforms.uIntensity.value = params.intensity;
    if (params.opacity !== undefined) this.material.uniforms.uOpacity.value = params.opacity;
    if (params.sizeScale !== undefined) this.material.uniforms.uSizeScale.value = params.sizeScale;
    if (params.attraction !== undefined) {
      this.material.uniforms.uAttraction.value = params.attraction;
      this.filamentMaterial.uniforms.uAttraction.value = params.attraction;
    }
    if (params.repulsion !== undefined) {
      this.material.uniforms.uRepulsion.value = params.repulsion;
      this.filamentMaterial.uniforms.uRepulsion.value = params.repulsion;
    }
    if (params.swirlSpeed !== undefined) {
      this.material.uniforms.uSwirlSpeed.value = params.swirlSpeed;
      this.filamentMaterial.uniforms.uSwirlSpeed.value = params.swirlSpeed;
    }
    if (params.voiceEnergy !== undefined) {
      this.material.uniforms.uVoiceEnergy.value = params.voiceEnergy;
    }
  }

  public setColorTheme(hex: number) {
    const primary = new THREE.Color(hex);
    const secondary = primary.clone().offsetHSL(0.05, 0.05, -0.14);
    (this.material.uniforms.uColorPrimary.value as THREE.Color).copy(primary);
    (this.material.uniforms.uColorSecondary.value as THREE.Color).copy(secondary);
    (this.filamentMaterial.uniforms.uColorPrimary.value as THREE.Color).copy(primary);
  }

  public update(elapsedTime: number, delta: number = 0.016) {
    const clampedDt = Math.max(0.001, Math.min(0.1, delta));
    const prev = this.currentDispersion;
    const smooth = 1 - Math.exp(-8.5 * clampedDt);
    this.currentDispersion += (this.targetDispersion - this.currentDispersion) * smooth;
    if (Math.abs(this.targetDispersion - this.currentDispersion) < 0.0005) {
      this.currentDispersion = this.targetDispersion;
    }

    const diff = this.currentDispersion - prev;
    if (this.currentDispersion === 0 && prev === 0) {
      this.state = 'NORMAL';
    } else if (this.currentDispersion <= 0.02) {
      this.state =
        prev > 0.02 || this.state === 'RECONSTRUCTING' || this.state === 'RECONSTRUCTED'
          ? 'RECONSTRUCTED'
          : 'NORMAL';
    } else if (this.currentDispersion >= 0.85) {
      this.state = 'DISPERSED';
    } else if (diff < -0.0005 || this.targetDispersion < this.currentDispersion) {
      this.state = 'RECONSTRUCTING';
    } else {
      this.state = 'EXPANDING';
    }

    const attraction = this.state === 'RECONSTRUCTING' ? 0.55 : 0.0;
    this.material.uniforms.uTime.value = elapsedTime;
    this.material.uniforms.uDispersion.value = this.currentDispersion;
    this.material.uniforms.uAttraction.value = attraction;

    this.filamentMaterial.uniforms.uTime.value = elapsedTime;
    this.filamentMaterial.uniforms.uDispersion.value = this.currentDispersion;
    this.filamentMaterial.uniforms.uAttraction.value = attraction;
  }

  public dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.filamentGeometry.dispose();
    this.filamentMaterial.dispose();
  }
}
