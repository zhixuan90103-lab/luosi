/**
 * One drag session for a screw or a nut.
 * The bed follows the finger. Turn clicks follow the nut, and only while the bed is on.
 */

import { haptics } from '../utils/haptics';
import { hapticFeel, nutTurnTune, pulseHaptic, rumbleFloor } from './hapticFeel';

/** No real travel for this long means the finger has paused. */
const QUIET_MS = 100;
/** Net travel is measured across this window so a jittering finger stays weak. */
const WINDOW_MS = 90;
/** World units per second. Below this the bed stays off. At the high end it reaches the ceiling. */
const SPEED_LO = 0.35;
const SPEED_HI = 1.8;

let motorOn = false;
let motorKey = '';
let lastMotionAt = 0;
let trail: { t: number; x: number; y: number }[] = [];
let turnDebt = 0;
let turnAt = 0;

function clearTrail(): void {
  trail = [];
}

function level(speed: number): number {
  const hi = hapticFeel().rumble.intensity;
  const lo = Math.min(rumbleFloor(), hi);
  const span = SPEED_HI - SPEED_LO;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (speed - SPEED_LO) / span));
  const shaped = t * t * (3 - 2 * t);
  return lo + (hi - lo) * shaped;
}

function apply(intensity: number, sharpness: number): void {
  const key = `${intensity.toFixed(2)}:${sharpness.toFixed(2)}`;
  if (!motorOn) {
    motorOn = true;
    motorKey = key;
    void haptics.startContinuous({ intensity, sharpness });
    return;
  }
  if (key === motorKey) return;
  motorKey = key;
  void haptics.updateContinuous({ intensity, sharpness });
}

function motorOff(): void {
  if (!motorOn) return;
  motorOn = false;
  motorKey = '';
  void haptics.stopContinuous();
}

export const playHaptics = {
  pulse: pulseHaptic,

  /**
   * One sample of a held screw or nut.
   * `halted` is a block, or a nut that has left the rod: the bed stops now.
   * `spinDelta` is set only for a nut still on the rod.
   */
  slide(sample: { x: number; y: number; nowMs: number; halted: boolean; spinDelta?: number }): void {
    if (sample.halted) {
      this.stop();
      return;
    }
    this.track(sample.x, sample.y, sample.nowMs);
    if (sample.spinDelta !== undefined) this.turn(sample.spinDelta, sample.nowMs);
  },

  /** Finger sample while the piece is still free to move. */
  track(x: number, y: number, nowMs: number): void {
    trail.push({ t: nowMs, x, y });
    while (trail.length > 1 && nowMs - trail[0].t > WINDOW_MS) trail.shift();
    const origin = trail[0];
    const span = Math.max(0.016, (nowMs - origin.t) / 1000);
    const speed = Math.hypot(x - origin.x, y - origin.y) / span;
    if (speed < SPEED_LO) return;
    lastMotionAt = nowMs;
    const pair = hapticFeel().rumble;
    apply(level(speed), pair.sharpness);
  },

  /** Nut spin since the last sample. Clicks only while the bed is running. */
  turn(spinDelta: number, nowMs: number): void {
    if (!motorOn || !Number.isFinite(spinDelta)) return;
    const tune = nutTurnTune();
    turnDebt = Math.min(tune.step, turnDebt + Math.abs(spinDelta));
    if (turnDebt < tune.step || nowMs - turnAt < tune.gapMs) return;
    turnDebt = 0;
    turnAt = nowMs;
    pulseHaptic('turn');
  },

  /** Stop the bed once the finger has stayed still. */
  settle(nowMs: number): void {
    if (!motorOn || nowMs - lastMotionAt < QUIET_MS) return;
    motorOff();
    clearTrail();
  },

  /** Release or level change. A halted slide uses this too. */
  stop(): void {
    turnDebt = 0;
    clearTrail();
    motorOff();
  },
};
