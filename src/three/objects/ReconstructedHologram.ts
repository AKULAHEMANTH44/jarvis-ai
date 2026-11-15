import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HologramRenderMode, ReconstructionPresetId } from '../../types/hologram';
import { ComponentAnchor } from './RealWorldCatalog';

export function normalizeHologramGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = geometry.clone();
  geo.computeBoundingBox();

  if (geo.boundingBox) {
    const center = new THREE.Vector3();
    geo.boundingBox.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);

    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.0001);
    const targetSize = 2.6;
    const scale = targetSize / maxDim;
    geo.scale(scale, scale, scale);
  }

  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  return geo;
}

// Parse Wavefront .OBJ text into a normalized BufferGeometry
export function parseOBJ(objText: string): THREE.BufferGeometry {
  const vertices: number[] = [];
  const positions: number[] = [];

  const lines = objText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        vertices.push(x, y, z);
      }
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const faceIndices: number[] = [];
      const totalVerts = vertices.length / 3;
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i].split('/')[0];
        let idx = parseInt(token, 10);
        if (Number.isNaN(idx)) continue;
        if (idx < 0) idx = totalVerts + idx;
        else idx = idx - 1;
        if (idx >= 0 && idx < totalVerts) {
          faceIndices.push(idx);
        }
      }
      for (let i = 1; i + 1 < faceIndices.length; i++) {
        const a = faceIndices[0] * 3;
        const b = faceIndices[i] * 3;
        const c = faceIndices[i + 1] * 3;
        positions.push(
          vertices[a], vertices[a + 1], vertices[a + 2],
          vertices[b], vertices[b + 1], vertices[b + 2],
          vertices[c], vertices[c + 1], vertices[c + 2]
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  if (positions.length > 0) {
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  } else if (vertices.length > 0) {
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  } else {
    throw new Error('No valid vertices or faces found in OBJ file.');
  }

  return normalizeHologramGeometry(geo);
}

// Parse ASCII or Binary .STL buffer into a normalized BufferGeometry
export function parseSTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(buffer);
  const isBinary = (() => {
    if (buffer.byteLength < 84) return false;
    const faceCount = view.getUint32(80, true);
    const expectedSize = 84 + faceCount * 50;
    if (expectedSize === buffer.byteLength) return true;
    const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength)));
    return !header.trim().toLowerCase().startsWith('solid');
  })();

  const positions: number[] = [];

  if (isBinary) {
    const faceCount = view.getUint32(80, true);
    let offset = 84;
    for (let i = 0; i < faceCount; i++) {
      if (offset + 50 > buffer.byteLength) break;
      for (let v = 0; v < 3; v++) {
        const base = offset + 12 + v * 12;
        positions.push(
          view.getFloat32(base, true),
          view.getFloat32(base + 4, true),
          view.getFloat32(base + 8, true)
        );
      }
      offset += 50;
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    const vertexRegex = /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    let match: RegExpExecArray | null;
    while ((match = vertexRegex.exec(text)) !== null) {
      positions.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
    }
  }

  if (positions.length < 9) {
    throw new Error('No valid triangles found in STL file.');
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return normalizeHologramGeometry(geo);
}

// Parse binary .GLB or JSON .GLTF buffer using Three's built-in GLTFLoader
export async function parseGLTFOrGLB(
  buffer: ArrayBuffer,
  _filename: string
): Promise<{
  group: THREE.Group;
  vertexCount: number;
  faceCount: number;
  componentCount: number;
}> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    loader.parse(buffer, '', resolve, reject);
  });

  const root = gltf.scene || new THREE.Group();
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.0001);
    const scale = 2.6 / maxDim;
    root.scale.multiplyScalar(scale);
    root.position.sub(center.multiplyScalar(scale));
  }

  let vertexCount = 0;
  let faceCount = 0;
  let componentCount = 0;

  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      componentCount++;
      const pos = child.geometry.getAttribute('position');
      if (pos) {
        vertexCount += pos.count;
        const idx = child.geometry.getIndex();
        faceCount += idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
      }

      if (!child.geometry.getAttribute('normal')) {
        child.geometry.computeVertexNormals();
      }

      child.geometry.computeBoundingBox();
      const meshCenter = new THREE.Vector3();
      child.geometry.boundingBox?.getCenter(meshCenter);
      const dir = meshCenter.lengthSq() > 0.0001
        ? meshCenter.clone().normalize()
        : new THREE.Vector3(0, 0.5, 0);

      child.userData.basePosition = child.position.clone();
      child.userData.explosionVector = dir.multiplyScalar(0.75);
      child.userData.componentLabel = child.name || `Mesh Component ${componentCount}`;

      // Convert material to crisp translucent hologram surface preserving visibility
      child.material = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.65,
        wireframe: true,
        transparent: true,
        opacity: 0.8,
        roughness: 0.25,
        metalness: 0.8,
        side: THREE.DoubleSide
      });
    }
  });

  return { group: root, vertexCount, faceCount, componentCount };
}

// Reconstruct a 3D volumetric topographic relief mesh from single-view image/webcam luminance data
export function buildDepthReliefGeometry(
  pixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  gridW = 48,
  gridH = 36
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  const scaleX = 2.6;
  const scaleY = 2.0;

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const u = 1 - gx / (gridW - 1);
      const v = gy / (gridH - 1);
      const px = Math.min(srcWidth - 1, Math.max(0, Math.floor(u * (srcWidth - 1))));
      const py = Math.min(srcHeight - 1, Math.max(0, Math.floor(v * (srcHeight - 1))));
      const idx = (py * srcWidth + px) * 4;

      const r = pixels[idx] || 0;
      const g = pixels[idx + 1] || 0;
      const b = pixels[idx + 2] || 0;
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      const x = (gx / (gridW - 1) - 0.5) * scaleX;
      const y = (0.5 - gy / (gridH - 1)) * scaleY;
      const z = (luminance - 0.35) * 1.15;

      positions.push(x, y, z);
    }
  }

  for (let gy = 0; gy < gridH - 1; gy++) {
    for (let gx = 0; gx < gridW - 1; gx++) {
      const a = gy * gridW + gx;
      const b = a + 1;
      const c = a + gridW;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export interface ImageSampleInput {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Builds either:
 * - Single photo: honest 2.5D volumetric depth relief surface
 * - Multi-view (2+ photos): honest orthogonal silhouette hull approximation (front + side/top luminance carving)
 * Never claims complete true photogrammetric geometry from a single 2D photo.
 */
export function buildMultiViewSilhouetteGeometry(images: ImageSampleInput[]): {
  geometry: THREE.BufferGeometry;
  methodLabel: string;
} {
  if (images.length === 0) {
    throw new Error('At least one image sample is required for visual reconstruction.');
  }

  if (images.length === 1) {
    const img = images[0];
    return {
      geometry: buildDepthReliefGeometry(img.data, img.width, img.height, 48, 36),
      methodLabel: 'ILLUSTRATIVE 2.5D DEPTH RELIEF (Single photo does not contain complete 3D geometry)'
    };
  }

  // Multi-view visual-hull approximation sculpting an icosphere/box lattice using front & orthogonal views
  const sampleLum = (img: ImageSampleInput, u: number, v: number) => {
    const px = Math.min(img.width - 1, Math.max(0, Math.floor(u * (img.width - 1))));
    const py = Math.min(img.height - 1, Math.max(0, Math.floor(v * (img.height - 1))));
    const idx = (py * img.width + px) * 4;
    const r = img.data[idx] || 0;
    const g = img.data[idx + 1] || 0;
    const b = img.data[idx + 2] || 0;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };

  const baseGeo = new THREE.IcosahedronGeometry(1.18, 4);
  const pos = baseGeo.getAttribute('position');
  const front = images[0];
  const side = images[1];
  const top = images[2] || images[1];

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    const uFront = Math.max(0, Math.min(1, (vx / 1.2 + 1) * 0.5));
    const vFront = Math.max(0, Math.min(1, 1 - (vy / 1.2 + 1) * 0.5));
    const uSide = Math.max(0, Math.min(1, (vz / 1.2 + 1) * 0.5));
    const vTop = Math.max(0, Math.min(1, (vz / 1.2 + 1) * 0.5));

    const lFront = sampleLum(front, uFront, vFront);
    const lSide = sampleLum(side, uSide, vFront);
    const lTop = sampleLum(top, uFront, vTop);

    const hullFactor = 0.55 + ((lFront + lSide + lTop) / 3) * 0.65;
    pos.setXYZ(i, vx * hullFactor, vy * hullFactor, vz * hullFactor);
  }

  baseGeo.computeVertexNormals();
  return {
    geometry: normalizeHologramGeometry(baseGeo),
    methodLabel: `MULTI-VIEW SILHOUETTE HULL APPROXIMATION (${images.length} views · Illustrative volumetric envelope)`
  };
}

export async function reconstructFromImageFiles(files: File[]): Promise<{
  name: string;
  geometry: THREE.BufferGeometry;
  methodLabel: string;
}> {
  if (files.length === 0) {
    throw new Error('No image files supplied.');
  }

  const samples: ImageSampleInput[] = [];
  for (const file of files.slice(0, 4)) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`Unable to decode image file: ${file.name}`));
        el.src = url;
      });
      const w = 96;
      const h = 96;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable.');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      samples.push({ data: data.data, width: w, height: h });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const { geometry, methodLabel } = buildMultiViewSilhouetteGeometry(samples);
  const baseName = files[0].name.replace(/\.[^/.]+$/, '').slice(0, 22);
  const label =
    files.length === 1
      ? `${baseName} (2.5D Relief)`
      : `${baseName} (${files.length}-View Hull)`;

  return { name: label, geometry, methodLabel };
}

// Build procedural Stark Lab specimen geometries for instant reconstruction testing
export function buildPresetGeometry(presetId: ReconstructionPresetId): {
  name: string;
  geometry: THREE.BufferGeometry;
} {
  switch (presetId) {
    case 'palladium_core': {
      const geo = new THREE.TorusKnotGeometry(0.9, 0.28, 120, 18, 2, 3);
      return { name: 'Palladium Resonance Core', geometry: normalizeHologramGeometry(geo) };
    }
    case 'mark7_gauntlet': {
      const geo = new THREE.CylinderGeometry(0.62, 0.88, 2.5, 16, 8, true);
      return { name: 'Mark VII Gauntlet Shell', geometry: normalizeHologramGeometry(geo) };
    }
    case 'repulsor_turbine': {
      const geo = new THREE.TorusGeometry(1.0, 0.38, 18, 48);
      return { name: 'Repulsor Turbine Stator', geometry: normalizeHologramGeometry(geo) };
    }
    case 'crystal_lattice':
    default: {
      const geo = new THREE.OctahedronGeometry(1.4, 2);
      return { name: 'Vibranium Crystal Lattice', geometry: normalizeHologramGeometry(geo) };
    }
  }
}

export class ReconstructedHologramObject {
  public group: THREE.Group;
  public readonly vertexCount: number;
  public readonly faceCount: number;
  public readonly componentCount: number;

  private solidMesh?: THREE.Mesh;
  private wireMesh?: THREE.Mesh;
  private pointCloud?: THREE.Points;
  private edgeLines?: THREE.LineSegments;
  private importedGroup?: THREE.Group;
  private scanPlaneRing: THREE.Mesh;

  private renderMode: HologramRenderMode = 'HYBRID';
  private exploded: boolean = false;
  private explosionAmount: number = 0;
  private currentExplosion: number = 0;
  private pulseEnabled: boolean = true;
  private glowIntensity: number = 1.5;

  private scanActive: boolean = true;
  private scanProgress: number = 0;

  constructor(geometryOrGroup: THREE.BufferGeometry | THREE.Group, colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();

    if (geometryOrGroup instanceof THREE.Group) {
      this.importedGroup = geometryOrGroup;
      this.group.add(this.importedGroup);

      let vCount = 0;
      let fCount = 0;
      let cCount = 0;
      this.importedGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) {
          cCount++;
          const pos = child.geometry.getAttribute('position');
          if (pos) {
            vCount += pos.count;
            const idx = child.geometry.getIndex();
            fCount += idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
          }
        }
      });
      this.vertexCount = vCount;
      this.faceCount = fCount;
      this.componentCount = Math.max(1, cCount);
    } else {
      const geometry = geometryOrGroup;
      const posAttr = geometry.getAttribute('position');
      this.vertexCount = posAttr ? posAttr.count : 0;
      const indexAttr = geometry.getIndex();
      this.faceCount = indexAttr
        ? Math.floor(indexAttr.count / 3)
        : Math.floor(this.vertexCount / 3);
      this.componentCount = 4;

      // 1. Translucent Emissive Hologram Surface
      const solidMat = new THREE.MeshStandardMaterial({
        color: colorThemeHex,
        emissive: colorThemeHex,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.24,
        roughness: 0.25,
        metalness: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this.solidMesh = new THREE.Mesh(geometry, solidMat);
      this.solidMesh.userData.componentLabel = 'Holographic Surface Shell';
      this.group.add(this.solidMesh);

      // 2. Wireframe Topology Mesh
      const wireMat = new THREE.MeshBasicMaterial({
        color: colorThemeHex,
        wireframe: true,
        transparent: true,
        opacity: 0.52,
        blending: THREE.AdditiveBlending
      });
      this.wireMesh = new THREE.Mesh(geometry, wireMat);
      this.wireMesh.userData.componentLabel = 'Topological Wireframe';
      this.group.add(this.wireMesh);

      // 3. Volumetric Point Cloud Lattice
      const pointMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.055,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending
      });
      this.pointCloud = new THREE.Points(geometry, pointMat);
      this.pointCloud.userData.componentLabel = 'Vertex Point Lattice';
      this.group.add(this.pointCloud);

      // 4. Structural Edge Highlights
      const edgesGeo = new THREE.EdgesGeometry(geometry, 18);
      const edgeMat = new THREE.LineBasicMaterial({
        color: colorThemeHex,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending
      });
      this.edgeLines = new THREE.LineSegments(edgesGeo, edgeMat);
      this.group.add(this.edgeLines);
    }

    // 5. Laser Reconstruction Sweep Ring
    const ringGeo = new THREE.RingGeometry(1.45, 1.56, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    this.scanPlaneRing = new THREE.Mesh(ringGeo, ringMat);
    this.scanPlaneRing.rotation.x = Math.PI / 2;
    this.group.add(this.scanPlaneRing);

    this.applyRenderMode();
  }

  public getComponentAnchors(): ComponentAnchor[] {
    const anchors: ComponentAnchor[] = [];
    if (this.importedGroup) {
      let idx = 0;
      this.importedGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          idx++;
          anchors.push({
            id: `mesh-${idx}`,
            name: (child.userData.componentLabel as string) || child.name || `Part ${idx}`,
            object: child
          });
        }
      });
      return anchors.slice(0, 8);
    }
    if (this.solidMesh) anchors.push({ id: 'shell', name: 'Primary Surface Shell', object: this.solidMesh });
    if (this.wireMesh) anchors.push({ id: 'wire', name: 'Wireframe Topology', object: this.wireMesh });
    if (this.pointCloud) anchors.push({ id: 'pts', name: 'Vertex Point Cloud', object: this.pointCloud });
    return anchors;
  }

  public triggerScan() {
    this.scanActive = true;
    this.scanProgress = 0;
    this.scanPlaneRing.visible = true;
  }

  public setRenderMode(mode: HologramRenderMode) {
    this.renderMode = mode;
    this.applyRenderMode();
  }

  private applyRenderMode() {
    if (this.importedGroup) {
      this.importedGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.wireframe = this.renderMode !== 'SOLID_HOLO';
        }
      });
      return;
    }

    if (!this.solidMesh || !this.wireMesh || !this.pointCloud || !this.edgeLines) return;

    switch (this.renderMode) {
      case 'WIREFRAME':
        this.solidMesh.visible = false;
        this.wireMesh.visible = true;
        this.pointCloud.visible = false;
        this.edgeLines.visible = true;
        break;
      case 'POINT_CLOUD':
        this.solidMesh.visible = false;
        this.wireMesh.visible = false;
        this.pointCloud.visible = true;
        this.edgeLines.visible = false;
        break;
      case 'SOLID_HOLO':
        this.solidMesh.visible = true;
        this.wireMesh.visible = false;
        this.pointCloud.visible = false;
        this.edgeLines.visible = true;
        break;
      case 'HYBRID':
      default:
        this.solidMesh.visible = true;
        this.wireMesh.visible = true;
        this.pointCloud.visible = true;
        this.edgeLines.visible = true;
        break;
    }
  }

  public setExplodedView(exploded: boolean) {
    this.exploded = exploded;
    this.explosionAmount = exploded ? 1.0 : 0.0;
  }

  public setExplosionAmount(amount: number) {
    this.explosionAmount = Math.max(0, Math.min(1, amount));
    this.exploded = this.explosionAmount > 0.05;
  }

  public setPulseEnabled(enabled: boolean) {
    this.pulseEnabled = enabled;
  }

  public setGlowIntensity(intensity: number) {
    this.glowIntensity = Math.max(0.3, Math.min(3.0, intensity));
    if (this.importedGroup) {
      this.importedGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = 0.55 * this.glowIntensity;
        }
      });
      return;
    }
    if (this.solidMesh) {
      const solidMat = this.solidMesh.material as THREE.MeshStandardMaterial;
      solidMat.emissiveIntensity = 0.4 * this.glowIntensity;
      solidMat.opacity = Math.min(0.55, 0.16 * this.glowIntensity);
    }
    if (this.wireMesh) {
      (this.wireMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.95, 0.35 * this.glowIntensity);
    }
    if (this.pointCloud) {
      (this.pointCloud.material as THREE.PointsMaterial).size = 0.035 + this.glowIntensity * 0.015;
    }
  }

  public setColorTheme(hex: number) {
    if (this.importedGroup) {
      this.importedGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.setHex(hex);
          child.material.emissive.setHex(hex);
        }
      });
    }
    if (this.solidMesh) {
      const solidMat = this.solidMesh.material as THREE.MeshStandardMaterial;
      solidMat.color.setHex(hex);
      solidMat.emissive.setHex(hex);
    }
    if (this.wireMesh) (this.wireMesh.material as THREE.MeshBasicMaterial).color.setHex(hex);
    if (this.edgeLines) (this.edgeLines.material as THREE.LineBasicMaterial).color.setHex(hex);
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const targetExp = this.exploded ? Math.max(0.05, this.explosionAmount) : this.explosionAmount;
    this.currentExplosion += (targetExp - this.currentExplosion) * 0.1;

    if (this.importedGroup) {
      this.importedGroup.traverse((child) => {
        const base = child.userData.basePosition as THREE.Vector3 | undefined;
        const vec = child.userData.explosionVector as THREE.Vector3 | undefined;
        if (base && vec) {
          child.position.set(
            base.x + vec.x * this.currentExplosion,
            base.y + vec.y * this.currentExplosion,
            base.z + vec.z * this.currentExplosion
          );
        }
      });
    } else if (this.wireMesh && this.pointCloud && this.edgeLines && this.solidMesh) {
      const wireScale = 1 + this.currentExplosion * 0.22;
      const pointScale = 1 + this.currentExplosion * 0.42;
      const edgeScale = 1 + this.currentExplosion * 0.12;
      this.wireMesh.scale.set(wireScale, wireScale, wireScale);
      this.pointCloud.scale.set(pointScale, pointScale, pointScale);
      this.edgeLines.scale.set(edgeScale, edgeScale, edgeScale);

      if (this.pulseEnabled) {
        const pulse = 1 + Math.sin(time * 3.5) * 0.025;
        this.solidMesh.scale.set(pulse, pulse, pulse);
      } else {
        this.solidMesh.scale.set(1, 1, 1);
      }
    }

    // Laser scan sweep animation
    if (this.scanActive) {
      this.scanProgress += 0.022 * Math.max(0.5, speedMultiplier);
      const y = -1.6 + this.scanProgress * 3.2;
      this.scanPlaneRing.position.y = y;
      const ringMat = this.scanPlaneRing.material as THREE.MeshBasicMaterial;
      ringMat.opacity = Math.sin(Math.min(1, this.scanProgress) * Math.PI) * 0.95;

      const revealScale = 0.35 + Math.min(1, this.scanProgress) * 0.65;
      this.group.scale.y = revealScale;

      if (this.scanProgress >= 1.0) {
        this.scanActive = false;
        this.scanPlaneRing.visible = false;
        this.group.scale.y = 1.0;
      }
    }
  }
}
