import { describe, it, expect } from 'vitest';
import {
  HudLayoutState,
  isRightDrawer,
  getDrawerSide,
  toggleDrawerState,
  openDrawerState,
  closeDrawerState,
  enterVisionHomeState,
  toggleFocusModeState,
  handleEscapeKeyState,
  shouldShowProjectedLabels
} from '../src/utils/hudState';

describe('hudState contextual drawer and Focus mode transitions', () => {
  const initialState: HudLayoutState = {
    activeDrawer: null,
    isFocusMode: false
  };

  it('starts in clean Vision mode with no drawers open and Focus mode off', () => {
    expect(initialState.activeDrawer).toBeNull();
    expect(initialState.isFocusMode).toBe(false);
    expect(getDrawerSide(initialState.activeDrawer)).toBeNull();
  });

  it('opens and toggles drawers with strict single-drawer mutual exclusion', () => {
    const modelsOpen = toggleDrawerState(initialState, 'MODELS');
    expect(modelsOpen.activeDrawer).toBe('MODELS');
    expect(isRightDrawer(modelsOpen.activeDrawer)).toBe(true);
    expect(getDrawerSide(modelsOpen.activeDrawer)).toBe('RIGHT');

    // Switching to GESTURE closes MODELS and opens Left Drawer
    const gestureOpen = toggleDrawerState(modelsOpen, 'GESTURE');
    expect(gestureOpen.activeDrawer).toBe('GESTURE');
    expect(isRightDrawer(gestureOpen.activeDrawer)).toBe(false);
    expect(getDrawerSide(gestureOpen.activeDrawer)).toBe('LEFT');

    // Switching to TASKS opens bottom-center console and closes Left Drawer
    const tasksOpen = toggleDrawerState(gestureOpen, 'TASKS');
    expect(tasksOpen.activeDrawer).toBe('TASKS');
    expect(getDrawerSide(tasksOpen.activeDrawer)).toBe('CENTER');

    // Clicking TASKS again closes it cleanly
    const tasksClosed = toggleDrawerState(tasksOpen, 'TASKS');
    expect(tasksClosed.activeDrawer).toBeNull();
  });

  it('switches cleanly across all right-side sections and closes via closeDrawerState', () => {
    let state = openDrawerState(initialState, 'MODELS');
    expect(state.activeDrawer).toBe('MODELS');

    state = openDrawerState(state, 'LAB');
    expect(state.activeDrawer).toBe('LAB');
    expect(isRightDrawer(state.activeDrawer)).toBe(true);

    state = openDrawerState(state, 'TELEMETRY');
    expect(state.activeDrawer).toBe('TELEMETRY');
    expect(isRightDrawer(state.activeDrawer)).toBe(true);

    state = openDrawerState(state, 'CONFIG');
    expect(state.activeDrawer).toBe('CONFIG');
    expect(isRightDrawer(state.activeDrawer)).toBe(true);

    state = closeDrawerState(state);
    expect(state.activeDrawer).toBeNull();
  });

  it('closes any open drawer when entering Focus mode and restores clean Vision workspace on exit', () => {
    const withVoice = openDrawerState(initialState, 'VOICE');
    expect(withVoice.activeDrawer).toBe('VOICE');

    const focused = toggleFocusModeState(withVoice);
    expect(focused.isFocusMode).toBe(true);
    expect(focused.activeDrawer).toBeNull();

    const exited = toggleFocusModeState(focused);
    expect(exited.isFocusMode).toBe(false);
    expect(exited.activeDrawer).toBeNull();

    // Selecting any drawer from Focus mode automatically exits Focus mode
    const openedFromFocus = toggleDrawerState(focused, 'LAB');
    expect(openedFromFocus.isFocusMode).toBe(false);
    expect(openedFromFocus.activeDrawer).toBe('LAB');
  });

  it('handles Escape key by closing active drawer first, then exiting Focus mode', () => {
    const withTelemetry = openDrawerState(initialState, 'TELEMETRY');
    const afterEscDrawer = handleEscapeKeyState(withTelemetry);
    expect(afterEscDrawer.activeDrawer).toBeNull();
    expect(afterEscDrawer.isFocusMode).toBe(false);

    const focused = toggleFocusModeState(initialState);
    const afterEscFocus = handleEscapeKeyState(focused);
    expect(afterEscFocus.isFocusMode).toBe(false);
    expect(afterEscFocus.activeDrawer).toBeNull();

    // Pressing Escape in clean Vision state is a safe no-op
    expect(handleEscapeKeyState(initialState)).toEqual(initialState);
  });

  it('restores clean Vision home state on enterVisionHomeState', () => {
    const dirty: HudLayoutState = { activeDrawer: 'TASKS', isFocusMode: true };
    expect(enterVisionHomeState()).toEqual({ activeDrawer: null, isFocusMode: false });
    expect(dirty.activeDrawer).toBe('TASKS');
  });

  it('suppresses projected 3D callout labels during Focus mode and Standby mode', () => {
    expect(
      shouldShowProjectedLabels({
        showComponentLabels: true,
        isFocusMode: false,
        isStandby: false,
        explosionAmount: 0,
        currentModelId: 'vision_sphere',
        reducedEffects: false,
        dispersionAmount: 0
      })
    ).toBe(true);

    expect(
      shouldShowProjectedLabels({
        showComponentLabels: true,
        isFocusMode: true,
        isStandby: false,
        explosionAmount: 1,
        currentModelId: 'vision_sphere',
        reducedEffects: false,
        dispersionAmount: 0
      })
    ).toBe(false);

    expect(
      shouldShowProjectedLabels({
        showComponentLabels: true,
        isFocusMode: false,
        isStandby: true,
        explosionAmount: 1,
        currentModelId: 'arc_reactor',
        reducedEffects: false,
        dispersionAmount: 0
      })
    ).toBe(false);
  });
});
