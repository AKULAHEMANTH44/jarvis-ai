import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('Hologram Mathematics & Bounds', () => {
  it('constrains 3D delta translation within safe viewport boundaries', () => {
    const targetPos = new THREE.Vector3(0, 0, 0);

    const applyTranslation = (dx: number, dy: number, dz: number) => {
      targetPos.x += dx;
      targetPos.y += dy;
      targetPos.z += dz;
      targetPos.x = Math.max(-3.5, Math.min(3.5, targetPos.x));
      targetPos.y = Math.max(-2.5, Math.min(2.5, targetPos.y));
      targetPos.z = Math.max(-2.0, Math.min(2.0, targetPos.z));
    };

    applyTranslation(10, 10, 10);
    expect(targetPos.x).toBe(3.5);
    expect(targetPos.y).toBe(2.5);
    expect(targetPos.z).toBe(2.0);

    applyTranslation(-20, -20, -20);
    expect(targetPos.x).toBe(-3.5);
    expect(targetPos.y).toBe(-2.5);
    expect(targetPos.z).toBe(-2.0);
  });

  it('clamps scale factor between safe min and max limits', () => {
    let scale = 1.0;
    const applyScale = (multiplier: number) => {
      scale *= multiplier;
      scale = Math.max(0.4, Math.min(2.8, scale));
    };

    applyScale(5.0);
    expect(scale).toBe(2.8);

    applyScale(0.01);
    expect(scale).toBe(0.4);
  });

  it('interpolates lerp smoothly toward target vector', () => {
    const current = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(1, 2, 3);
    const lerpFactor = 0.12;

    current.lerp(target, lerpFactor);
    expect(current.x).toBeCloseTo(0.12, 3);
    expect(current.y).toBeCloseTo(0.24, 3);
    expect(current.z).toBeCloseTo(0.36, 3);
  });
});
