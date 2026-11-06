/**
 * Two decisions, both after the finger has already touched the screen.
 * Contact outlines stay in `screws.ts`. Nothing here grows a head, nut, or buckle.
 *
 * Acquire. The finger radius only lists candidates. A press on one candidate
 * locks it. A press on none stays open: the first candidate is watched until
 * the point enters its outline. Two or more candidates wait for an outline
 * or for one slide axis to lead. A nut on the screw under the point wins over
 * that screw. After a lock the caller stops calling.
 *
 * When the leading axis has several pieces, a clearly nearer outline still
 * wins. Outlines within `INTENT_NEAR` of each other prefer a piece that can
 * still leave: a screw that can clear its own buckle on at least one side
 * within the flick pad, or a nut that can still advance toward the tip.
 * That preference does not run on the press, and it does not run once an
 * outline or a single-piece axis has already locked.
 *
 * Release. Only a screw, and only on finger-up. The last 100 ms along the
 * shaft picks the pad: slow keeps a short look-ahead, a flick uses a longer
 * one. `screws.ts` then slides to the first pose that has left its buckle.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { VIEW_H } from './camera';

/** Gap travel, as a fraction of design width, before one axis may name a piece. */
export const INTENT_CLEAR = 8 / DESIGN_WIDTH;
/** Finger radius while a stroke is still choosing, as a fraction of design width. */
export const INTENT_FINGER = 18 / DESIGN_WIDTH;
/** The winning axis must beat the other by this much. */
export const INTENT_AXIS = 1.5;
/** |cross| of two slide axes below this means a stroke cannot separate them. */
export const INTENT_PARALLEL = 0.35;
/**
 * Outline gap, as a fraction of design width, treated as a tie on the leading axis.
 * A wider gap keeps the nearer piece. Literature gives no millimetre for this.
 */
export const INTENT_NEAR = 4 / DESIGN_WIDTH;

/** Short release look-ahead. Dragging still stops on the real outline. */
export const INTENT_SLEEVE = 0.05;
/** Release look-ahead when the last 100 ms along the shaft is a flick. */
export const INTENT_FLICK = 0.20;
/** Design pixels per second. At or above this, release uses `INTENT_FLICK`. */
export const INTENT_FLICK_SPEED = 250;
/** Samples used to read the release. */
export const RELEASE_WINDOW_MS = 100;

export function intentWorld(fraction: number, zoom: number): number {
  return (fraction * DESIGN_WIDTH * VIEW_H) / DESIGN_HEIGHT / Math.max(zoom, 1e-4);
}

export function axesParallel(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x * b.y - a.y * b.x) < INTENT_PARALLEL;
}

export type StrokeSample = { t: number; x: number; y: number };

/** Keep the newest samples, plus one at or before the release window. */
export function rememberStroke(samples: StrokeSample[], sample: StrokeSample): void {
  samples.push(sample);
  const edge = sample.t - RELEASE_WINDOW_MS;
  while (samples.length > 2 && samples[1].t < edge) samples.shift();
}

/**
 * Along-axis motion in the release window.
 * Null when that window has no motion, or its direction opposes the drag.
 * `speed` is design pixels per second.
 */
export function releaseFlick(
  samples: readonly StrokeSample[],
  axis: { x: number; y: number },
  dragSign: number,
  zoom: number,
  now: number,
): { sign: number; speed: number } | null {
  if (dragSign === 0 || samples.length < 2) return null;
  const latest = samples[samples.length - 1];
  if (now - latest.t > RELEASE_WINDOW_MS) return null;
  const edge = now - RELEASE_WINDOW_MS;
  let prev = samples[0];
  for (const sample of samples) {
    if (sample.t <= edge) prev = sample;
  }
  const dt = (latest.t - prev.t) / 1000;
  if (dt <= 1e-4) return null;
  const along = (latest.x - prev.x) * axis.x + (latest.y - prev.y) * axis.y;
  if (Math.sign(along) !== dragSign) return null;
  const worldPerSec = Math.abs(along) / dt;
  const speed = (worldPerSec * DESIGN_HEIGHT * zoom) / VIEW_H;
  return { sign: dragSign, speed };
}

/** Slow releases stay at `INTENT_SLEEVE`. A flick uses `INTENT_FLICK` and no more. */
export function releasePad(speed: number): number {
  return speed >= INTENT_FLICK_SPEED ? INTENT_FLICK : INTENT_SLEEVE;
}

export type AimPiece = {
  kind: 'nut' | 'screw';
  id: string;
  /** Set on a nut. The screw it sits on. */
  hostId?: string;
  axis: { x: number; y: number };
  /** The point is inside this piece's real outline. */
  inside: boolean;
  /** Distance to the real outline. Zero when `inside`. */
  distance: number;
  /**
   * The piece can still leave on its own axis.
   * A screw can clear its buckle within the flick pad. A nut can still move toward the tip.
   */
  open: boolean;
};

/** `open` has not reached a piece. `watch` is one piece, not locked. `choose` has two or more. */
export type Aim =
  | { phase: 'off' }
  | { phase: 'open'; x: number; y: number }
  | { phase: 'watch'; x: number; y: number; kind: 'nut' | 'screw'; id: string }
  | { phase: 'choose'; x: number; y: number };

type AimStep = { aim: Aim; lock: AimPiece | null };

function samePiece(piece: AimPiece, kind: 'nut' | 'screw', id: string): boolean {
  return piece.kind === kind && piece.id === id;
}

function allParallel(pieces: AimPiece[]): boolean {
  const first = pieces[0];
  if (!first) return true;
  return pieces.every((piece) => axesParallel(first.axis, piece.axis));
}

function nearest(pieces: AimPiece[]): AimPiece {
  return pieces.reduce((best, piece) => (piece.distance < best.distance ? piece : best));
}

/** Nuts on this screw whose slide axis matches the screw. */
function nutsOnScrew(pieces: AimPiece[], screw: AimPiece): AimPiece[] {
  return pieces.filter((piece) => piece.kind === 'nut' && piece.hostId === screw.id && axesParallel(piece.axis, screw.axis));
}

/**
 * One outline under the point locks.
 * A shaft with its own nut still in range locks that nut: the point lands
 * on the rod beside the nut more often than on the nut's slab.
 */
function outlineLock(pieces: AimPiece[]): AimPiece | null {
  const inside = pieces.filter((piece) => piece.inside);
  if (inside.length === 1 && inside[0].kind === 'screw') {
    const nuts = nutsOnScrew(pieces, inside[0]);
    if (nuts.length > 0) return nearest(nuts);
  }
  if (inside.length === 1) return inside[0];
  if (inside.length > 1 && allParallel(inside)) {
    const nuts = inside.filter((piece) => piece.kind === 'nut');
    if (nuts.length > 0) return nearest(nuts);
  }
  return null;
}

function axisClusters(
  pieces: AimPiece[],
  dx: number,
  dy: number,
): { pieces: AimPiece[]; along: number }[] {
  const clusters: { axis: { x: number; y: number }; pieces: AimPiece[]; along: number }[] = [];
  for (const piece of pieces) {
    const cluster = clusters.find((item) => axesParallel(item.axis, piece.axis));
    if (cluster) cluster.pieces.push(piece);
    else clusters.push({ axis: piece.axis, pieces: [piece], along: Math.abs(dx * piece.axis.x + dy * piece.axis.y) });
  }
  clusters.sort((a, b) => b.along - a.along);
  return clusters;
}

/**
 * The leading slide axis wins when it leads by `INTENT_AXIS` and only one piece uses it.
 * Parallel pieces share an axis, so a stroke cannot name one of them.
 */
function trendLock(pieces: AimPiece[], dx: number, dy: number, clearAt: number): AimPiece | null {
  const clusters = axisClusters(pieces, dx, dy);
  const best = clusters[0];
  const second = clusters[1]?.along ?? 0;
  if (!best || best.along < clearAt || best.along < second * INTENT_AXIS) return null;
  if (best.pieces.length !== 1) return null;
  return best.pieces[0];
}

/**
 * Leading axis, several pieces, after the same travel `trendLock` requires.
 * A piece nearer than `nearAt` wins on distance. Inside that band, one piece
 * that can still leave wins over pieces that cannot. A band that is all open
 * or all closed stays undecided.
 */
function openLock(pieces: AimPiece[], dx: number, dy: number, clearAt: number, nearAt: number): AimPiece | null {
  const clusters = axisClusters(pieces, dx, dy);
  const best = clusters[0];
  const second = clusters[1]?.along ?? 0;
  if (!best || best.pieces.length < 2) return null;
  if (best.along < clearAt || best.along < second * INTENT_AXIS) return null;
  const closest = nearest(best.pieces);
  const band = best.pieces.filter((piece) => piece.distance <= closest.distance + nearAt);
  if (band.length === 1) return closest;
  const leaving = band.filter((piece) => piece.open);
  if (leaving.length === 0 || leaving.length === band.length) return null;
  return nearest(leaving);
}

function locked(piece: AimPiece): AimStep {
  return { aim: { phase: 'off' }, lock: piece };
}

function held(aim: Aim): AimStep {
  return { aim, lock: null };
}

function watch(origin: { x: number; y: number }, piece: AimPiece): AimStep {
  return { aim: { phase: 'watch', x: origin.x, y: origin.y, kind: piece.kind, id: piece.id }, lock: null };
}

/** Several candidates: an outline, then one leading axis, then a near-tie that can leave. */
function choose(
  origin: { x: number; y: number },
  pieces: AimPiece[],
  x: number,
  y: number,
  clearAt: number,
  nearAt: number,
): AimStep {
  const dx = x - origin.x;
  const dy = y - origin.y;
  const piece = outlineLock(pieces) ?? trendLock(pieces, dx, dy, clearAt) ?? openLock(pieces, dx, dy, clearAt, nearAt);
  if (piece) return locked(piece);
  return held({ phase: 'choose', x: origin.x, y: origin.y });
}

/** One candidate locks on press. During a slide it locks only once the outline is entered. */
function one(origin: { x: number; y: number }, piece: AimPiece, enterOutline: boolean): AimStep {
  if (!enterOutline || piece.inside) return locked(piece);
  return watch(origin, piece);
}

/** A press on one candidate locks. None stays open. Two or more use `choose`. */
export function pressAim(pieces: AimPiece[], x: number, y: number): AimStep {
  const outlined = outlineLock(pieces);
  if (pieces.length === 0) return held({ phase: 'open', x, y });
  if (pieces.length === 1 || outlined) return locked(outlined ?? pieces[0]);
  return held({ phase: 'choose', x, y });
}

/**
 * Empty travel does not lock. The first piece in range is watched until its
 * outline is entered. A second piece uses `choose`. Dropping back to one
 * piece does not lock. After a lock the caller stops calling this.
 */
export function moveAim(aim: Aim, pieces: AimPiece[], x: number, y: number, clearAt: number, nearAt: number): AimStep {
  if (aim.phase === 'off') return held(aim);
  const origin = aim;
  if (aim.phase === 'choose') return choose(origin, pieces, x, y, clearAt, nearAt);
  if (pieces.length >= 2) return choose(origin, pieces, x, y, clearAt, nearAt);
  if (pieces.length === 0) return held({ phase: 'open', x: origin.x, y: origin.y });
  const piece = pieces[0];
  if (aim.phase === 'watch' && samePiece(piece, aim.kind, aim.id) && !piece.inside) return held(aim);
  return one(origin, piece, true);
}
