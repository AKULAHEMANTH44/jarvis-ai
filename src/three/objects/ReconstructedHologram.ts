import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HologramRenderMode, ReconstructionPresetId } from '../../types/hologram';
import { ComponentAnchor } from './RealWorldCatalog';

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'envMap',
  'lightMap',
  'specularMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap'
] as const;

const TINY_TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function disposeMaterialAndTextures(
  material: THREE.Material | THREE.Material[] | null | undefined,
  disposedTextures?: Set<THREE.Texture>,
  disposedMaterials?: Set<THREE.Material>
): void {
  if (!material) return;
  const texSet = disposedTextures ?? new Set<THREE.Texture>();
  const matSet = disposedMaterials ?? new Set<THREE.Material>();
  const list = Array.isArray(material) ? material : [material];

  for (const mat of list) {
    if (!mat || matSet.has(mat)) continue;
    matSet.add(mat);

    const record = mat as unknown as Record<string, unknown>;
    for (const slot of TEXTURE_SLOTS) {
      const tex = record[slot];
      if (tex instanceof THREE.Texture && !texSet.has(tex)) {
        texSet.add(tex);
        tex.dispose();
      }
    }

    if (mat instanceof THREE.ShaderMaterial && mat.uniforms) {
      for (const uniform of Object.values(mat.uniforms)) {
        const val = uniform?.value;
        if (val instanceof THREE.Texture && !texSet.has(val)) {
          texSet.add(val);
          val.dispose();
        } else if (Array.isArray(val)) {
          for (const entry of val) {
            if (entry instanceof THREE.Texture && !texSet.has(entry)) {
              texSet.add(entry);
              entry.dispose();
            }
          }
        }
      }
    }

    mat.dispose();
  }
}

export function disposeObject3DResources(root: THREE.Object3D | null | undefined): void {
  if (!root) return;
  const disposedGeos = new Set<THREE.BufferGeometry>();
  const disposedMats = new Set<THREE.Material>();
  const disposedTexs = new Set<THREE.Texture>();

  root.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.Line ||
      obj instanceof THREE.LineSegments ||
      obj instanceof THREE.LineLoop ||
      obj instanceof THREE.Points
    ) {
      if (obj.geometry && !disposedGeos.has(obj.geometry)) {
        disposedGeos.add(obj.geometry);
        obj.geometry.dispose();
      }
      disposeMaterialAndTextures(obj.material, disposedTexs, disposedMats);
    }
  });
}

function deterministicFibonacciDir(index: number): THREE.Vector3 {
  const i = Math.max(0, index) + 1;
  const phi = Math.acos(1 - 2 * ((i * 0.61803398875) % 1));
  const theta = Math.PI * 2 * ((i * 0.38196601125) % 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  ).normalize();
}

function validateFiniteGeometry(geometry: THREE.BufferGeometry, contextLabel: string): number {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) {
    throw new Error(`${contextLabel} contains empty geometry (0 vertices).`);
  }
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
      throw new Error(`${contextLabel} contains invalid non-finite vertex coordinates.`);
    }
  }
  geometry.computeBoundingBox();
  if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) {
    throw new Error(`${contextLabel} produced an empty bounding volume.`);
  }
  return pos.count;
}

export function normalizeHologramGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  validateFiniteGeometry(geometry, '3D model');
  const geo = geometry.clone();
  geo.computeBoundingBox();

  if (geo.boundingBox) {
    const center = new THREE.Vector3();
    geo.boundingBox.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);

    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim <= 1e-6) {
      geo.dispose();
      throw new Error('3D model geometry is degenerate (zero extents).');
    }
    const targetSize = 2.6;
    const scale = targetSize / maxDim;
    geo.scale(scale, scale, scale);
  }

  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function parseOBJRaw(objText: string): {
  groups: { name: string; positions: number[] }[];
  looseVertices: number[];
} {
  if (!objText || !objText.trim()) {
    throw new Error('OBJ file is empty.');
  }

  const vertices: number[] = [];
  const groupsMap = new Map<string, number[]>();
  let currentGroupName = 'Primary Mesh';
  let unnamedCounter = 0;

  const ensureGroup = (name: string) => {
    const clean = name.trim() || `Part ${++unnamedCounter}`;
    let arr = groupsMap.get(clean);
    if (!arr) {
      arr = [];
      groupsMap.set(clean, arr);
    }
    return arr;
  };

  const lines = objText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const directive = parts[0];

    if (directive === 'v' && parts.length >= 4) {
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        vertices.push(x, y, z);
      }
    } else if ((directive === 'o' || directive === 'g') && parts.length >= 2) {
      currentGroupName = parts.slice(1).join(' ').trim() || `Part ${++unnamedCounter}`;
      ensureGroup(currentGroupName);
    } else if (directive === 'f' && parts.length >= 4) {
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
      if (faceIndices.length >= 3) {
        const target = ensureGroup(currentGroupName);
        for (let i = 1; i + 1 < faceIndices.length; i++) {
          const a = faceIndices[0] * 3;
          const b = faceIndices[i] * 3;
          const c = faceIndices[i + 1] * 3;
          target.push(
            vertices[a], vertices[a + 1], vertices[a + 2],
            vertices[b], vertices[b + 1], vertices[b + 2],
            vertices[c], vertices[c + 1], vertices[c + 2]
          );
        }
      }
    }
  }

  const nonEmptyGroups: { name: string; positions: number[] }[] = [];
  groupsMap.forEach((positions, name) => {
    if (positions.length >= 9) {
      nonEmptyGroups.push({ name, positions });
    }
  });

  return { groups: nonEmptyGroups, looseVertices: vertices };
}

// Parse Wavefront .OBJ text into a single normalized BufferGeometry (kept for direct single-mesh consumers)
export function parseOBJ(objText: string): THREE.BufferGeometry {
  const { groups, looseVertices } = parseOBJRaw(objText);
  const geo = new THREE.BufferGeometry();

  if (groups.length > 0) {
    const merged: number[] = [];
    for (const g of groups) {
      for (let i = 0; i < g.positions.length; i++) merged.push(g.positions[i]);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
  } else if (looseVertices.length >= 9) {
    geo.setAttribute('position', new THREE.Float32BufferAttribute(looseVertices, 3));
  } else {
    geo.dispose();
    throw new Error('No valid vertices or faces found in OBJ file.');
  }

  return normalizeHologramGeometry(geo);
}

// Parse Wavefront .OBJ text preserving o/g object & group hierarchy for exploded inspection & selection
export function parseOBJAsGroup(objText: string): {
  group: THREE.Group;
  vertexCount: number;
  faceCount: number;
  componentCount: number;
} {
  const { groups, looseVertices } = parseOBJRaw(objText);
  const parts =
    groups.length > 0
      ? groups
      : looseVertices.length >= 9
      ? [{ name: 'Point Mesh', positions: looseVertices }]
      : [];

  if (parts.length === 0) {
    throw new Error('No valid vertices or faces found in OBJ file.');
  }

  // Compute global bounding box first so all o/g parts normalize uniformly around shared center
  const totalBox = new THREE.Box3();
  const tempVec = new THREE.Vector3();
  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      tempVec.set(part.positions[i], part.positions[i + 1], part.positions[i + 2]);
      totalBox.expandByPoint(tempVec);
    }
  }

  if (totalBox.isEmpty()) {
    throw new Error('OBJ model has an empty bounding volume.');
  }

  const globalCenter = totalBox.getCenter(new THREE.Vector3());
  const globalSize = totalBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(globalSize.x, globalSize.y, globalSize.z);
  if (maxDim <= 1e-6 || !Number.isFinite(maxDim)) {
    throw new Error('OBJ geometry is degenerate (zero extents).');
  }
  const normScale = 2.6 / maxDim;

  const root = new THREE.Group();
  let vertexCount = 0;
  let faceCount = 0;

  parts.forEach((part, idx) => {
    // Center each component geometry around its own local centroid and position mesh at that centroid
    // in normalized root space so transforms & component bounding centers stay intuitive.
    const posArr = new Float32Array(part.positions.length);
    const compBox = new THREE.Box3();
    for (let i = 0; i < part.positions.length; i += 3) {
      const nx = (part.positions[i] - globalCenter.x) * normScale;
      const ny = (part.positions[i + 1] - globalCenter.y) * normScale;
      const nz = (part.positions[i + 2] - globalCenter.z) * normScale;
      posArr[i] = nx;
      posArr[i + 1] = ny;
      posArr[i + 2] = nz;
      tempVec.set(nx, ny, nz);
      compBox.expandByPoint(tempVec);
    }

    const partCenter = compBox.getCenter(new THREE.Vector3());
    for (let i = 0; i < posArr.length; i += 3) {
      posArr[i] -= partCenter.x;
      posArr[i + 1] -= partCenter.y;
      posArr[i + 2] -= partCenter.z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.28,
      roughness: 0.25,
      metalness: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = part.name;
    mesh.position.copy(partCenter);

    const dir =
      partCenter.lengthSq() > 1e-4 ? partCenter.clone().normalize() : deterministicFibonacciDir(idx);
    mesh.userData.basePosition = mesh.position.clone();
    mesh.userData.baseScale = mesh.scale.clone();
    mesh.userData.explosionVector = dir.multiplyScalar(0.75);
    mesh.userData.componentLabel = part.name;
    mesh.userData.componentId = `part-${idx + 1}`;

    root.add(mesh);
    const vCount = posArr.length / 3;
    vertexCount += vCount;
    faceCount += Math.floor(vCount / 3);
  });

  return {
    group: root,
    vertexCount,
    faceCount,
    componentCount: parts.length
  };
}

// Parse ASCII or Binary .STL buffer into a normalized BufferGeometry
export function parseSTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('STL file is empty.');
  }

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
        const x = view.getFloat32(base, true);
        const y = view.getFloat32(base + 4, true);
        const z = view.getFloat32(base + 8, true);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          throw new Error('Binary STL contains invalid NaN/Infinite coordinates.');
        }
        positions.push(x, y, z);
      }
      offset += 50;
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    const vertexRegex =
      /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    let match: RegExpExecArray | null;
    while ((match = vertexRegex.exec(text)) !== null) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      const z = parseFloat(match[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        positions.push(x, y, z);
      }
    }
  }

  if (positions.length < 9) {
    throw new Error('No valid triangles found in STL file.');
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return normalizeHologramGeometry(geo);
}

function isGLBBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer);
  // Magic ASCII 'glTF' in little-endian u32 is 0x46546C67
  return view.getUint32(0, true) === 0x46546c67;
}

function normalizeResourceKey(raw: string): string {
  const cleaned = decodeURIComponent(raw).replace(/\\/g, '/').replace(/^\.\//, '');
  return cleaned.toLowerCase();
}

function buildResourceFileLookup(resourceFiles?: File[]): {
  urlMap: Map<string, string>;
  createdBlobUrls: string[];
} {
  const urlMap = new Map<string, string>();
  const createdBlobUrls: string[] = [];
  if (!resourceFiles || resourceFiles.length === 0 || typeof URL === 'undefined' || !URL.createObjectURL) {
    return { urlMap, createdBlobUrls };
  }

  for (const file of resourceFiles) {
    const blobUrl = URL.createObjectURL(file);
    createdBlobUrls.push(blobUrl);

    const webkitRel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (webkitRel) {
      urlMap.set(normalizeResourceKey(webkitRel), blobUrl);
    }
    urlMap.set(normalizeResourceKey(file.name), blobUrl);
    const basename = file.name.split('/').pop()?.split('\\').pop() || file.name;
    urlMap.set(normalizeResourceKey(basename), blobUrl);
  }

  return { urlMap, createdBlobUrls };
}

function validateExternalGltfUris(
  buffer: ArrayBuffer,
  filename: string,
  urlMap: Map<string, string>
): void {
  if (isGLBBuffer(buffer)) return;

  let jsonText = '';
  try {
    jsonText = new TextDecoder().decode(buffer);
  } catch {
    throw new Error(`Unable to decode GLTF file "${filename}".`);
  }

  let parsed: {
    buffers?: Array<{ uri?: string }>;
    images?: Array<{ uri?: string }>;
    meshes?: unknown[];
    asset?: { version?: string };
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Invalid GLTF JSON in "${filename}".`);
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.asset) {
    throw new Error(`"${filename}" is not a valid glTF 2.0 document.`);
  }

  const buffers = Array.isArray(parsed.buffers) ? parsed.buffers : [];
  for (const buf of buffers) {
    const uri = buf?.uri;
    if (!uri) continue;
    if (/^(data:|blob:|https?:)/i.test(uri)) continue;

    const norm = normalizeResourceKey(uri);
    const base = normalizeResourceKey(uri.split('/').pop() || uri);
    if (!urlMap.has(norm) && !urlMap.has(base)) {
      throw new Error(
        `External GLTF buffer "${uri}" is missing. Drop "${filename}" together with "${base}", or export a self-contained .glb file.`
      );
    }
  }
}

// Parse binary .GLB or JSON .GLTF buffer (plus optional companion .bin/texture Files) using Three's GLTFLoader
export async function parseGLTFOrGLB(
  buffer: ArrayBuffer,
  filename: string,
  resourceFiles?: File[]
): Promise<{
  group: THREE.Group;
  vertexCount: number;
  faceCount: number;
  componentCount: number;
}> {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error(`Model file "${filename}" is empty.`);
  }

  const { urlMap, createdBlobUrls } = buildResourceFileLookup(resourceFiles);

  if (!isGLBBuffer(buffer)) {
    try {
      validateExternalGltfUris(buffer, filename, urlMap);
    } catch (err) {
      for (const blobUrl of createdBlobUrls) URL.revokeObjectURL(blobUrl);
      throw err;
    }
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data:|blob:)/i.test(url)) return url;
    const norm = normalizeResourceKey(url);
    const base = normalizeResourceKey(url.split('/').pop() || url);
    if (urlMap.has(norm)) return urlMap.get(norm)!;
    if (urlMap.has(base)) return urlMap.get(base)!;

    // If an external image texture wasn't supplied alongside a .gltf/.bin pair, substitute a 1x1 transparent PNG
    // instead of triggering failing relative network requests (original textures are converted to holographic shaders).
    if (/\.(png|jpe?g|webp|gif|bmp|ktx2)$/i.test(base)) {
      return TINY_TRANSPARENT_PNG;
    }
    return url;
  });

  const loader = new GLTFLoader(manager);
  let dracoLoader: DRACOLoader | null = null;

  try {
    if (typeof Worker !== 'undefined') {
      dracoLoader = new DRACOLoader(manager);
      dracoLoader.setDecoderPath('/draco/');
      loader.setDRACOLoader(dracoLoader);
    }

    try {
      const meshopt = MeshoptDecoder as unknown as { supported?: boolean; ready?: Promise<void> };
      if (meshopt && meshopt.supported) {
        if (meshopt.ready) {
          await meshopt.ready;
        }
        loader.setMeshoptDecoder(MeshoptDecoder);
      }
    } catch {
      // Meshopt decoder unavailable in non-browser/restricted WASM environments; continue without it
    }

    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });

    const rawScene = gltf.scene || new THREE.Group();
    const normalizedRoot = new THREE.Group();
    normalizedRoot.name = filename.replace(/\.(glb|gltf)$/i, '') || 'GLTF Model';
    normalizedRoot.add(rawScene);
    normalizedRoot.updateMatrixWorld(true);

    // Collect valid renderable meshes first & validate geometry
    const meshes: THREE.Mesh[] = [];
    let vertexCount = 0;
    let faceCount = 0;

    rawScene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const pos = child.geometry.getAttribute('position');
        if (!pos || pos.count === 0) return;

        // Verify coordinates are finite
        for (let i = 0; i < pos.count; i++) {
          if (
            !Number.isFinite(pos.getX(i)) ||
            !Number.isFinite(pos.getY(i)) ||
            !Number.isFinite(pos.getZ(i))
          ) {
            disposeObject3DResources(normalizedRoot);
            throw new Error(`Model "${filename}" contains invalid NaN/Infinite mesh vertices.`);
          }
        }

        if (!child.geometry.getAttribute('normal')) {
          child.geometry.computeVertexNormals();
        }
        child.geometry.computeBoundingBox();

        meshes.push(child);
        vertexCount += pos.count;
        const idx = child.geometry.getIndex();
        faceCount += idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
      }
    });

    if (meshes.length === 0 || vertexCount === 0) {
      disposeObject3DResources(normalizedRoot);
      throw new Error(`Model "${filename}" contains no valid renderable 3D mesh geometry.`);
    }

    const box = new THREE.Box3().setFromObject(normalizedRoot);
    if (box.isEmpty()) {
      disposeObject3DResources(normalizedRoot);
      throw new Error(`Model "${filename}" produced an empty bounding volume.`);
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim <= 1e-6 || !Number.isFinite(maxDim)) {
      disposeObject3DResources(normalizedRoot);
      throw new Error(`Model "${filename}" has zero spatial extents.`);
    }

    const normScale = 2.6 / maxDim;
    rawScene.scale.multiplyScalar(normScale);
    rawScene.position.sub(center.multiplyScalar(normScale));
    normalizedRoot.updateMatrixWorld(true);

    // Precompute world-to-parent transforms BEFORE mutating any node positions during playback
    const parentInverses = new Map<THREE.Mesh, THREE.Matrix4>();
    for (const mesh of meshes) {
      const parentMatWorld = mesh.parent ? mesh.parent.matrixWorld : normalizedRoot.matrixWorld;
      parentInverses.set(mesh, parentMatWorld.clone().invert());
    }

    const localCenterVec = new THREE.Vector3();
    const worldCenterVec = new THREE.Vector3();
    const worldDisplacedVec = new THREE.Vector3();
    const localDisplacedVec = new THREE.Vector3();
    const localStartVec = new THREE.Vector3();

    meshes.forEach((child, idx) => {
      const componentIdx = idx + 1;
      child.geometry.boundingBox?.getCenter(localCenterVec);
      worldCenterVec.copy(localCenterVec).applyMatrix4(child.matrixWorld);

      const worldDir =
        worldCenterVec.lengthSq() > 1e-4
          ? worldCenterVec.clone().normalize()
          : deterministicFibonacciDir(componentIdx);

      worldDisplacedVec.copy(worldCenterVec).addScaledVector(worldDir, 0.75);

      const parentInv = parentInverses.get(child)!;
      localStartVec.copy(worldCenterVec).applyMatrix4(parentInv);
      localDisplacedVec.copy(worldDisplacedVec).applyMatrix4(parentInv);
      const localExplosionVec = localDisplacedVec.clone().sub(localStartVec);

      child.userData.basePosition = child.position.clone();
      child.userData.baseScale = child.scale.clone();
      child.userData.explosionVector = localExplosionVec;
      child.userData.componentLabel = child.name || `Component ${componentIdx}`;
      child.userData.componentId = `mesh-${componentIdx}`;

      // Dispose original GLTF PBR materials & textures before replacing with holographic material
      disposeMaterialAndTextures(child.material);
      child.material = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.48,
        transparent: true,
        opacity: 0.28,
        roughness: 0.25,
        metalness: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false
      });
    });

    return {
      group: normalizedRoot,
      vertexCount,
      faceCount,
      componentCount: meshes.length
    };
  } finally {
    if (dracoLoader) {
      dracoLoader.dispose();
    }
    for (const blobUrl of createdBlobUrls) {
      URL.revokeObjectURL(blobUrl);
    }
  }
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
    files.length === 1 ? `${baseName} (2.5D Relief)` : `${baseName} (${files.length}-View Hull)`;

  return { name: label, geometry, methodLabel };
}

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

interface ImportedPartLayer {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  solidMat: THREE.MeshStandardMaterial;
  wireMesh: THREE.Mesh;
  pointCloud: THREE.Points;
  edgeLines: THREE.LineSegments;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
  explosionVector: THREE.Vector3;
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
  private importedParts: ImportedPartLayer[] = [];
  private scanPlaneRing: THREE.Mesh;

  private renderMode: HologramRenderMode = 'HYBRID';
  private exploded: boolean = false;
  private explosionAmount: number = 0;
  private currentExplosion: number = 0;
  private pulseEnabled: boolean = true;
  private glowIntensity: number = 1.5;
  private colorThemeHex: number;

  private selectedComponentId: string | null = null;
  private isolatedComponentId: string | null = null;
  private highlightedComponentId: string | null = null;

  private scanActive: boolean = true;
  private scanProgress: number = 0;

  constructor(geometryOrGroup: THREE.BufferGeometry | THREE.Group, colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();
    this.colorThemeHex = colorThemeHex;

    if (geometryOrGroup instanceof THREE.Group) {
      this.importedGroup = geometryOrGroup;
      this.group.add(this.importedGroup);

      const sourceMeshes: THREE.Mesh[] = [];
      this.importedGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry && !child.userData.isHoloOverlay) {
          sourceMeshes.push(child);
        }
      });

      let vCount = 0;
      let fCount = 0;
      sourceMeshes.forEach((mesh, idx) => {
        const pos = mesh.geometry.getAttribute('position');
        if (!pos || pos.count === 0) return;

        vCount += pos.count;
        const idxAttr = mesh.geometry.getIndex();
        fCount += idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(pos.count / 3);

        const partId = (mesh.userData.componentId as string) || `mesh-${idx + 1}`;
        const partName =
          (mesh.userData.componentLabel as string) || mesh.name || `Component ${idx + 1}`;
        mesh.userData.componentId = partId;
        mesh.userData.componentLabel = partName;

        const basePos =
          mesh.userData.basePosition instanceof THREE.Vector3
            ? mesh.userData.basePosition.clone()
            : mesh.position.clone();
        const baseScale =
          mesh.userData.baseScale instanceof THREE.Vector3
            ? mesh.userData.baseScale.clone()
            : mesh.scale.clone();
        const expVec =
          mesh.userData.explosionVector instanceof THREE.Vector3
            ? mesh.userData.explosionVector.clone()
            : deterministicFibonacciDir(idx).multiplyScalar(0.75);

        mesh.userData.basePosition = basePos;
        mesh.userData.baseScale = baseScale;
        mesh.userData.explosionVector = expVec;

        // Replace original PBR material & textures cleanly with uniform holographic shader
        disposeMaterialAndTextures(mesh.material);
        const solidMat = new THREE.MeshStandardMaterial({
          color: colorThemeHex,
          emissive: colorThemeHex,
          emissiveIntensity: 0.45,
          transparent: true,
          opacity: 0.24,
          roughness: 0.25,
          metalness: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        mesh.material = solidMat;

        const wireMat = new THREE.MeshBasicMaterial({
          color: colorThemeHex,
          wireframe: true,
          transparent: true,
          opacity: 0.48,
          blending: THREE.AdditiveBlending
        });
        const wireMesh = new THREE.Mesh(mesh.geometry, wireMat);
        wireMesh.userData.isHoloOverlay = true;
        wireMesh.userData.overlayKind = 'wire';
        wireMesh.userData.componentId = partId;
        mesh.add(wireMesh);

        const pointMat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: 0.045,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending
        });
        const pointCloud = new THREE.Points(mesh.geometry, pointMat);
        pointCloud.userData.isHoloOverlay = true;
        pointCloud.userData.overlayKind = 'points';
        pointCloud.userData.componentId = partId;
        mesh.add(pointCloud);

        const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, 18);
        const edgeMat = new THREE.LineBasicMaterial({
          color: colorThemeHex,
          transparent: true,
          opacity: 0.62,
          blending: THREE.AdditiveBlending
        });
        const edgeLines = new THREE.LineSegments(edgesGeo, edgeMat);
        edgeLines.userData.isHoloOverlay = true;
        edgeLines.userData.overlayKind = 'edges';
        edgeLines.userData.componentId = partId;
        mesh.add(edgeLines);

        this.importedParts.push({
          id: partId,
          name: partName,
          mesh,
          solidMat,
          wireMesh,
          pointCloud,
          edgeLines,
          basePosition: basePos,
          baseScale,
          explosionVector: expVec
        });
      });

      if (vCount === 0 || this.importedParts.length === 0) {
        disposeObject3DResources(this.group);
        throw new Error('Cannot construct hologram from an empty or 0-vertex model group.');
      }

      this.vertexCount = vCount;
      this.faceCount = fCount;
      this.componentCount = this.importedParts.length;
    } else {
      const geometry = geometryOrGroup;
      const posAttr = geometry.getAttribute('position');
      if (!posAttr || posAttr.count === 0) {
        throw new Error('Cannot construct hologram from empty geometry (0 vertices).');
      }
      this.vertexCount = posAttr.count;
      const indexAttr = geometry.getIndex();
      this.faceCount = indexAttr
        ? Math.floor(indexAttr.count / 3)
        : Math.floor(this.vertexCount / 3);
      this.componentCount = 4;

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
      this.solidMesh.userData.componentId = 'shell';
      this.solidMesh.userData.componentLabel = 'Holographic Surface Shell';
      this.group.add(this.solidMesh);

      const wireMat = new THREE.MeshBasicMaterial({
        color: colorThemeHex,
        wireframe: true,
        transparent: true,
        opacity: 0.52,
        blending: THREE.AdditiveBlending
      });
      this.wireMesh = new THREE.Mesh(geometry, wireMat);
      this.wireMesh.userData.componentId = 'wire';
      this.wireMesh.userData.componentLabel = 'Topological Wireframe';
      this.wireMesh.userData.isHoloOverlay = true;
      this.group.add(this.wireMesh);

      const pointMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.055,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending
      });
      this.pointCloud = new THREE.Points(geometry, pointMat);
      this.pointCloud.userData.componentId = 'pts';
      this.pointCloud.userData.componentLabel = 'Vertex Point Lattice';
      this.pointCloud.userData.isHoloOverlay = true;
      this.group.add(this.pointCloud);

      const edgesGeo = new THREE.EdgesGeometry(geometry, 18);
      const edgeMat = new THREE.LineBasicMaterial({
        color: colorThemeHex,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending
      });
      this.edgeLines = new THREE.LineSegments(edgesGeo, edgeMat);
      this.edgeLines.userData.isHoloOverlay = true;
      this.group.add(this.edgeLines);
    }

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
    this.scanPlaneRing.userData.isHoloOverlay = true;
    this.group.add(this.scanPlaneRing);

    this.applyRenderMode();
    this.applyGlowAndHighlights();
  }

  public getComponentAnchors(): ComponentAnchor[] {
    if (this.importedParts.length > 0) {
      return this.importedParts.map((part) => ({
        id: part.id,
        name: part.name,
        object: part.mesh
      }));
    }
    const anchors: ComponentAnchor[] = [];
    if (this.solidMesh) anchors.push({ id: 'shell', name: 'Primary Surface Shell', object: this.solidMesh });
    if (this.wireMesh) anchors.push({ id: 'wire', name: 'Wireframe Topology', object: this.wireMesh });
    if (this.pointCloud) anchors.push({ id: 'pts', name: 'Vertex Point Cloud', object: this.pointCloud });
    return anchors;
  }

  public isComponentHidden(componentId: string): boolean {
    return this.isolatedComponentId !== null && this.isolatedComponentId !== componentId;
  }

  public setSelectedComponent(componentId: string | null) {
    this.selectedComponentId = componentId;
    this.applyGlowAndHighlights();
  }

  public setHighlightedComponent(componentId: string | null) {
    this.highlightedComponentId = componentId;
    this.applyGlowAndHighlights();
  }

  public setIsolatedComponent(componentId: string | null) {
    this.isolatedComponentId = componentId;
    this.applyRenderMode();
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
    if (this.importedParts.length > 0) {
      const showSolid = this.renderMode === 'SOLID_HOLO' || this.renderMode === 'HYBRID';
      const showWire = this.renderMode === 'WIREFRAME' || this.renderMode === 'HYBRID';
      const showPoints = this.renderMode === 'POINT_CLOUD' || this.renderMode === 'HYBRID';
      const showEdges = this.renderMode !== 'POINT_CLOUD';

      for (const part of this.importedParts) {
        const hidden = this.isComponentHidden(part.id);
        // Keep part.mesh.visible true so child sub-meshes nested inside GLTF hierarchy remain renderable;
        // toggle material & overlay visibilities cleanly instead.
        part.mesh.visible = true;
        part.solidMat.visible = !hidden && showSolid;
        part.wireMesh.visible = !hidden && showWire;
        part.pointCloud.visible = !hidden && showPoints;
        part.edgeLines.visible = !hidden && showEdges;
      }
      return;
    }

    if (!this.solidMesh || !this.wireMesh || !this.pointCloud || !this.edgeLines) return;

    const solidHidden = this.isComponentHidden('shell');
    const wireHidden = this.isComponentHidden('wire');
    const ptsHidden = this.isComponentHidden('pts');

    switch (this.renderMode) {
      case 'WIREFRAME':
        this.solidMesh.visible = false;
        this.wireMesh.visible = !wireHidden;
        this.pointCloud.visible = false;
        this.edgeLines.visible = !wireHidden && !solidHidden;
        break;
      case 'POINT_CLOUD':
        this.solidMesh.visible = false;
        this.wireMesh.visible = false;
        this.pointCloud.visible = !ptsHidden;
        this.edgeLines.visible = false;
        break;
      case 'SOLID_HOLO':
        this.solidMesh.visible = !solidHidden;
        this.wireMesh.visible = false;
        this.pointCloud.visible = false;
        this.edgeLines.visible = !solidHidden;
        break;
      case 'HYBRID':
      default:
        this.solidMesh.visible = !solidHidden;
        this.wireMesh.visible = !wireHidden;
        this.pointCloud.visible = !ptsHidden;
        this.edgeLines.visible = this.isolatedComponentId === null || !solidHidden;
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

  public getExplosionAmount(): number {
    return this.explosionAmount;
  }

  public setPulseEnabled(enabled: boolean) {
    this.pulseEnabled = enabled;
  }

  public setGlowIntensity(intensity: number) {
    this.glowIntensity = Math.max(0.3, Math.min(3.0, intensity));
    this.applyGlowAndHighlights();
  }

  public setColorTheme(hex: number) {
    this.colorThemeHex = hex;
    this.applyGlowAndHighlights();
  }

  private applyGlowAndHighlights() {
    const highlightHex = 0xffffff;
    const selectHex = 0xffbb33;

    if (this.importedParts.length > 0) {
      for (const part of this.importedParts) {
        const isHighlighted = this.highlightedComponentId === part.id;
        const isSelected = this.selectedComponentId === part.id;
        const activeColor = isHighlighted
          ? highlightHex
          : isSelected
          ? selectHex
          : this.colorThemeHex;
        const boost = isHighlighted ? 1.85 : isSelected ? 1.45 : 1.0;

        part.solidMat.color.setHex(activeColor);
        part.solidMat.emissive.setHex(activeColor);
        part.solidMat.emissiveIntensity = 0.42 * this.glowIntensity * boost;
        part.solidMat.opacity = Math.min(0.65, 0.16 * this.glowIntensity * boost);

        const wireMat = part.wireMesh.material as THREE.MeshBasicMaterial;
        wireMat.color.setHex(activeColor);
        wireMat.opacity = Math.min(0.95, 0.34 * this.glowIntensity * boost);

        const ptMat = part.pointCloud.material as THREE.PointsMaterial;
        ptMat.size = 0.032 + this.glowIntensity * 0.012;
        ptMat.color.setHex(isSelected || isHighlighted ? activeColor : 0xffffff);

        const edgeMat = part.edgeLines.material as THREE.LineBasicMaterial;
        edgeMat.color.setHex(activeColor);
        edgeMat.opacity = Math.min(0.98, 0.48 * this.glowIntensity * boost);
      }
      return;
    }

    if (this.solidMesh) {
      const active =
        this.highlightedComponentId === 'shell'
          ? highlightHex
          : this.selectedComponentId === 'shell'
          ? selectHex
          : this.colorThemeHex;
      const boost = this.highlightedComponentId === 'shell' || this.selectedComponentId === 'shell' ? 1.6 : 1.0;
      const solidMat = this.solidMesh.material as THREE.MeshStandardMaterial;
      solidMat.color.setHex(active);
      solidMat.emissive.setHex(active);
      solidMat.emissiveIntensity = 0.4 * this.glowIntensity * boost;
      solidMat.opacity = Math.min(0.55, 0.16 * this.glowIntensity * boost);
    }
    if (this.wireMesh) {
      const active =
        this.highlightedComponentId === 'wire'
          ? highlightHex
          : this.selectedComponentId === 'wire'
          ? selectHex
          : this.colorThemeHex;
      const wireMat = this.wireMesh.material as THREE.MeshBasicMaterial;
      wireMat.color.setHex(active);
      wireMat.opacity = Math.min(0.95, 0.35 * this.glowIntensity);
    }
    if (this.pointCloud) {
      const ptMat = this.pointCloud.material as THREE.PointsMaterial;
      ptMat.size = 0.035 + this.glowIntensity * 0.015;
      ptMat.color.setHex(
        this.highlightedComponentId === 'pts'
          ? highlightHex
          : this.selectedComponentId === 'pts'
          ? selectHex
          : 0xffffff
      );
    }
    if (this.edgeLines) {
      (this.edgeLines.material as THREE.LineBasicMaterial).color.setHex(this.colorThemeHex);
    }
  }

  public cloneSourceGroup(): THREE.BufferGeometry | THREE.Group {
    if (this.importedGroup) {
      // Deep-clone object tree preserving hierarchy while stripping transient holo overlays and cloning geometries
      const cloneRecursive = (src: THREE.Object3D): THREE.Object3D | null => {
        if (src.userData?.isHoloOverlay) return null;

        let cloned: THREE.Object3D;
        if (src instanceof THREE.Mesh) {
          const geo = src.geometry.clone();
          const mat = new THREE.MeshStandardMaterial({
            color: this.colorThemeHex,
            emissive: this.colorThemeHex,
            emissiveIntensity: 0.45,
            transparent: true,
            opacity: 0.28,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          cloned = new THREE.Mesh(geo, mat);
        } else {
          cloned = new THREE.Group();
        }

        cloned.name = src.name;
        const basePos = src.userData?.basePosition;
        if (basePos instanceof THREE.Vector3) {
          cloned.position.copy(basePos);
        } else {
          cloned.position.copy(src.position);
        }
        cloned.quaternion.copy(src.quaternion);
        const baseScale = src.userData?.baseScale;
        if (baseScale instanceof THREE.Vector3) {
          cloned.scale.copy(baseScale);
        } else {
          cloned.scale.copy(src.scale);
        }

        cloned.userData = {
          componentId: src.userData?.componentId,
          componentLabel: src.userData?.componentLabel,
          basePosition: basePos instanceof THREE.Vector3 ? basePos.clone() : undefined,
          baseScale: baseScale instanceof THREE.Vector3 ? baseScale.clone() : undefined,
          explosionVector:
            src.userData?.explosionVector instanceof THREE.Vector3
              ? src.userData.explosionVector.clone()
              : undefined
        };

        for (const child of src.children) {
          const clonedChild = cloneRecursive(child);
          if (clonedChild) {
            cloned.add(clonedChild);
          }
        }
        return cloned;
      };

      const res = cloneRecursive(this.importedGroup);
      return res instanceof THREE.Group ? res : new THREE.Group();
    }

    if (this.solidMesh) {
      return this.solidMesh.geometry.clone();
    }
    throw new Error('No source geometry available to clone.');
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const targetExp = this.exploded ? Math.max(0.05, this.explosionAmount) : this.explosionAmount;
    this.currentExplosion += (targetExp - this.currentExplosion) * 0.12;

    if (this.importedParts.length > 0) {
      const pulse = this.pulseEnabled ? 1 + Math.sin(time * 3.5) * 0.025 : 1;
      for (const part of this.importedParts) {
        part.mesh.position.set(
          part.basePosition.x + part.explosionVector.x * this.currentExplosion,
          part.basePosition.y + part.explosionVector.y * this.currentExplosion,
          part.basePosition.z + part.explosionVector.z * this.currentExplosion
        );
        part.mesh.scale.copy(part.baseScale).multiplyScalar(pulse);
      }
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

  public dispose() {
    this.importedParts = [];
    disposeObject3DResources(this.group);
    this.group.clear();
  }
}
