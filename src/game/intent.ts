/**
 * Feel distances and which piece a press means.
 * Contact outlines stay in `screws.ts`. Nothing here shrinks a head, nut, or buckle.
 * One piece locks immediately. Two pieces whose slide axes differ wait for a
 * short stroke, then follow the axis the finger moved along.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { VIEW_H } from './camera';

/** Along-axis travel, as a fraction of design width, before a gap between pieces may choose. */
export const INTENT_CLEAR = 8 / DESIGN_WIDTH;
/** Same distance as `INTENT_CLEAR`. The gap stroke that names a piece. */
export const INTENT_TREND = INTENT_CLEAR;
/** Finger radius on press and while a stroke is still choosing, as a fraction of design width. */
export const INTENT_FINGER = 18 / DESIGN_WIDTH;
/** On release only. Dragging still stops on the real outline. */
export const INTENT_SLEEVE = 0.05;
/** The winning axis must beat the other by this much. */
export const INTENT_AXIS = 1.5;
/** |cross| of the two slide axes below this means a stroke cannot separate them. */
export const INTENT_PARALLEL = 0.35;

export function intentWorld(fraction: number, zoom: number): number {
  return (fraction * DESIGN_WIDTH * VIEW_H) / DESIGN_HEIGHT / Math.max(zoom, 1e-4);
}

export function axesParallel(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x * b.y - a.y * b.x) < INTENT_PARALLEL;
}

/** Null until the stroke is long enough and one axis clearly leads. */
export function strokeChoice(
  nutAxis: { x: number; y: number },
  screwAxis: { x: number; y: number },
  dx: number,
  dy: number,
  clearAt: number,
): 'nut' | 'screw' | null {
  const alongNut = Math.abs(dx * nutAxis.x + dy * nutAxis.y);
  const alongScrew = Math.abs(dx * screwAxis.x + dy * screwAxis.y);
  if (Math.max(alongNut, alongScrew) < clearAt) return null;
  if (alongNut >= alongScrew * INTENT_AXIS) return 'nut';
  if (alongScrew >= alongNut * INTENT_AXIS) return 'screw';
  return null;
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
};

/** `open` has not reached a piece. `watch` is the first piece in range, not locked. `choose` has two or more. */
export type Aim =
  | { phase: 'off' }
  | { phase: 'open'; x: number; y: number }
  | { phase: 'watch'; x: number; y: number; kind: 'nut' | 'screw'; id: string }
  | { phase: 'choose'; x: number; y: number };

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
 * A shaft with its own nut still in the finger radius locks that nut.
 * The point lands on the rod beside the nut more often than on the nut's slab.
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

/**
 * The leading slide axis wins when it leads by `INTENT_AXIS` and only one piece uses it.
 * Parallel pieces share an axis, so a stroke cannot name one of them.
 */
function trendLock(pieces: AimPiece[], dx: number, dy: number, clearAt: number): AimPiece | null {
  const clusters: { axis: { x: number; y: number }; pieces: AimPiece[]; along: number }[] = [];
  for (const piece of pieces) {
    const cluster = clusters.find((item) => axesParallel(item.axis, piece.axis));
    if (cluster) cluster.pieces.push(piece);
    else clusters.push({ axis: piece.axis, pieces: [piece], along: Math.abs(dx * piece.axis.x + dy * piece.axis.y) });
  }
  clusters.sort((a, b) => b.along - a.along);
  const best = clusters[0];
  const second = clusters[1]?.along ?? 0;
  if (!best || best.along < clearAt || best.along < second * INTENT_AXIS) return null;
  if (best.pieces.length !== 1) return null;
  return best.pieces[0];
}

function chooseLock(pieces: AimPiece[], x0: number, y0: number, x: number, y: number, clearAt: number): AimPiece | null {
  return outlineLock(pieces) ?? trendLock(pieces, x - x0, y - y0, clearAt);
}

/** A press on exactly one piece locks. Two or more wait. None stays open. */
export function pressAim(pieces: AimPiece[], x: number, y: number): { aim: Aim; lock: AimPiece | null } {
  const outlined = outlineLock(pieces);
  if (pieces.length === 0) return { aim: { phase: 'open', x, y }, lock: null };
  if (pieces.length === 1 || outlined) return { aim: { phase: 'off' }, lock: outlined ?? pieces[0] };
  return { aim: { phase: 'choose', x, y }, lock: null };
}

/**
 * Empty travel does not lock. The first piece in range is watched until its outline
 * is entered. A second piece switches to the gap rules. Dropping back to one piece
 * does not lock. After a lock the caller stops calling this.
 */
export function moveAim(aim: Aim, pieces: AimPiece[], x: number, y: number, clearAt: number): { aim: Aim; lock: AimPiece | null } {
  if (aim.phase === 'off') return { aim, lock: null };
  if (aim.phase === 'open') {
    if (pieces.length === 0) return { aim, lock: null };
    if (pieces.length === 1) {
      if (pieces[0].inside) return { aim: { phase: 'off' }, lock: pieces[0] };
      return { aim: { phase: 'watch', x: aim.x, y: aim.y, kind: pieces[0].kind, id: pieces[0].id }, lock: null };
    }
    const lock = chooseLock(pieces, aim.x, aim.y, x, y, clearAt);
    return { aim: lock ? { phase: 'off' } : { phase: 'choose', x: aim.x, y: aim.y }, lock };
  }
  if (aim.phase === 'watch') {
    if (pieces.length === 0) return { aim: { phase: 'open', x: aim.x, y: aim.y }, lock: null };
    if (pieces.length === 1) {
      const piece = pieces[0];
      if (!samePiece(piece, aim.kind, aim.id)) {
        if (piece.inside) return { aim: { phase: 'off' }, lock: piece };
        return { aim: { phase: 'watch', x: aim.x, y: aim.y, kind: piece.kind, id: piece.id }, lock: null };
      }
      if (piece.inside) return { aim: { phase: 'off' }, lock: piece };
      return { aim, lock: null };
    }
    const lock = chooseLock(pieces, aim.x, aim.y, x, y, clearAt);
    return { aim: lock ? { phase: 'off' } : { phase: 'choose', x: aim.x, y: aim.y }, lock };
  }
  const lock = chooseLock(pieces, aim.x, aim.y, x, y, clearAt);
  return { aim: lock ? { phase: 'off' } : aim, lock };
}
