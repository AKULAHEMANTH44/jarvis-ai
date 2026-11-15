import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  parseOBJ,
  parseSTL,
  buildDepthReliefGeometry,
  buildMultiViewSilhouetteGeometry,
  buildPresetGeometry,
  ReconstructedHologramObject
} from '../src/three/objects/ReconstructedHologram';
import { RealWorldModelId } from '../src/three/objects/RealWorldCatalog';
import { SpatialObjectManager } from '../src/three/SpatialObjectManager';
import { ContextualAIService } from '../src/services/contextualAI';

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
});
