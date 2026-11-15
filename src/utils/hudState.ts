import { HologramModelId } from '../types/hologram';

export type HudDrawerId =
  | 'GESTURE'
  | 'MODELS'
  | 'LAB'
  | 'TELEMETRY'
  | 'CONFIG'
  | 'TASKS'
  | 'VOICE';

export interface HudLayoutState {
  activeDrawer: HudDrawerId | null;
  isFocusMode: boolean;
}

export function isRightDrawer(drawer: HudDrawerId | null): boolean {
  return drawer === 'MODELS' || drawer === 'LAB' || drawer === 'TELEMETRY' || drawer === 'CONFIG';
}

export function getDrawerSide(drawer: HudDrawerId | null): 'LEFT' | 'RIGHT' | 'CENTER' | null {
  if (!drawer) return null;
  if (drawer === 'GESTURE') return 'LEFT';
  if (isRightDrawer(drawer)) return 'RIGHT';
  return 'CENTER';
}

export function toggleDrawerState(
  state: HudLayoutState,
  target: HudDrawerId
): HudLayoutState {
  if (state.activeDrawer === target && !state.isFocusMode) {
    return { ...state, activeDrawer: null };
  }
  return {
    activeDrawer: target,
    isFocusMode: false
  };
}

export function openDrawerState(
  _state: HudLayoutState,
  target: HudDrawerId
): HudLayoutState {
  return {
    activeDrawer: target,
    isFocusMode: false
  };
}

export function closeDrawerState(state: HudLayoutState): HudLayoutState {
  return {
    ...state,
    activeDrawer: null
  };
}

export function enterVisionHomeState(): HudLayoutState {
  return {
    activeDrawer: null,
    isFocusMode: false
  };
}

export function toggleFocusModeState(state: HudLayoutState): HudLayoutState {
  if (state.isFocusMode) {
    return { ...state, isFocusMode: false };
  }
  return {
    activeDrawer: null,
    isFocusMode: true
  };
}

export function handleEscapeKeyState(state: HudLayoutState): HudLayoutState {
  if (state.activeDrawer !== null) {
    return { ...state, activeDrawer: null };
  }
  if (state.isFocusMode) {
    return { ...state, isFocusMode: false };
  }
  return state;
}

export function shouldShowProjectedLabels(params: {
  showComponentLabels: boolean;
  isFocusMode: boolean;
  isStandby: boolean;
  explosionAmount: number;
  currentModelId: HologramModelId;
  reducedEffects: boolean;
  dispersionAmount: number;
}): boolean {
  if (!params.showComponentLabels || params.isFocusMode || params.isStandby) {
    return false;
  }
  return (
    params.explosionAmount > 0.15 ||
    (params.currentModelId === 'vision_sphere' &&
      !params.reducedEffects &&
      params.dispersionAmount < 0.85)
  );
}
