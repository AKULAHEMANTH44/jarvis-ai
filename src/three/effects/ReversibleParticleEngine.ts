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

  varying float vColorMix;
  varying float vDispersion;
  varying float vSeed;

  void main() {
    vColorMix = aColorMix;
    vDispersion = uDispersion;
    vSeed = aSeed;

    // Ease dispersion smoothly so small hand movements near 0 or 1 have physical weight
    float d = clamp(uDispersion, 0.0, 1.0);
    float easeD = d * d * (3.0 - 2.0 * d);

    // Base formation interpolates from exact original coordinates toward target dispersion coordinates
    vec3 basePos = mix(aOrigin, aTarget, easeD);

    // Subtle organic orbital breathing even when intact
    float microPulse = sin(uTime * 1.8 + aSeed * 12.56) * 0.015 * (1.0 - easeD * 0.5);
    vec3 radialDir = length(aOrigin) > 0.001 ? normalize(aOrigin) : vec3(0.0, 1.0, 0.0);
    basePos += radialDir * microPulse;

    // Controlled 3D dispersion + curl swirl trajectory
    float swirlAngle = easeD * uSwirlSpeed * (1.2 + aSeed * 0.9) + sin(uTime * 0.6 + aSeed * 6.28) * 0.25 * easeD;
    float c = cos(swirlAngle);
    float s = sin(swirlAngle);

    vec3 offset = aDispersionDir * (easeD * (2.6 + uRepulsion * 1.4));
    offset.y += sin(uTime * 1.5 + aSeed * 18.0) * 0.22 * easeD;

    // Rotate offset around Y for holographic vortex flow
    vec3 rotatedOffset = vec3(
      offset.x * c - offset.z * s,
      offset.y,
      offset.x * s + offset.z * c
    );

    // Core attraction pulls slightly back during reconstruction
    vec3 worldPos = basePos + rotatedOffset * (1.0 - uAttraction * 0.35);

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float distScale = clamp(18.0 / max(1.0, -mvPosition.z), 0.75, 4.0);
    float burstSize = 1.0 + sin(easeD * 3.14159) * 0.55;
    gl_PointSize = aSize * uSizeScale * burstSize * distScale * uPixelRatio;
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

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv);
    if (dist > 0.5) discard;

    // Crisp core dot + soft radial holographic halo
    float core = smoothstep(0.22, 0.0, dist);
    float halo = pow(clamp(1.0 - dist * 2.0, 0.0, 1.0), 2.1);
    float alpha = (core * 0.85 + halo * 0.65) * uOpacity;

    // Twinkle modulation per particle
    float twinkle = 0.82 + 0.18 * sin(uTime * 3.2 + vSeed * 31.4159);
    alpha *= twinkle;

    vec3 baseCol = mix(uColorPrimary, uColorSecondary, vColorMix);
    vec3 finalCol = mix(baseCol, uColorHighlight, clamp(core * 0.75 + vDispersion * 0.25, 0.0, 1.0));
    gl_FragColor = vec4(finalCol * uIntensity, clamp(alpha, 0.0, 1.0));
  }
`;

export class ReversibleParticleEngine {
  public readonly points: THREE.Points;
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

      // Controlled outward radial + tangential dispersion direction
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

      // Target dispersed position preserves deterministic mapping from origin
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
  }) {
    if (params.intensity !== undefined) this.material.uniforms.uIntensity.value = params.intensity;
    if (params.opacity !== undefined) this.material.uniforms.uOpacity.value = params.opacity;
    if (params.sizeScale !== undefined) this.material.uniforms.uSizeScale.value = params.sizeScale;
    if (params.attraction !== undefined) this.material.uniforms.uAttraction.value = params.attraction;
    if (params.repulsion !== undefined) this.material.uniforms.uRepulsion.value = params.repulsion;
    if (params.swirlSpeed !== undefined) this.material.uniforms.uSwirlSpeed.value = params.swirlSpeed;
  }

  public setColorTheme(hex: number) {
    const primary = new THREE.Color(hex);
    const secondary = primary.clone().offsetHSL(0.05, 0.05, -0.14);
    (this.material.uniforms.uColorPrimary.value as THREE.Color).copy(primary);
    (this.material.uniforms.uColorSecondary.value as THREE.Color).copy(secondary);
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

    this.material.uniforms.uTime.value = elapsedTime;
    this.material.uniforms.uDispersion.value = this.currentDispersion;
    this.material.uniforms.uAttraction.value = this.state === 'RECONSTRUCTING' ? 0.55 : 0.0;
  }

  public dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
