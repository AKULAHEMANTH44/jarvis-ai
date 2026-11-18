import { Landmark3D } from '../types/gesture';

export interface CustomGestureSample {
  landmarks: Landmark3D[];
  features: number[];
}

export interface CustomGestureProfile {
  id: string;
  name: string;
  description: string;
  actionId: string; // e.g., 'NEXT_MODEL', 'TRIGGER_SHOCKWAVE', 'TOGGLE_DISPERSION', 'RESET_CAMERA'
  samples: CustomGestureSample[];
  featureCentroid: number[];
  tolerance: number;
  enabled: boolean;
  createdAt: number;
}

const STORAGE_KEY = 'jarvis_custom_gesture_profiles';

const DEFAULT_CUSTOM_PROFILES: CustomGestureProfile[] = [
  {
    id: 'custom_v_salute',
    name: 'V-Salute',
    description: 'Victory two-finger point to trigger model cycle',
    actionId: 'NEXT_MODEL',
    samples: [],
    featureCentroid: [0.15, 0.16, 0.04, 0.04, 0.04],
    tolerance: 0.045,
    enabled: true,
    createdAt: Date.now() - 86400000
  },
  {
    id: 'custom_palm_flat',
    name: 'Stark Horizon Palm',
    description: 'Flat vertical palm to trigger holographic shockwave',
    actionId: 'TRIGGER_SHOCKWAVE',
    samples: [],
    featureCentroid: [0.25, 0.26, 0.24, 0.22, 0.21],
    tolerance: 0.05,
    enabled: true,
    createdAt: Date.now() - 86400000
  }
];

export function extractHandFeatures(landmarks: Landmark3D[]): number[] {
  if (!landmarks || landmarks.length < 21) {
    return new Array(10).fill(0);
  }
  const wrist = landmarks[0];
  const tips = [4, 8, 12, 16, 20];
  const tipDistances = tips.map((tipIdx) => {
    const p = landmarks[tipIdx];
    const dx = p.x - wrist.x;
    const dy = p.y - wrist.y;
    const dz = (p.z || 0) - (wrist.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  });

  const adjDistances = [
    Math.hypot(landmarks[8].x - landmarks[12].x, landmarks[8].y - landmarks[12].y),
    Math.hypot(landmarks[12].x - landmarks[16].x, landmarks[12].y - landmarks[16].y),
    Math.hypot(landmarks[16].x - landmarks[20].x, landmarks[16].y - landmarks[20].y)
  ];

  return [...tipDistances, ...adjDistances];
}

export function computeCentroid(samples: CustomGestureSample[]): number[] {
  if (samples.length === 0) return new Array(8).fill(0);
  const dim = samples[0].features.length;
  const centroid = new Array(dim).fill(0);
  for (const sample of samples) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += sample.features[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroid[i] /= samples.length;
  }
  return centroid;
}

export class CustomGestureService {
  private profiles: CustomGestureProfile[] = [];

  constructor() {
    this.profiles = this.loadProfiles();
  }

  private loadProfiles(): CustomGestureProfile[] {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn('Failed to load custom gesture profiles:', e);
      }
    }
    return DEFAULT_CUSTOM_PROFILES;
  }

  private saveProfiles() {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profiles));
      } catch (e) {
        console.warn('Failed to save custom gesture profiles:', e);
      }
    }
  }

  public getProfiles(): CustomGestureProfile[] {
    return [...this.profiles];
  }

  public createProfile(profile: Omit<CustomGestureProfile, 'id' | 'createdAt' | 'samples' | 'featureCentroid'>): CustomGestureProfile {
    const id = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const newProfile: CustomGestureProfile = {
      ...profile,
      id,
      samples: [],
      featureCentroid: new Array(8).fill(0),
      createdAt: Date.now()
    };
    this.profiles.push(newProfile);
    this.saveProfiles();
    return newProfile;
  }

  public updateProfile(id: string, updates: Partial<CustomGestureProfile>): CustomGestureProfile | null {
    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    this.profiles[idx] = { ...this.profiles[idx], ...updates };
    this.saveProfiles();
    return this.profiles[idx];
  }

  public deleteProfile(id: string): boolean {
    const lenBefore = this.profiles.length;
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.profiles.length !== lenBefore) {
      this.saveProfiles();
      return true;
    }
    return false;
  }

  public addSampleToProfile(id: string, landmarks: Landmark3D[]): boolean {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return false;

    const features = extractHandFeatures(landmarks);
    profile.samples.push({
      landmarks: landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z })),
      features
    });

    if (profile.samples.length > 25) {
      profile.samples.shift();
    }

    profile.featureCentroid = computeCentroid(profile.samples);
    this.saveProfiles();
    return true;
  }

  public toggleProfile(id: string): boolean {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return false;
    profile.enabled = !profile.enabled;
    this.saveProfiles();
    return profile.enabled;
  }

  public resetToDefaults(): CustomGestureProfile[] {
    this.profiles = [...DEFAULT_CUSTOM_PROFILES];
    this.saveProfiles();
    return this.profiles;
  }

  public matchCustomGesture(landmarks: Landmark3D[]): { profile: CustomGestureProfile; confidence: number } | null {
    if (!landmarks || landmarks.length < 21) return null;
    const liveFeatures = extractHandFeatures(landmarks);

    let bestMatch: CustomGestureProfile | null = null;
    let minDistance = Infinity;

    for (const profile of this.profiles) {
      if (!profile.enabled || profile.samples.length === 0 || !profile.featureCentroid) continue;

      let dist = 0;
      const len = Math.min(liveFeatures.length, profile.featureCentroid.length);
      for (let i = 0; i < len; i++) {
        const diff = liveFeatures[i] - profile.featureCentroid[i];
        dist += diff * diff;
      }
      dist = Math.sqrt(dist);

      if (dist < minDistance && dist <= (profile.tolerance || 0.05)) {
        minDistance = dist;
        bestMatch = profile;
      }
    }

    if (bestMatch) {
      const confidence = Math.max(0.5, Math.min(1.0, 1.0 - minDistance / (bestMatch.tolerance || 0.05)));
      return { profile: bestMatch, confidence };
    }

    return null;
  }
}

export const customGestureService = new CustomGestureService();
