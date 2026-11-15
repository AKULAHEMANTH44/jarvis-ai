import * as THREE from 'three';

const FIELD_VERT = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aSize;

  uniform float uTime;
  uniform float uInitProgress;
  uniform float uDispersion;
  uniform float uHandActive;
  uniform vec3 uHandPos;
  uniform float uSizeScale;
  uniform float uPixelRatio;

  varying float vDepthAlpha;
  varying float vColorMix;
  varying float vTwinkle;

  void main() {
    vec3 pos = position;

    // Gentle multi-depth harmonic cosmic drift
    float speed = 0.25 + aSeed.x * 0.45;
    pos.x += sin(uTime * speed + aSeed.y * 19.0) * 0.28;
    pos.y += cos(uTime * (speed * 0.85) + aSeed.z * 23.0) * 0.24;
    pos.z += sin(uTime * (speed * 0.6) + aSeed.x * 31.0) * 0.28;

    // Expand subtle cosmic field pulse during high dispersion
    pos += normalize(pos + vec3(0.0001)) * (uDispersion * 0.65 * aSeed.z);

    // Real-time hand proximity parting displacement on GPU
    if (uHandActive > 0.5) {
      vec3 diff = pos - uHandPos;
      float dist = length(diff);
      if (dist < 2.8 && dist > 0.05) {
        float push = (2.8 - dist) * 0.36;
        pos += (diff / dist) * push;
      }
    }

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float depthDist = max(1.5, -mvPos.z);
    vDepthAlpha = clamp(14.0 / (depthDist * depthDist + 3.0), 0.12, 1.0);
    vColorMix = aSeed.y;
    vTwinkle = 0.65 + 0.35 * sin(uTime * (1.8 + aSeed.z * 2.5) + aSeed.x * 40.0);

    float initScale = smoothstep(0.0, 0.45, uInitProgress + aSeed.x * 0.25);
    gl_PointSize = aSize * uSizeScale * uPixelRatio * clamp(16.0 / depthDist, 0.55, 2.8) * initScale;
  }
`;

const FIELD_FRAG = /* glsl */ `
  uniform vec3 uColorPrimary;
  uniform vec3 uColorSecondary;
  uniform float uOpacity;
  uniform float uInitProgress;

  varying float vDepthAlpha;
  varying float vColorMix;
  varying float vTwinkle;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;

    float core = smoothstep(0.24, 0.0, d);
    float halo = pow(clamp(1.0 - d * 2.0, 0.0, 1.0), 2.2);
    float alpha = (core * 0.75 + halo * 0.55) * uOpacity * vDepthAlpha * vTwinkle * clamp(uInitProgress * 1.35, 0.0, 1.0);

    vec3 col = mix(uColorPrimary, uColorSecondary, vColorMix);
    col = mix(col, vec3(0.88, 0.98, 1.0), core * 0.5);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export class ParticleFieldEffect {
  public points: THREE.Points;
  private count: number;
  private maxCount: number = 5000;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(count = 1500, colorThemeHex = 0x00f0ff) {
    this.count = Math.max(200, Math.min(this.maxCount, count));
    const positions = new Float32Array(this.maxCount * 3);
    const seeds = new Float32Array(this.maxCount * 3);
    const sizes = new Float32Array(this.maxCount);

    for (let i = 0; i < this.maxCount; i++) {
      // Distribute across deeper spatial volume around the central sphere without crowding center
      const u = ((i * 7919) % 10000) / 10000;
      const v = ((i * 6271) % 10000) / 10000;
      const w = ((i * 3571) % 10000) / 10000;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const radius = 2.8 + Math.pow(w, 0.72) * 11.5;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta) * 1.35;
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.9;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 2.0;

      seeds[i * 3] = ((i * 1733) % 1000) / 1000;
      seeds[i * 3 + 1] = ((i * 4129) % 1000) / 1000;
      seeds[i * 3 + 2] = ((i * 8923) % 1000) / 1000;
      sizes[i] = i % 13 === 0 ? 3.8 : 1.5 + (i % 5) * 0.4;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setDrawRange(0, this.count);

    const primary = new THREE.Color(colorThemeHex);
    const secondary = primary.clone().offsetHSL(0.06, 0.05, -0.18);
    const pixelRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uInitProgress: { value: 1.0 },
        uDispersion: { value: 0.0 },
        uHandActive: { value: 0.0 },
        uHandPos: { value: new THREE.Vector3() },
        uSizeScale: { value: 1.0 },
        uPixelRatio: { value: pixelRatio },
        uColorPrimary: { value: primary },
        uColorSecondary: { value: secondary },
        uOpacity: { value: 0.7 }
      },
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  public setParticleCount(newCount: number) {
    this.count = Math.max(200, Math.min(this.maxCount, Math.round(newCount)));
    this.geometry.setDrawRange(0, this.count);
  }

  public setGlowIntensity(intensity: number) {
    this.material.uniforms.uOpacity.value = Math.min(1.0, 0.42 * intensity);
    this.material.uniforms.uSizeScale.value = 0.8 + intensity * 0.22;
  }

  public setColorTheme(hex: number) {
    const primary = new THREE.Color(hex);
    const secondary = primary.clone().offsetHSL(0.06, 0.05, -0.18);
    (this.material.uniforms.uColorPrimary.value as THREE.Color).copy(primary);
    (this.material.uniforms.uColorSecondary.value as THREE.Color).copy(secondary);
  }

  public setInitProgress(progress: number) {
    this.material.uniforms.uInitProgress.value = Math.max(0, Math.min(1, progress));
  }

  public setDispersion(dispersion: number) {
    this.material.uniforms.uDispersion.value = Math.max(0, Math.min(1, dispersion));
  }

  public update(time: number, handCentroid?: { x: number; y: number; z: number }) {
    this.material.uniforms.uTime.value = time;
    if (handCentroid) {
      this.material.uniforms.uHandActive.value = 1.0;
      (this.material.uniforms.uHandPos.value as THREE.Vector3).set(
        (handCentroid.x - 0.5) * 12,
        -(handCentroid.y - 0.5) * 9,
        (handCentroid.z || 0) * 8
      );
    } else {
      this.material.uniforms.uHandActive.value = 0.0;
    }
  }

  public dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
