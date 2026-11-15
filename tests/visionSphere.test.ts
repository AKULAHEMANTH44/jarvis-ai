import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ReversibleParticleEngine } from '../src/three/effects/ReversibleParticleEngine';
import { VisionSphereObject } from '../src/three/objects/VisionSphere';

describe('ReversibleParticleEngine & VISION 1.2 Sphere', () => {
  it('transitions deterministically across all 5 formation stages and preserves exact origin coordinates', () => {
    const seeds = Array.from({ length: 300 }, (_, i) => ({
      origin: new THREE.Vector3(Math.cos(i) * 1.3, Math.sin(i) * 1.3, ((i % 7) - 3) * 0.15)
    }));

    const engine = new ReversibleParticleEngine(seeds, 0x00f0ff, 1000);
    expect(engine.getActiveCount()).toBe(300);

    // Stage 1: NORMAL
    engine.update(0.1, 0.016);
    expect(engine.getState()).toBe('NORMAL');

    // Stage 2: EXPANDING
    engine.setTargetDispersion(0.5);
    engine.update(0.2, 0.05);
    expect(engine.getState()).toBe('EXPANDING');
    expect(engine.getDispersion()).toBeGreaterThan(0.05);

    // Stage 3: DISPERSED
    engine.setTargetDispersion(1.0);
    for (let i = 0; i < 40; i++) engine.update(0.3 + i * 0.05, 0.05);
    expect(engine.getState()).toBe('DISPERSED');
    expect(engine.getDispersion()).toBeGreaterThanOrEqual(0.95);

    // Stage 4: RECONSTRUCTING
    engine.setTargetDispersion(0.0);
    engine.update(2.4, 0.05);
    expect(engine.getState()).toBe('RECONSTRUCTING');

    // Stage 5: RECONSTRUCTED as particles converge <= 0.02, then NORMAL at exact rest
    const seenStates = new Set<string>();
    for (let i = 0; i < 60; i++) {
      engine.update(2.5 + i * 0.05, 0.05);
      seenStates.add(engine.getState());
    }
    expect(seenStates.has('RECONSTRUCTED')).toBe(true);
    expect(engine.getState()).toBe('NORMAL');
    expect(engine.getDispersion()).toBeCloseTo(0, 3);

    // Verify exact original coordinate preservation on reverse to dispersion = 0
    const origin = engine.getOriginalPosition(42);
    const reconstructedPos = engine.computeParticlePositionAt(42, 0);
    expect(reconstructedPos.x).toBeCloseTo(origin.x, 5);
    expect(reconstructedPos.y).toBeCloseTo(origin.y, 5);
    expect(reconstructedPos.z).toBeCloseTo(origin.z, 5);

    // Verify adaptive active particle count scaling
    engine.setActiveCount(240);
    expect(engine.getActiveCount()).toBe(240);

    engine.dispose();
  });

  it('maintains single-parent layer hierarchy coherence, component anchors, and reversible dispersion on VisionSphereObject', () => {
    const sphere = new VisionSphereObject(0x00f0ff, 1200);

    // All visual layers + particle engine must share the single parent group so spatial rotation stays aligned
    expect(sphere.group.children.length).toBeGreaterThanOrEqual(8);
    expect(sphere.getComponentAnchors().length).toBe(6);

    // Disperse and verify progressive dissolution + full return to zero
    sphere.setDispersion(1.0);
    for (let i = 0; i < 40; i++) sphere.update(i * 0.05, 1.0, 0.05);
    expect(sphere.getDispersion()).toBeGreaterThanOrEqual(0.95);
    expect(sphere.getDispersionState()).toBe('DISPERSED');

    sphere.setDispersion(0.0);
    for (let i = 0; i < 60; i++) sphere.update(2 + i * 0.05, 1.0, 0.05);
    expect(sphere.getDispersion()).toBeCloseTo(0, 3);
    expect(['RECONSTRUCTED', 'NORMAL']).toContain(sphere.getDispersionState());

    // Parameter tuning & theme updates
    sphere.setParameters({
      rotationSpeed: 1.5,
      orbitalSpeed: 1.8,
      coreBrightness: 1.6,
      scanSpeed: 1.4,
      particleIntensity: 1.5,
      reducedEffects: true
    });
    expect(sphere.getParticleEngine().getActiveCount()).toBeLessThanOrEqual(1200);

    sphere.setColorTheme(0xff8800);
    sphere.dispose();
  });
});
