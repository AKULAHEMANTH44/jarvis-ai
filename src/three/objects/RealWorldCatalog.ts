import * as THREE from 'three';
import { HologramModelId } from '../../types/hologram';

export type RealWorldModelId = Extract<
  HologramModelId,
  | 'sports_car'
  | 'cyber_motorcycle'
  | 'holo_smartphone'
  | 'quantum_workstation'
  | 'jet_turbine_engine'
  | 'stark_skyscraper'
  | 'industrial_robot_arm'
  | 'planetary_gearbox'
  | 'atom_orbital_model'
>;

export interface ComponentAnchor {
  id: string;
  name: string;
  object: THREE.Object3D;
}

interface ExplodablePart {
  id: string;
  name: string;
  object: THREE.Object3D;
  basePos: THREE.Vector3;
  explodeDir: THREE.Vector3;
}

export class RealWorldHologramObject {
  public group: THREE.Group;
  private parts: ExplodablePart[] = [];
  private targetExplosion: number = 0;
  private currentExplosion: number = 0;
  private spinables: THREE.Object3D[] = [];
  private modelId: RealWorldModelId;

  constructor(modelId: RealWorldModelId, colorThemeHex: number = 0x00f0ff) {
    this.modelId = modelId;
    this.group = new THREE.Group();
    this.buildModel(modelId, colorThemeHex);
  }

  private makeHoloMat(
    hex: number,
    options: { wireframe?: boolean; opacity?: number; metalness?: number; roughness?: number; emissiveIntensity?: number } = {}
  ): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: options.emissiveIntensity ?? 0.65,
      wireframe: options.wireframe ?? true,
      transparent: true,
      opacity: options.opacity ?? 0.8,
      metalness: options.metalness ?? 0.8,
      roughness: options.roughness ?? 0.25,
      side: THREE.DoubleSide
    });
  }

  private registerPart(id: string, name: string, object: THREE.Object3D, explodeDir: THREE.Vector3) {
    object.userData.componentLabel = name;
    this.group.add(object);
    this.parts.push({
      id,
      name,
      object,
      basePos: object.position.clone(),
      explodeDir: explodeDir.clone()
    });
  }

  private buildModel(modelId: RealWorldModelId, hex: number) {
    const frameMat = this.makeHoloMat(hex, { wireframe: true, opacity: 0.78 });
    const coreMat = this.makeHoloMat(hex, { wireframe: false, opacity: 0.35, metalness: 0.9, roughness: 0.15 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: hex,
      emissiveIntensity: 1.0,
      wireframe: false,
      transparent: true,
      opacity: 0.65,
      metalness: 0.95,
      roughness: 0.1
    });

    switch (modelId) {
      case 'sports_car': {
        // 1. Aero Chassis Body
        const bodyShape = new THREE.Shape();
        bodyShape.moveTo(-1.55, -0.18);
        bodyShape.lineTo(1.55, -0.18);
        bodyShape.lineTo(1.62, 0.1);
        bodyShape.lineTo(0.82, 0.26);
        bodyShape.lineTo(0.25, 0.56);
        bodyShape.lineTo(-0.78, 0.54);
        bodyShape.lineTo(-1.5, 0.22);
        bodyShape.closePath();

        const chassisGeo = new THREE.ExtrudeGeometry(bodyShape, {
          depth: 1.12,
          bevelEnabled: true,
          bevelThickness: 0.06,
          bevelSize: 0.05,
          bevelSegments: 2
        });
        chassisGeo.translate(0, 0, -0.56);
        const chassis = new THREE.Mesh(chassisGeo, frameMat.clone());
        this.registerPart('chassis', 'Aero Carbon Monocoque', chassis, new THREE.Vector3(0, -0.15, 0));

        // 2. Glass Canopy
        const canopyGeo = new THREE.BoxGeometry(1.15, 0.26, 0.9);
        const canopy = new THREE.Mesh(canopyGeo, coreMat.clone());
        canopy.position.set(-0.2, 0.48, 0);
        this.registerPart('canopy', 'HUD Cockpit Canopy', canopy, new THREE.Vector3(0, 0.95, 0));

        // 3. Electric Powertrain Core
        const engineGeo = new THREE.BoxGeometry(0.75, 0.24, 0.65);
        const powertrain = new THREE.Mesh(engineGeo, accentMat.clone());
        powertrain.position.set(-0.75, 0.08, 0);
        this.registerPart('powertrain', 'Dual-Flux Drivetrain', powertrain, new THREE.Vector3(-0.7, 0.55, 0));

        // 4. Front Axle & Wheels
        const frontAxle = new THREE.Group();
        const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 24);
        wheelGeo.rotateX(Math.PI / 2);
        const fl = new THREE.Mesh(wheelGeo, frameMat.clone());
        fl.position.set(1.0, -0.2, 0.64);
        const fr = new THREE.Mesh(wheelGeo, frameMat.clone());
        fr.position.set(1.0, -0.2, -0.64);
        frontAxle.add(fl, fr);
        this.spinables.push(fl, fr);
        this.registerPart('front_wheels', 'Front Vector Wheels', frontAxle, new THREE.Vector3(0.75, -0.45, 0));

        // 5. Rear Axle & Wheels
        const rearAxle = new THREE.Group();
        const rl = new THREE.Mesh(wheelGeo, frameMat.clone());
        rl.position.set(-1.0, -0.2, 0.64);
        const rr = new THREE.Mesh(wheelGeo, frameMat.clone());
        rr.position.set(-1.0, -0.2, -0.64);
        rearAxle.add(rl, rr);
        this.spinables.push(rl, rr);
        this.registerPart('rear_wheels', 'Rear Torque Wheels', rearAxle, new THREE.Vector3(-0.75, -0.45, 0));

        // 6. Active Aero Spoiler
        const wingGeo = new THREE.BoxGeometry(0.28, 0.05, 1.24);
        const wing = new THREE.Mesh(wingGeo, accentMat.clone());
        wing.position.set(-1.42, 0.45, 0);
        this.registerPart('spoiler', 'Active Aero Wing', wing, new THREE.Vector3(-0.7, 0.8, 0));
        break;
      }

      case 'cyber_motorcycle': {
        // 1. Spine Frame
        const spineGeo = new THREE.BoxGeometry(1.5, 0.36, 0.34);
        const spine = new THREE.Mesh(spineGeo, frameMat.clone());
        spine.position.set(0, 0.15, 0);
        this.registerPart('frame', 'Titanium Trellis Frame', spine, new THREE.Vector3(0, 0.35, 0));

        // 2. Fuel / Fusion Tank
        const tankGeo = new THREE.CylinderGeometry(0.2, 0.28, 0.85, 12);
        tankGeo.rotateZ(Math.PI / 2.2);
        const tank = new THREE.Mesh(tankGeo, coreMat.clone());
        tank.position.set(0.25, 0.48, 0);
        this.registerPart('tank', 'Fusion Cell Reservoir', tank, new THREE.Vector3(0.2, 0.85, 0));

        // 3. Engine Block
        const motorGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.4, 16);
        motorGeo.rotateX(Math.PI / 2);
        const motor = new THREE.Mesh(motorGeo, accentMat.clone());
        motor.position.set(-0.05, -0.05, 0);
        this.registerPart('motor', 'High-RPM Drive Core', motor, new THREE.Vector3(0, -0.55, 0));

        // 4. Front Fork & Wheel
        const wheelGeo = new THREE.TorusGeometry(0.42, 0.11, 14, 32);
        const frontWheel = new THREE.Mesh(wheelGeo, frameMat.clone());
        frontWheel.position.set(1.05, -0.22, 0);
        this.spinables.push(frontWheel);
        this.registerPart('front_wheel', 'Front Gyro Wheel', frontWheel, new THREE.Vector3(0.95, -0.2, 0));

        // 5. Rear Swingarm Wheel
        const rearWheel = new THREE.Mesh(wheelGeo, frameMat.clone());
        rearWheel.position.set(-1.05, -0.22, 0);
        this.spinables.push(rearWheel);
        this.registerPart('rear_wheel', 'Rear Drive Wheel', rearWheel, new THREE.Vector3(-0.95, -0.2, 0));
        break;
      }

      case 'holo_smartphone': {
        // 1. Titanium Unibody Frame
        const bodyGeo = new THREE.BoxGeometry(1.15, 2.25, 0.1);
        const body = new THREE.Mesh(bodyGeo, frameMat.clone());
        this.registerPart('chassis', 'Grade-5 Titanium Unibody', body, new THREE.Vector3(0, 0, -0.8));

        // 2. OLED Holo Screen
        const screenGeo = new THREE.BoxGeometry(1.04, 2.12, 0.03);
        const screen = new THREE.Mesh(screenGeo, coreMat.clone());
        screen.position.set(0, 0, 0.07);
        this.registerPart('display', 'LTPO OLED Display Panel', screen, new THREE.Vector3(0, 0, 0.95));

        // 3. Neural SoC Motherboard
        const pcbGeo = new THREE.BoxGeometry(0.76, 0.85, 0.03);
        const pcb = new THREE.Mesh(pcbGeo, accentMat.clone());
        pcb.position.set(-0.1, 0.45, 0.02);
        this.registerPart('soc', 'Quantum Neural SoC Board', pcb, new THREE.Vector3(-0.55, 0.35, 0.4));

        // 4. Solid-State Battery
        const battGeo = new THREE.BoxGeometry(0.75, 0.95, 0.04);
        const batt = new THREE.Mesh(battGeo, coreMat.clone());
        batt.position.set(0.05, -0.45, 0.01);
        this.registerPart('battery', 'Graphene Power Cell', batt, new THREE.Vector3(0.45, -0.35, 0.35));

        // 5. Triple Optical Camera Module
        const camGroup = new THREE.Group();
        const lensGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 18);
        lensGeo.rotateX(Math.PI / 2);
        for (let i = 0; i < 3; i++) {
          const lens = new THREE.Mesh(lensGeo, accentMat.clone());
          lens.position.set(i === 2 ? -0.18 : -0.36, 0.85 - (i % 2) * 0.25, -0.07);
          camGroup.add(lens);
        }
        this.registerPart('camera', 'Periscope Optical Array', camGroup, new THREE.Vector3(-0.4, 0.75, -0.65));
        break;
      }

      case 'quantum_workstation': {
        // 1. Tower Chassis
        const towerGeo = new THREE.BoxGeometry(1.1, 2.0, 1.7);
        const tower = new THREE.Mesh(towerGeo, frameMat.clone());
        this.registerPart('tower', 'Anodized Chassis Tower', tower, new THREE.Vector3(-0.7, 0, 0));

        // 2. Motherboard Backplane
        const moboGeo = new THREE.BoxGeometry(0.06, 1.65, 1.35);
        const mobo = new THREE.Mesh(moboGeo, coreMat.clone());
        mobo.position.set(-0.35, 0, 0);
        this.registerPart('mobo', 'System Logic Backplane', mobo, new THREE.Vector3(-0.15, 0.45, 0));

        // 3. Dual GPU Tensor Blades
        const gpuGroup = new THREE.Group();
        const gpuGeo = new THREE.BoxGeometry(0.65, 0.14, 1.1);
        const g1 = new THREE.Mesh(gpuGeo, accentMat.clone());
        g1.position.set(0.05, -0.15, 0.1);
        const g2 = new THREE.Mesh(gpuGeo, accentMat.clone());
        g2.position.set(0.05, -0.45, 0.1);
        gpuGroup.add(g1, g2);
        this.registerPart('gpu', 'Tensor Compute Blades', gpuGroup, new THREE.Vector3(0.8, -0.2, 0.4));

        // 4. Liquid Cooling Manifold
        const radGeo = new THREE.BoxGeometry(0.85, 0.22, 1.3);
        const rad = new THREE.Mesh(radGeo, coreMat.clone());
        rad.position.set(0, 0.82, 0);
        this.registerPart('cooling', 'Cryo-Liquid Radiator', rad, new THREE.Vector3(0, 0.95, 0));

        // 5. Tempered Glass Side Panel
        const glassGeo = new THREE.BoxGeometry(0.04, 1.88, 1.58);
        const glass = new THREE.Mesh(glassGeo, coreMat.clone());
        glass.position.set(0.57, 0, 0);
        this.registerPart('panel', 'Telemetry Access Panel', glass, new THREE.Vector3(1.05, 0, 0));
        break;
      }

      case 'jet_turbine_engine': {
        // 1. Nacelle Cowl Housing
        const cowlGeo = new THREE.CylinderGeometry(1.05, 0.9, 2.3, 28, 1, true);
        cowlGeo.rotateZ(Math.PI / 2);
        const cowl = new THREE.Mesh(cowlGeo, frameMat.clone());
        this.registerPart('cowl', 'Bypass Nacelle Housing', cowl, new THREE.Vector3(0, 0.75, 0));

        // 2. Intake Fan Blades
        const fanGroup = new THREE.Group();
        const hubGeo = new THREE.ConeGeometry(0.32, 0.65, 18);
        hubGeo.rotateZ(-Math.PI / 2);
        const hub = new THREE.Mesh(hubGeo, accentMat.clone());
        hub.position.set(1.05, 0, 0);
        fanGroup.add(hub);
        const bladeGeo = new THREE.BoxGeometry(0.06, 0.82, 0.14);
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          const b = new THREE.Mesh(bladeGeo, frameMat.clone());
          b.position.set(0.88, Math.cos(angle) * 0.5, Math.sin(angle) * 0.5);
          b.rotation.x = angle;
          b.rotation.y = 0.35;
          fanGroup.add(b);
        }
        this.spinables.push(fanGroup);
        this.registerPart('fan', 'Titanium Intake Fan Stage', fanGroup, new THREE.Vector3(1.15, 0, 0));

        // 3. High-Pressure Compressor Core
        const compGeo = new THREE.CylinderGeometry(0.62, 0.45, 1.1, 20);
        compGeo.rotateZ(Math.PI / 2);
        const comp = new THREE.Mesh(compGeo, coreMat.clone());
        comp.position.set(0.1, 0, 0);
        this.registerPart('compressor', 'HP Compressor Rotor', comp, new THREE.Vector3(0.15, -0.5, 0));

        // 4. Annular Combustion Chamber
        const combGeo = new THREE.TorusGeometry(0.48, 0.18, 14, 28);
        combGeo.rotateY(Math.PI / 2);
        const comb = new THREE.Mesh(combGeo, accentMat.clone());
        comb.position.set(-0.55, 0, 0);
        this.registerPart('combustor', 'Annular Combustion Ring', comb, new THREE.Vector3(-0.5, 0, 0.55));

        // 5. Exhaust Vectoring Nozzle
        const nozGeo = new THREE.CylinderGeometry(0.55, 0.38, 0.75, 20, 1, true);
        nozGeo.rotateZ(Math.PI / 2);
        const noz = new THREE.Mesh(nozGeo, frameMat.clone());
        noz.position.set(-1.25, 0, 0);
        this.registerPart('nozzle', 'Thrust Vectoring Nozzle', noz, new THREE.Vector3(-1.25, 0, 0));
        break;
      }

      case 'stark_skyscraper': {
        // 1. Seismic Foundation Plinth
        const baseGeo = new THREE.BoxGeometry(1.75, 0.45, 1.75);
        const base = new THREE.Mesh(baseGeo, frameMat.clone());
        base.position.set(0, -1.05, 0);
        this.registerPart('plinth', 'Seismic Foundation Plinth', base, new THREE.Vector3(0, -0.75, 0));

        // 2. Main Structural Tower Shaft
        const shaftGeo = new THREE.CylinderGeometry(0.58, 0.82, 1.65, 6);
        const shaft = new THREE.Mesh(shaftGeo, coreMat.clone());
        shaft.position.set(0, -0.05, 0);
        this.registerPart('shaft', 'Diagrid Exo-Core Shaft', shaft, new THREE.Vector3(-0.65, 0.1, 0));

        // 3. Cantilever Stark Flight Deck
        const deckGeo = new THREE.BoxGeometry(1.65, 0.16, 0.95);
        const deck = new THREE.Mesh(deckGeo, accentMat.clone());
        deck.position.set(0.42, 0.55, 0);
        this.registerPart('skydeck', 'Cantilever Launch Deck', deck, new THREE.Vector3(1.05, 0.45, 0));

        // 4. Clean Arc Beacon Spire
        const spireGeo = new THREE.CylinderGeometry(0.05, 0.42, 0.95, 8);
        const spire = new THREE.Mesh(spireGeo, frameMat.clone());
        spire.position.set(0, 1.12, 0);
        this.registerPart('spire', 'Arc Beacon Crown Spire', spire, new THREE.Vector3(0, 1.05, 0));
        break;
      }

      case 'industrial_robot_arm': {
        // 1. Turret Swivel Base
        const baseGeo = new THREE.CylinderGeometry(0.68, 0.8, 0.38, 24);
        const base = new THREE.Mesh(baseGeo, frameMat.clone());
        base.position.set(0, -1.05, 0);
        this.registerPart('base', '360° Harmonic Turret Base', base, new THREE.Vector3(0, -0.75, 0));

        // 2. Lower Articulated Boom
        const boomGeo = new THREE.BoxGeometry(0.28, 1.15, 0.28);
        const boom = new THREE.Mesh(boomGeo, coreMat.clone());
        boom.position.set(-0.22, -0.35, 0);
        boom.rotation.z = 0.35;
        this.registerPart('boom', 'Primary Hydraulic Boom', boom, new THREE.Vector3(-0.7, 0.15, 0));

        // 3. Servo Elbow Joint & Forearm
        const forearmGeo = new THREE.BoxGeometry(1.1, 0.22, 0.22);
        const forearm = new THREE.Mesh(forearmGeo, frameMat.clone());
        forearm.position.set(0.18, 0.38, 0);
        forearm.rotation.z = 0.25;
        this.registerPart('forearm', '6-DOF Articulated Forearm', forearm, new THREE.Vector3(0.45, 0.75, 0));

        // 4. Precision Laser Gripper Head
        const gripperGroup = new THREE.Group();
        const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14), accentMat.clone());
        const jawA = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), accentMat.clone());
        jawA.position.set(0.25, 0.1, 0);
        const jawB = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), accentMat.clone());
        jawB.position.set(0.25, -0.1, 0);
        gripperGroup.add(wrist, jawA, jawB);
        gripperGroup.position.set(0.8, 0.56, 0);
        this.registerPart('gripper', 'Precision Servo Gripper', gripperGroup, new THREE.Vector3(1.05, 0.55, 0));
        break;
      }

      case 'planetary_gearbox': {
        // 1. Outer Ring Gear Housing
        const outerGeo = new THREE.TorusGeometry(1.22, 0.16, 12, 36);
        const outer = new THREE.Mesh(outerGeo, frameMat.clone());
        this.registerPart('ring_gear', 'Internal Annulus Ring Gear', outer, new THREE.Vector3(0, 0, -0.85));

        // 2. Central Sun Drive Gear
        const sunGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.36, 16);
        sunGeo.rotateX(Math.PI / 2);
        const sun = new THREE.Mesh(sunGeo, accentMat.clone());
        this.spinables.push(sun);
        this.registerPart('sun_gear', 'High-Torque Sun Pinion', sun, new THREE.Vector3(0, 0, 0.95));

        // 3. Planet Gears Carrier Assembly
        const planetsGroup = new THREE.Group();
        const pGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.32, 12);
        pGeo.rotateX(Math.PI / 2);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const p = new THREE.Mesh(pGeo, coreMat.clone());
          p.position.set(Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0);
          planetsGroup.add(p);
        }
        this.spinables.push(planetsGroup);
        this.registerPart('planets', 'Tri-Planet Reduction Gears', planetsGroup, new THREE.Vector3(0, 0.75, 0.45));

        // 4. Splined Input Shaft
        const shaftGeo = new THREE.CylinderGeometry(0.14, 0.14, 1.25, 16);
        shaftGeo.rotateX(Math.PI / 2);
        const shaft = new THREE.Mesh(shaftGeo, frameMat.clone());
        shaft.position.set(0, 0, -0.35);
        this.registerPart('shaft', 'Hardened Drive Shaft', shaft, new THREE.Vector3(0, -0.65, -0.6));
        break;
      }

      case 'atom_orbital_model':
      default: {
        // 1. Dense Atomic Nucleus Cluster
        const nucleusGroup = new THREE.Group();
        const nGeo = new THREE.SphereGeometry(0.18, 16, 16);
        const offsets = [
          [0, 0, 0],
          [0.16, 0.1, 0.08],
          [-0.15, -0.1, 0.1],
          [0.08, -0.15, -0.12],
          [-0.1, 0.14, -0.1]
        ];
        offsets.forEach(([x, y, z]) => {
          const nucleon = new THREE.Mesh(nGeo, accentMat.clone());
          nucleon.position.set(x, y, z);
          nucleusGroup.add(nucleon);
        });
        this.registerPart('nucleus', 'Proton-Neutron Nucleus', nucleusGroup, new THREE.Vector3(0, 0, 0.75));

        // 2. Orbital Shell Alpha
        const ringGeo = new THREE.TorusGeometry(1.32, 0.03, 12, 64);
        const shellA = new THREE.Mesh(ringGeo, frameMat.clone());
        shellA.rotation.set(Math.PI / 3, 0, 0);
        this.spinables.push(shellA);
        this.registerPart('shell_alpha', '1s / 2p Electron Orbital A', shellA, new THREE.Vector3(-0.75, 0.6, 0));

        // 3. Orbital Shell Beta
        const shellB = new THREE.Mesh(ringGeo, frameMat.clone());
        shellB.rotation.set(-Math.PI / 3, Math.PI / 4, 0);
        this.spinables.push(shellB);
        this.registerPart('shell_beta', 'Valence Electron Orbital B', shellB, new THREE.Vector3(0.75, 0.6, 0));

        // 4. Orbital Shell Gamma & Valence Electrons
        const shellC = new THREE.Mesh(ringGeo, coreMat.clone());
        shellC.rotation.set(Math.PI / 2, -Math.PI / 3, 0);
        const eGeo = new THREE.SphereGeometry(0.1, 14, 14);
        const electron = new THREE.Mesh(eGeo, accentMat.clone());
        electron.position.set(1.32, 0, 0);
        shellC.add(electron);
        this.spinables.push(shellC);
        this.registerPart('shell_gamma', 'Quantum Valence Electron', shellC, new THREE.Vector3(0, -0.8, 0.35));
        break;
      }
    }
  }

  public getComponentAnchors(): ComponentAnchor[] {
    return this.parts.map((p) => ({
      id: p.id,
      name: p.name,
      object: p.object
    }));
  }

  public setExplodedView(exploded: boolean) {
    this.targetExplosion = exploded ? 1.0 : 0.0;
  }

  public setExplosionAmount(amount: number) {
    this.targetExplosion = Math.max(0, Math.min(1, amount));
  }

  public getExplosionAmount(): number {
    return this.currentExplosion;
  }

  public setColorTheme(hex: number) {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat && 'emissive' in mat) {
          mat.emissive.setHex(hex);
          if (mat.color.getHex() !== 0xffffff) {
            mat.color.setHex(hex);
          }
        }
      }
    });
  }

  public update(time: number, speedMultiplier: number = 1.0) {
    // Exponential smoothing for exploded layer separation
    this.currentExplosion += (this.targetExplosion - this.currentExplosion) * 0.1;

    for (const part of this.parts) {
      part.object.position.set(
        part.basePos.x + part.explodeDir.x * this.currentExplosion,
        part.basePos.y + part.explodeDir.y * this.currentExplosion,
        part.basePos.z + part.explodeDir.z * this.currentExplosion
      );
    }

    // Subtle mechanical motion per category
    const spinStep = 0.025 * Math.max(0.2, speedMultiplier);
    for (let i = 0; i < this.spinables.length; i++) {
      const obj = this.spinables[i];
      if (this.modelId === 'jet_turbine_engine') {
        obj.rotation.x += spinStep * 2.5;
      } else if (this.modelId === 'atom_orbital_model') {
        obj.rotation.z += spinStep * (i % 2 === 0 ? 1 : -1.2);
      } else if (this.modelId === 'planetary_gearbox') {
        obj.rotation.z += spinStep * (i === 0 ? 1.6 : -0.7);
      } else {
        obj.rotation.z -= spinStep;
      }
    }

    // Subtle hover breathing
    this.group.position.y = Math.sin(time * 1.8) * 0.04;
  }
}
