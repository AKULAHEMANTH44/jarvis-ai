import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  parseOBJ,
  parseOBJAsGroup,
  parseSTL,
  parseGLTFOrGLB,
  buildDepthReliefGeometry,
  buildMultiViewSilhouetteGeometry,
  buildPresetGeometry,
  ReconstructedHologramObject
} from '../src/three/objects/ReconstructedHologram';
import { RealWorldModelId } from '../src/three/objects/RealWorldCatalog';
import { SpatialObjectManager } from '../src/three/SpatialObjectManager';
import { ContextualAIService } from '../src/services/contextualAI';
import { SpatialHistoryManager } from '../src/utils/spatialHistory';

describe('Holographic Reconstruction & Manipulation Lab', () => {
  it('parses Wavefront OBJ polygons and normalizes bounding size', () => {
    const sampleOBJ = `
      # Simple pyramid
      v 0 10 0
      v -10 -10 10
      v 10 -10 10
      v 0 -10 -10
      f 1 2 3
      f 1 3 4
      f 1 4 2
      f 2 4 3
    `;
    const geo = parseOBJ(sampleOBJ);
    const pos = geo.getAttribute('position');
    expect(pos.count).toBe(12); // 4 triangles * 3 vertices

    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(2.6, 2);
  });

  it('parses ASCII STL triangles cleanly', () => {
    const sampleSTL = `solid test
      facet normal 0 0 1
        outer loop
          vertex 0 0 0
          vertex 4 0 0
          vertex 0 4 0
        endloop
      endfacet
    endsolid test`;
    const buf = new TextEncoder().encode(sampleSTL).buffer;
    const geo = parseSTL(buf);
    expect(geo.getAttribute('position').count).toBe(3);
  });

  it('reconstructs a 3D depth-relief mesh from pixel luminance data', () => {
    const w = 16;
    const h = 12;
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      pixels[i * 4] = 200;
      pixels[i * 4 + 1] = 200;
      pixels[i * 4 + 2] = 200;
      pixels[i * 4 + 3] = 255;
    }

    const geo = buildDepthReliefGeometry(pixels, w, h, 8, 6);
    expect(geo.getAttribute('position').count).toBe(48);
    expect(geo.getIndex()!.count).toBe((8 - 1) * (6 - 1) * 6);
  });

  it('discloses technical honesty for single-image 2.5D relief vs multi-view silhouette hull', () => {
    const makeSample = (val: number) => {
      const data = new Uint8ClampedArray(8 * 8 * 4);
      for (let i = 0; i < 64; i++) {
        data[i * 4] = val;
        data[i * 4 + 1] = val;
        data[i * 4 + 2] = val;
        data[i * 4 + 3] = 255;
      }
      return { data, width: 8, height: 8 };
    };

    const single = buildMultiViewSilhouetteGeometry([makeSample(180)]);
    expect(single.methodLabel).toContain('ILLUSTRATIVE 2.5D DEPTH RELIEF');
    expect(single.geometry.getAttribute('position').count).toBeGreaterThan(0);

    const multi = buildMultiViewSilhouetteGeometry([makeSample(180), makeSample(140)]);
    expect(multi.methodLabel).toContain('MULTI-VIEW SILHOUETTE HULL APPROXIMATION');
    expect(multi.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('builds procedural lab presets and switches render modes cleanly', () => {
    const { name, geometry } = buildPresetGeometry('palladium_core');
    expect(name).toContain('Palladium');
    const rec = new ReconstructedHologramObject(geometry, 0x00f0ff);
    expect(rec.vertexCount).toBeGreaterThan(0);
    expect(rec.faceCount).toBeGreaterThan(0);

    rec.setRenderMode('POINT_CLOUD');
    rec.setExplosionAmount(0.5);
    rec.update(1.0, 1.0);
  });

  it('instantiates all 9 real-world object categories with explodable labeled components', () => {
    const categories: RealWorldModelId[] = [
      'sports_car',
      'cyber_motorcycle',
      'holo_smartphone',
      'quantum_workstation',
      'jet_turbine_engine',
      'stark_skyscraper',
      'industrial_robot_arm',
      'planetary_gearbox',
      'atom_orbital_model'
    ];

    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);

    categories.forEach((cat) => {
      const inst = mgr.createInstance(cat);
      expect(inst.realWorldObj).toBeDefined();
      const anchors = inst.realWorldObj!.getComponentAnchors();
      expect(anchors.length).toBeGreaterThan(0);
      anchors.forEach((a) => expect(a.name.trim().length).toBeGreaterThan(0));

      const beforePos = anchors[1].object.position.clone();
      mgr.setExplosionAmount(1.0);
      for (let f = 0; f < 30; f++) {
        mgr.update(f * 0.016, 1.0);
      }
      expect(inst.realWorldObj!.getExplosionAmount()).toBeGreaterThan(0.9);
      const afterExplodePos = anchors[1].object.position.clone();
      expect(afterExplodePos.distanceTo(beforePos)).toBeGreaterThan(0.05);

      mgr.setExplosionAmount(0.0);
      for (let f = 0; f < 60; f++) {
        mgr.update(f * 0.016, 1.0);
      }
      expect(inst.realWorldObj!.getExplosionAmount()).toBeLessThan(0.05);
      expect(anchors[1].object.position.distanceTo(beforePos)).toBeLessThan(0.06);

      mgr.delete(inst.id);
    });
  });

  it('supports reversible particle disintegration while preserving original spatial state', () => {
    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);
    const inst = mgr.createInstance('jet_turbine_engine', new THREE.Vector3(1.2, 0.4, -0.5));
    mgr.setObjectTransform(inst.id, { scale: 1.45 });

    const disintOk = mgr.disintegrate(inst.id);
    expect(disintOk).toBe(true);
    expect(inst.isDisintegrated).toBe(true);
    expect(inst.disintegration).toBeDefined();

    for (let f = 0; f < 25; f++) {
      mgr.update(f * 0.016, 1.0);
    }
    expect(inst.currentDisintegration).toBeGreaterThan(0.5);
    expect(inst.disintegration!.points.visible).toBe(true);
    // Preserves original target position & scale
    expect(inst.targetPosition.x).toBeCloseTo(1.2, 3);
    expect(inst.targetScale).toBeCloseTo(1.45, 3);

    const reconOk = mgr.reconstruct(inst.id);
    expect(reconOk).toBe(true);
    expect(inst.isDisintegrated).toBe(false);
    expect(inst.modelGroup.visible).toBe(true);

    for (let f = 0; f < 60; f++) {
      mgr.update(f * 0.016, 1.0);
    }
    expect(inst.currentDisintegration).toBeLessThan(0.02);
    expect(inst.disintegration!.points.visible).toBe(false);
  });

  it('enforces freeze lock on transforms and triggers smooth 360-degree inspection rotation', () => {
    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);
    const inst = mgr.createInstance('sports_car');

    mgr.setObjectTransform(inst.id, { position: { x: 1.0 }, scale: 1.3 });
    expect(mgr.setFrozen(inst.id, true)).toBe(true);

    // Frozen object ignores new transforms
    mgr.setObjectTransform(inst.id, { position: { x: -2.0 }, scale: 0.7 });
    expect(inst.targetPosition.x).toBe(1.0);
    expect(inst.targetScale).toBe(1.3);

    // triggerRotate360 unfreezes unlocked object and adds 2*PI to Y target rotation
    const prevY = inst.targetRotation.y;
    expect(mgr.triggerRotate360(inst.id)).toBe(true);
    expect(inst.isFrozen).toBe(false);
    expect(inst.targetRotation.y).toBeCloseTo(prevY + Math.PI * 2, 4);
  });

  it('enforces SpatialObjectManager lock and precision transforms', () => {
    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);
    const { geometry } = buildPresetGeometry('crystal_lattice');
    const inst = mgr.createReconstructedInstance('Test Crystal', geometry, new THREE.Vector3(0, 0, 0));

    mgr.setObjectTransform(inst.id, { position: { x: 1.5, y: -0.5 }, scale: 1.8 });
    expect(inst.targetPosition.x).toBe(1.5);
    expect(inst.targetPosition.y).toBe(-0.5);
    expect(inst.targetScale).toBe(1.8);

    // Lock object -> subsequent transform calls must not mutate position/scale
    const locked = mgr.toggleLock(inst.id);
    expect(locked).toBe(true);
    mgr.setObjectTransform(inst.id, { position: { x: -3.0 }, scale: 0.5 });
    expect(inst.targetPosition.x).toBe(1.5);
    expect(inst.targetScale).toBe(1.8);
  });

  it('keeps API keys in volatile memory only and validates HTTPS endpoints', async () => {
    const ai = new ContextualAIService();
    ai.saveConfig({
      provider: 'OPENAI',
      apiKey: 'sk-test-secret-do-not-persist',
      customEndpoint: 'http://insecure.example.com/v1/chat/completions'
    });

    expect(ai.hasApiKey()).toBe(true);
    const blockedReply = await ai.queryExternalAI('hello');
    expect(blockedReply).toContain('HTTPS');

    ai.clearApiKey();
    expect(ai.hasApiKey()).toBe(false);
  });

  it('preserves Wavefront OBJ object and group hierarchy for multi-component inspection', () => {
    const multiPartOBJ = `
      o ReactorCore
      v -1 -1 -1
      v 1 -1 -1
      v 1 1 -1
      f 1 2 3
      g OuterShroud
      v 5 0 0
      v 7 0 0
      v 6 2 0
      f 4 5 6
    `;
    const parsed = parseOBJAsGroup(multiPartOBJ);
    expect(parsed.componentCount).toBe(2);
    expect(parsed.vertexCount).toBe(6);
    expect(parsed.faceCount).toBe(2);

    const names = parsed.group.children.map((c) => c.name);
    expect(names).toEqual(['ReactorCore', 'OuterShroud']);

    const holo = new ReconstructedHologramObject(parsed.group, 0x00f0ff);
    expect(holo.componentCount).toBe(2);
    expect(holo.getComponentAnchors().map((a) => a.name)).toEqual(['ReactorCore', 'OuterShroud']);

    holo.setExplosionAmount(1.0);
    for (let i = 0; i < 40; i++) holo.update(i * 0.016, 1.0);
    const anchors = holo.getComponentAnchors();
    const base = anchors[1].object.userData.basePosition as THREE.Vector3;
    expect(anchors[1].object.position.distanceTo(base)).toBeGreaterThan(0.3);
    holo.dispose();
  });

  it('rejects empty, degenerate, and missing-external-URI models safely', async () => {
    expect(() => parseOBJ('')).toThrow();
    expect(() => parseOBJAsGroup('# comments only\nv 0 0 0\nv 0 0 0\nv 0 0 0\nf 1 2 3')).toThrow();
    expect(() => parseSTL(new ArrayBuffer(12))).toThrow();

    const emptyGltf = JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 });
    await expect(
      parseGLTFOrGLB(new TextEncoder().encode(emptyGltf).buffer, 'empty.gltf')
    ).rejects.toThrow();

    const externalBinGltf = JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'missing_geometry.bin', byteLength: 36 }]
    });
    await expect(
      parseGLTFOrGLB(new TextEncoder().encode(externalBinGltf).buffer, 'assembly.gltf')
    ).rejects.toThrow(/missing_geometry\.bin/);

    expect(() => new ReconstructedHologramObject(new THREE.BufferGeometry())).toThrow();
  });

  it('parses multi-mesh GLB with nested transforms, computes radial explosion vectors, supports all 4 render modes, and pulses safely', async () => {
    // 2 triangles inside a scaled parent hierarchy (scale=0.01) packed as standard binary .glb
    const verts = new Float32Array([
      -100, -100, 0,  0, -100, 0,  -50, 0, 0,
       100,  100, 0,  200, 100, 0,  150, 200, 0
    ]);
    const rawBin = new Uint8Array(verts.buffer);
    const binPadLen = Math.ceil(rawBin.byteLength / 4) * 4;

    const gltfJson = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'RootScaled', scale: [0.01, 0.01, 0.01], children: [1, 2] },
        { name: 'LeftWing', mesh: 0 },
        { name: 'RightWing', mesh: 1 }
      ],
      meshes: [
        { name: 'LeftWingMesh', primitives: [{ attributes: { POSITION: 0 } }] },
        { name: 'RightWingMesh', primitives: [{ attributes: { POSITION: 1 } }] }
      ],
      buffers: [{ byteLength: rawBin.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 }
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-100, -100, 0], max: [0, 0, 0] },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [100, 100, 0], max: [200, 200, 0] }
      ]
    };

    const jsonBytes = new TextEncoder().encode(JSON.stringify(gltfJson));
    const jsonPadLen = Math.ceil(jsonBytes.byteLength / 4) * 4;
    const totalLength = 12 + 8 + jsonPadLen + 8 + binPadLen;
    const glb = new ArrayBuffer(totalLength);
    const view = new DataView(glb);
    const u8 = new Uint8Array(glb);

    view.setUint32(0, 0x46546c67, true); // 'glTF'
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);

    view.setUint32(12, jsonPadLen, true);
    view.setUint32(16, 0x4e4f534a, true); // 'JSON'
    u8.set(jsonBytes, 20);
    for (let i = 20 + jsonBytes.byteLength; i < 20 + jsonPadLen; i++) u8[i] = 0x20;

    const binHeaderOffset = 20 + jsonPadLen;
    view.setUint32(binHeaderOffset, binPadLen, true);
    view.setUint32(binHeaderOffset + 4, 0x004e4942, true); // 'BIN\0'
    u8.set(rawBin, binHeaderOffset + 8);

    const parsed = await parseGLTFOrGLB(glb, 'winged_craft.glb');
    expect(parsed.componentCount).toBe(2);
    expect(parsed.vertexCount).toBe(6);

    const holo = new ReconstructedHologramObject(parsed.group, 0x00f0ff);
    const anchors = holo.getComponentAnchors();
    expect(anchors.length).toBe(2);

    // Check all 4 render modes update per-part overlays cleanly without throwing
    holo.setRenderMode('SOLID_HOLO');
    holo.setRenderMode('WIREFRAME');
    holo.setRenderMode('POINT_CLOUD');
    holo.setRenderMode('HYBRID');

    // Explode & pulse: both wing world positions must separate symmetrically
    anchors[0].object.updateMatrixWorld(true);
    const leftBefore = new THREE.Vector3();
    anchors[0].object.getWorldPosition(leftBefore);

    holo.setExplosionAmount(1.0);
    holo.setPulseEnabled(true);
    for (let i = 0; i < 40; i++) holo.update(i * 0.05, 1.0);

    holo.group.updateMatrixWorld(true);
    const leftAfter = new THREE.Vector3();
    anchors[0].object.getWorldPosition(leftAfter);
    expect(leftAfter.distanceTo(leftBefore)).toBeGreaterThan(0.4);

    // Original unit scale stays bounded around 1 (not distorted by pulse)
    holo.setPulseEnabled(false);
    holo.update(1.0, 1.0);
    expect(anchors[0].object.scale.x).toBeCloseTo(1, 3);

    holo.dispose();
  });

  it('isolates disintegration per-instance, samples high-poly meshes up to budget, duplicates multi-mesh objects, and supports component isolation', () => {
    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);

    // Multi-part OBJ object A
    const objGroup = parseOBJAsGroup(`
      o Hub
      v -1 -1 -1
      v 1 -1 -1
      v 0 1 -1
      f 1 2 3
      o Wing
      v 2 0 0
      v 4 0 0
      v 3 2 0
      f 4 5 6
    `).group;
    const instA = mgr.createReconstructedInstance('Drone Assembly', objGroup);

    // High-poly sphere object B (65x65 segments -> >4300 vertices)
    const highPolyGeo = new THREE.SphereGeometry(1.1, 65, 65);
    const instB = mgr.createReconstructedInstance('HighPoly Sphere', highPolyGeo, new THREE.Vector3(3, 0, 0));

    // Disintegrate ONLY instB -> instA must remain completely un-dispersed
    expect(mgr.disintegrate(instB.id)).toBe(true);
    for (let f = 0; f < 30; f++) mgr.update(f * 0.016, 1.0);

    expect(instB.isDisintegrated).toBe(true);
    expect(instB.disintegration!.count).toBeGreaterThan(1800);
    expect(instB.disintegration!.count).toBeLessThanOrEqual(3200);
    expect(instA.isDisintegrated).toBe(false);
    expect(instA.currentDisintegration).toBe(0);

    // Multi-mesh duplication preserves all components
    const clonedA = mgr.duplicate(instA.id);
    expect(clonedA).not.toBeNull();
    expect(clonedA!.componentCount).toBe(2);
    expect(mgr.getComponents(clonedA!.id).map((c) => c.name)).toEqual(['Hub', 'Wing']);

    // Component selection & isolation
    const comps = mgr.getComponents(instA.id);
    expect(mgr.selectComponent(instA.id, comps[1].id)).toBe(true);
    expect(mgr.isolateComponent(instA.id, comps[1].id)).toBe(true);
    expect(instA.reconstructedObj!.isComponentHidden(comps[0].id)).toBe(true);
    expect(instA.reconstructedObj!.isComponentHidden(comps[1].id)).toBe(false);

    expect(mgr.clearComponentIsolation(instA.id)).toBe(true);
    expect(instA.reconstructedObj!.isComponentHidden(comps[0].id)).toBe(false);

    mgr.clearAll();
  });

  it('supports Undo/Redo history with coalescing and full SpatialObjectManager snapshot restoration', () => {
    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);
    const parsed = parseOBJAsGroup(`
      o Core
      v -1 -1 0
      v 1 -1 0
      v 0 1 0
      f 1 2 3
      o Shell
      v 2 0 0
      v 4 0 0
      v 3 2 0
      f 4 5 6
    `);
    const inst = mgr.createReconstructedInstance('Test MultiMesh', parsed.group);
    const history = new SpatialHistoryManager<{ snap: ReturnType<SpatialObjectManager['captureWorkspaceSnapshot']> }>(20, 500);

    const s0 = { snap: mgr.captureWorkspaceSnapshot() };

    // Coalesced continuous transform burst (same mergeKey within window -> 1 undo step)
    mgr.setObjectTransform(inst.id, { position: { x: 0.8 }, scale: 1.25 });
    const s1 = { snap: mgr.captureWorkspaceSnapshot() };
    expect(history.record(s0, s1, 'Translate', 'drag-1', 1000)).toBe(true);

    mgr.setObjectTransform(inst.id, { position: { x: 1.9, y: -0.6 }, scale: 1.6 });
    const s2 = { snap: mgr.captureWorkspaceSnapshot() };
    expect(history.record(s1, s2, 'Translate', 'drag-1', 1200)).toBe(true);
    expect(history.getUndoCount()).toBe(1);

    // Distinct operation: explode + isolate component + disintegrate
    mgr.setExplosionAmount(0.85, inst.id);
    expect(mgr.isolateComponent(inst.id, 'part-2')).toBe(true);
    expect(inst.reconstructedObj!.isComponentHidden('part-1')).toBe(true);
    mgr.disintegrate(inst.id);
    const s3 = { snap: mgr.captureWorkspaceSnapshot() };
    expect(history.record(s2, s3, 'Disintegrate & Isolate', undefined, 2000)).toBe(true);
    expect(history.getUndoCount()).toBe(2);

    // Undo step 2 -> returns to s2 (exploded=0, not disintegrated, no isolation)
    const u1 = history.undo();
    expect(u1).not.toBeNull();
    mgr.restoreWorkspaceSnapshot(u1!.state.snap);
    expect(inst.isDisintegrated).toBe(false);
    expect(inst.modelGroup.visible).toBe(true);
    expect(inst.isolatedComponentId).toBeNull();
    expect(inst.reconstructedObj!.isComponentHidden('part-1')).toBe(false);
    expect(inst.targetPosition.x).toBeCloseTo(1.9, 3);

    // Undo step 1 -> returns all the way back to initial s0
    const u2 = history.undo();
    expect(u2).not.toBeNull();
    mgr.restoreWorkspaceSnapshot(u2!.state.snap);
    expect(inst.targetPosition.x).toBeCloseTo(0, 3);
    expect(inst.targetScale).toBeCloseTo(1.0, 3);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    // Redo back to s3
    const r1 = history.redo();
    const r2 = history.redo();
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    mgr.restoreWorkspaceSnapshot(r2!.state.snap);
    expect(inst.isDisintegrated).toBe(true);
    expect(inst.isolatedComponentId).toBe('part-2');
    expect(inst.reconstructedObj!.isComponentHidden('part-1')).toBe(true);
    expect(inst.explosionAmount).toBeCloseTo(0.85, 3);
    expect(history.canRedo()).toBe(false);

    mgr.clearAll();
  });

  it('highlights components cleanly and restores exact visibility and materials across render modes and theme swaps', () => {
    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);

    // 1. Reconstructed multi-part specimen
    const parsed = parseOBJAsGroup(`
      o RingA
      v -2 0 0
      v -1 0 0
      v -1.5 1 0
      f 1 2 3
      o RingB
      v 1 0 0
      v 2 0 0
      v 1.5 1 0
      f 4 5 6
    `);
    const multiInst = mgr.createReconstructedInstance('Two Rings', parsed.group);
    const comps = mgr.getComponents(multiInst.id);
    expect(comps.length).toBe(2);

    const meshA = multiInst.modelGroup.getObjectByName('RingA') as THREE.Mesh;
    const meshB = multiInst.modelGroup.getObjectByName('RingB') as THREE.Mesh;
    const matA = meshA.material as THREE.MeshStandardMaterial;
    const matB = meshB.material as THREE.MeshStandardMaterial;

    // Highlight RingB -> white highlight hex; clear highlight -> restores cyan theme hex
    expect(mgr.highlightComponent(multiInst.id, comps[1].id)).toBe(true);
    expect(matB.color.getHex()).toBe(0xffffff);
    expect(matA.color.getHex()).toBe(0x00f0ff);

    expect(mgr.highlightComponent(multiInst.id, null)).toBe(true);
    expect(matB.color.getHex()).toBe(0x00f0ff);

    // Isolate RingA -> switch render mode -> clear isolation -> RingB visibility must be restored under new renderMode
    expect(mgr.isolateComponent(multiInst.id, comps[0].id)).toBe(true);
    expect(matB.visible).toBe(false);
    expect(matA.visible).toBe(true);

    mgr.setGlobalRenderMode('SOLID_HOLO');
    expect(matB.visible).toBe(false);
    expect(matA.visible).toBe(true);

    expect(mgr.clearComponentIsolation(multiInst.id)).toBe(true);
    expect(matB.visible).toBe(true);
    expect(matA.visible).toBe(true);

    // 2. RealWorld procedurally built model: highlight & theme swap restoration
    const jet = mgr.createInstance('jet_turbine_engine');
    const jetComps = mgr.getComponents(jet.id);
    expect(jetComps.length).toBeGreaterThan(1);
    expect(mgr.highlightComponent(jet.id, jetComps[0].id)).toBe(true);
    mgr.setColorTheme(0xff8800);
    expect(mgr.highlightComponent(jet.id, null)).toBe(true);
    expect(mgr.isolateComponent(jet.id, jetComps[0].id)).toBe(true);
    expect(mgr.clearComponentIsolation(jet.id)).toBe(true);
    const jetAnchors = jet.realWorldObj!.getComponentAnchors();
    expect(jetAnchors.every((a) => a.object.visible)).toBe(true);

    mgr.clearAll();
  });

  it('disposes imported model geometries, materials, textures, and disintegration clouds on deletion', () => {
    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);

    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const texDisposeSpy = vi.spyOn(tex, 'dispose');
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const geoDisposeSpy = vi.spyOn(geo, 'dispose');
    const origMat = new THREE.MeshStandardMaterial({ map: tex });
    const matDisposeSpy = vi.spyOn(origMat, 'dispose');

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geo, origMat);
    mesh.name = 'PayloadBlock';
    group.add(mesh);

    const inst = mgr.createReconstructedInstance('Asset Cleanup Test', group);
    // Original imported PBR material & texture are disposed immediately during hologram conversion
    expect(matDisposeSpy).toHaveBeenCalledTimes(1);
    expect(texDisposeSpy).toHaveBeenCalledTimes(1);

    mgr.disintegrate(inst.id);
    const disintGeoSpy = vi.spyOn(inst.disintegration!.points.geometry, 'dispose');
    const disintMatSpy = vi.spyOn(inst.disintegration!.points.material as THREE.Material, 'dispose');

    expect(mgr.delete(inst.id)).toBe(true);
    expect(geoDisposeSpy).toHaveBeenCalledTimes(1);
    expect(disintGeoSpy).toHaveBeenCalledTimes(1);
    expect(disintMatSpy).toHaveBeenCalledTimes(1);
    expect(mgr.getAll().length).toBe(0);
  });

  it('leaves unrelated scene objects untouched during dispersion, disintegration, and reconstruction', () => {
    const root = new THREE.Group();
    const mgr = new SpatialObjectManager(root, 0x00f0ff);

    const instA = mgr.createInstance('arc_reactor', new THREE.Vector3(-2.0, 0.5, 0));
    mgr.setObjectTransform(instA.id, { rotation: { y: 0.5 }, scale: 1.1 });

    const instB = mgr.createInstance('quantum_tesseract', new THREE.Vector3(2.2, -0.4, 0.3));
    mgr.setObjectTransform(instB.id, { rotation: { x: 0.35, y: 1.2 }, scale: 1.5 });
    mgr.setExplosionAmount(0.65, instB.id);

    const instC = mgr.createInstance('sports_car', new THREE.Vector3(0, 1.4, -1.0));
    mgr.disintegrate(instC.id);

    // Disintegrate ONLY instA -> instB stays intact/exploded at 0.65, instC stays disintegrated
    expect(mgr.disintegrate(instA.id)).toBe(true);
    for (let f = 0; f < 30; f++) mgr.update(f * 0.016, 1.0);

    expect(instA.isDisintegrated).toBe(true);
    expect(instB.isDisintegrated).toBe(false);
    expect(instB.targetDisintegration).toBe(0);
    expect(instB.explosionAmount).toBeCloseTo(0.65, 3);
    expect(instB.targetPosition.x).toBeCloseTo(2.2, 3);
    expect(instB.targetScale).toBeCloseTo(1.5, 3);
    expect(instB.modelGroup.visible).toBe(true);
    expect(instC.isDisintegrated).toBe(true);

    // Reconstruct ONLY instA -> instB keeps explosion & transforms; instC stays disintegrated!
    expect(mgr.reconstruct(instA.id)).toBe(true);
    for (let f = 0; f < 40; f++) mgr.update(f * 0.016, 1.0);

    expect(instA.isDisintegrated).toBe(false);
    expect(instA.explosionAmount).toBe(0);
    expect(instB.explosionAmount).toBeCloseTo(0.65, 3);
    expect(instB.targetPosition.x).toBeCloseTo(2.2, 3);
    expect(instB.targetRotation.y).toBeCloseTo(1.2, 3);
    expect(instC.isDisintegrated).toBe(true);
    expect(instC.targetDisintegration).toBe(1.0);

    mgr.clearAll();
  });
});

