import * as THREE from 'three';

export class HolographicGlobeObject {
  public group: THREE.Group;
  private globeWire: THREE.Mesh;
  private orbitRings: THREE.Group;
  private satellites: THREE.Group;
  private radarSweep: THREE.Line;
  private exploded: boolean = false;
  private explosionFactor: number = 0;

  constructor(colorThemeHex: number = 0x00f0ff) {
    this.group = new THREE.Group();

    const globeMat = new THREE.MeshStandardMaterial({
      color: colorThemeHex,
      emissive: colorThemeHex,
      emissiveIntensity: 0.8,
      wireframe: true,
      transparent: true,
      opacity: 0.65
    });

    // Planetary Sphere
    const globeGeo = new THREE.SphereGeometry(1.6, 32, 24);
    this.globeWire = new THREE.Mesh(globeGeo, globeMat);
    this.group.add(this.globeWire);

    // Orbital defense tracking rings
    this.orbitRings = new THREE.Group();
    const ringRadii = [2.1, 2.5, 2.9];
    ringRadii.forEach((r, idx) => {
      const ringGeo = new THREE.TorusGeometry(r, 0.02, 8, 80);
      const ringMat = new THREE.MeshBasicMaterial({
        color: colorThemeHex,
        transparent: true,
        opacity: 0.6 - idx * 0.15
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2 + (idx * Math.PI) / 6;
      ring.rotation.y = (idx * Math.PI) / 4;
      this.orbitRings.add(ring);
    });
    this.group.add(this.orbitRings);

    // Orbiting Satellites
    this.satellites = new THREE.Group();
    const satGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const satMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true
    });
    for (let s = 0; s < 6; s++) {
      const sat = new THREE.Mesh(satGeo, satMat);
      this.satellites.add(sat);
    }
    this.group.add(this.satellites);

    // Radar scan beam
    const radarPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(2.5, 0, 0)];
    const radarGeo = new THREE.BufferGeometry().setFromPoints(radarPts);
    const radarMat = new THREE.LineBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.9
    });
    this.radarSweep = new THREE.Line(radarGeo, radarMat);
    this.group.add(this.radarSweep);
  }

  public setExplodedView(exploded: boolean) {
    this.exploded = exploded;
  }

  public setColorTheme(hex: number) {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.setHex(hex);
          child.material.emissive.setHex(hex);
        } else if (child.material instanceof THREE.MeshBasicMaterial && child.parent !== this.satellites) {
          child.material.color.setHex(hex);
        }
      }
    });
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    const targetExp = this.exploded ? 1.0 : 0.0;
    this.explosionFactor += (targetExp - this.explosionFactor) * 0.08;

    this.globeWire.rotation.y += 0.006 * speedMultiplier;
    this.orbitRings.rotation.z += 0.01 * speedMultiplier;
    this.orbitRings.rotation.y -= 0.005 * speedMultiplier;
    this.radarSweep.rotation.y += 0.04 * speedMultiplier;

    // Orbit satellite positions
    this.satellites.children.forEach((sat, i) => {
      const angle = time * (0.8 + i * 0.2) + (i * Math.PI) / 3;
      const radius = 2.1 + (i % 3) * 0.4;
      sat.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle * 0.7) * 0.8,
        Math.sin(angle) * radius
      );
    });

    const expScale = 1.0 + this.explosionFactor * 0.5;
    this.orbitRings.scale.set(expScale, expScale, expScale);
  }
}
