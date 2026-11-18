import { describe, it, expect, beforeEach } from 'vitest';
import { customGestureService, extractHandFeatures, computeCentroid } from '../src/services/customGestureService';
import { HolographicHandMesh } from '../src/three/HolographicHandMesh';
import { gestureEngine } from '../src/services/gestureEngine';
import { Landmark3D } from '../src/types/gesture';

function createMockLandmarks(): Landmark3D[] {
  const pts: Landmark3D[] = [];
  for (let i = 0; i < 21; i++) {
    pts.push({ x: 0.5 + i * 0.01, y: 0.5 + i * 0.01, z: 0.1 });
  }
  return pts;
}

describe('Batch 3 — Advanced Gesture Intelligence & Holographic Hand', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('1. Extracts hand features and computes centroids correctly', () => {
    const landmarks = createMockLandmarks();
    const features = extractHandFeatures(landmarks);
    expect(features).toBeDefined();
    expect(features.length).toBeGreaterThan(0);

    const centroid = computeCentroid([
      { landmarks, features },
      { landmarks, features }
    ]);
    expect(centroid).toBeDefined();
    expect(centroid.length).toEqual(features.length);
  });

  it('2. Creates, updates, trains, and matches custom gesture profiles', () => {
    const profile = customGestureService.createProfile({
      name: 'Stark Snap',
      description: 'Quick snap gesture for diagnostics',
      actionId: 'SYSTEM_DIAGNOSTICS',
      tolerance: 0.06,
      enabled: true
    });

    expect(profile).toBeDefined();
    expect(profile.name).toEqual('Stark Snap');

    const landmarks = createMockLandmarks();
    const added = customGestureService.addSampleToProfile(profile.id, landmarks);
    expect(added).toBe(true);

    const updatedProfiles = customGestureService.getProfiles();
    const found = updatedProfiles.find((p) => p.id === profile.id);
    expect(found?.samples.length).toEqual(1);

    // Test matching
    const match = customGestureService.matchCustomGesture(landmarks);
    expect(match).toBeDefined();
    expect(match?.profile.id).toEqual(profile.id);
  });

  it('3. Initializes and updates HolographicHandMesh without throwing', () => {
    const handMesh = new HolographicHandMesh(0x00f0ff);
    expect(handMesh.group).toBeDefined();

    const landmarks = createMockLandmarks();
    expect(() => handMesh.updateLandmarks(landmarks)).not.toThrow();
    expect(() => handMesh.updateLandmarks([])).not.toThrow();
    expect(() => handMesh.setColorTheme(0xff8800)).not.toThrow();
    expect(() => handMesh.dispose()).not.toThrow();
  });

  it('4. GestureEngine processes results including custom gesture detection', () => {
    const landmarks = createMockLandmarks();
    const profile = customGestureService.createProfile({
      name: 'Test Gesture',
      description: 'Test description',
      actionId: 'NEXT_MODEL',
      tolerance: 0.08,
      enabled: true
    });
    customGestureService.addSampleToProfile(profile.id, landmarks);

    const rawResult = {
      landmarks: [landmarks],
      handednesses: [[{ index: 0, score: 0.95, categoryName: 'Right', displayName: 'Right' }]]
    };

    const detection = gestureEngine.processResults(rawResult as any);
    expect(detection).toBeDefined();
    expect(detection.hands.length).toEqual(1);
  });
});
