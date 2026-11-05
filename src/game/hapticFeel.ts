/**
 * Gear values for play haptics. Playback lives in hapticsPlay.ts.
 * The gear writes these. Play reads them when it fires.
 */

import { haptics } from '../utils/haptics';

export type HapticKind = 'grab' | 'hit' | 'ready' | 'clear' | 'rumble' | 'turn';

export type HapticPair = { intensity: number; sharpness: number };

export type HapticFeel = Record<HapticKind, HapticPair>;

export const HAPTIC_FEEL_DEFAULT: HapticFeel = {
  grab: { intensity: 0.45, sharpness: 0.55 },
  hit: { intensity: 0.3, sharpness: 1 },
  ready: { intensity: 0.4, sharpness: 0.59 },
  clear: { intensity: 0.45, sharpness: 0.33 },
  rumble: { intensity: 0.15, sharpness: 0.38 },
  turn: { intensity: 0.3, sharpness: 0.23 },
};

const KEY = 'rings.haptic-feel';

/** Radians of nutSpin between turn clicks. One thread pitch is π/8. */
export const TURN_STEP_DEFAULT = Math.PI / 8;
/** Shortest time between turn clicks, in milliseconds. */
export const TURN_GAP_DEFAULT = 30;

export type NutTurnTune = { step: number; gapMs: number };

const TURN_STEP_MIN = Math.PI / 32;
const TURN_STEP_MAX = Math.PI / 2;
const TURN_GAP_MIN = 16;
const TURN_GAP_MAX = 200;

const labels: Record<HapticKind, string> = {
  grab: '点击',
  hit: '撞击',
  ready: '变亮',
  clear: '消除',
  rumble: '拖动',
  turn: '转动',
};

export function hapticLabel(kind: HapticKind): string {
  return labels[kind];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function pair(value: unknown, fallback: HapticPair): HapticPair {
  if (!value || typeof value !== 'object') return { ...fallback };
  const raw = value as { intensity?: unknown; sharpness?: unknown };
  return {
    intensity: clamp01(typeof raw.intensity === 'number' ? raw.intensity : fallback.intensity),
    sharpness: clamp01(typeof raw.sharpness === 'number' ? raw.sharpness : fallback.sharpness),
  };
}

/** Drag bed floor. The 拖动 intensity slider is the ceiling. */
export const RUMBLE_FLOOR_DEFAULT = 0.06;

type StoredFeel = Partial<HapticFeel> & { turnStep?: unknown; turnGapMs?: unknown; rumbleFloor?: unknown };

function readStored(): StoredFeel | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredFeel;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function feelFrom(data: StoredFeel | null): HapticFeel {
  if (!data) return structuredClone(HAPTIC_FEEL_DEFAULT);
  return {
    grab: pair(data.grab, HAPTIC_FEEL_DEFAULT.grab),
    hit: pair(data.hit, HAPTIC_FEEL_DEFAULT.hit),
    ready: pair(data.ready, HAPTIC_FEEL_DEFAULT.ready),
    clear: pair(data.clear, HAPTIC_FEEL_DEFAULT.clear),
    rumble: pair(data.rumble, HAPTIC_FEEL_DEFAULT.rumble),
    turn: pair(data.turn, HAPTIC_FEEL_DEFAULT.turn),
  };
}

function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function hapticFeel(): HapticFeel {
  return feelFrom(readStored());
}

export function rumbleFloor(): number {
  const data = readStored();
  const hi = hapticFeel().rumble.intensity;
  const floor = clampRange(typeof data?.rumbleFloor === 'number' ? data.rumbleFloor : RUMBLE_FLOOR_DEFAULT, 0, 1, RUMBLE_FLOOR_DEFAULT);
  return Math.min(floor, hi);
}

export function setRumbleFloor(value: number): void {
  const hi = hapticFeel().rumble.intensity;
  const floor = Math.min(clamp01(value), hi);
  const data = readStored();
  const tune = nutTurnTune();
  localStorage.setItem(KEY, JSON.stringify({ ...feelFrom(data), turnStep: tune.step, turnGapMs: tune.gapMs, rumbleFloor: floor }));
}

export function nutTurnTune(): NutTurnTune {
  const data = readStored();
  return {
    step: clampRange(typeof data?.turnStep === 'number' ? data.turnStep : TURN_STEP_DEFAULT, TURN_STEP_MIN, TURN_STEP_MAX, TURN_STEP_DEFAULT),
    gapMs: clampRange(typeof data?.turnGapMs === 'number' ? data.turnGapMs : TURN_GAP_DEFAULT, TURN_GAP_MIN, TURN_GAP_MAX, TURN_GAP_DEFAULT),
  };
}

function writeStored(feel: HapticFeel, tune: NutTurnTune): void {
  const data = readStored();
  const floor = clampRange(typeof data?.rumbleFloor === 'number' ? data.rumbleFloor : RUMBLE_FLOOR_DEFAULT, 0, 1, RUMBLE_FLOOR_DEFAULT);
  localStorage.setItem(KEY, JSON.stringify({
    ...feel,
    turnStep: tune.step,
    turnGapMs: tune.gapMs,
    rumbleFloor: Math.min(floor, feel.rumble.intensity),
  }));
}

export function setHapticPair(kind: HapticKind, next: HapticPair): void {
  const feel = hapticFeel();
  feel[kind] = {
    intensity: clamp01(next.intensity),
    sharpness: clamp01(next.sharpness),
  };
  writeStored(feel, nutTurnTune());
}

export function setNutTurnTune(next: Partial<NutTurnTune>): void {
  const tune = nutTurnTune();
  if (typeof next.step === 'number') tune.step = clampRange(next.step, TURN_STEP_MIN, TURN_STEP_MAX, TURN_STEP_DEFAULT);
  if (typeof next.gapMs === 'number') tune.gapMs = clampRange(next.gapMs, TURN_GAP_MIN, TURN_GAP_MAX, TURN_GAP_DEFAULT);
  writeStored(hapticFeel(), tune);
}

export function resetHapticFeel(): void {
  localStorage.removeItem(KEY);
}

export function pulseHaptic(kind: HapticKind): void {
  const pair = hapticFeel()[kind];
  void haptics.playTransient(pair.intensity, pair.sharpness);
}
