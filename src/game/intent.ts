/**
 * Feel distances and which piece a press means.
 * Contact outlines stay in `screws.ts`. Nothing here shrinks a head, nut, or buckle.
 * One piece locks immediately. Two pieces whose slide axes differ wait for a
 * short stroke, then follow the axis the finger moved along.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import { VIEW_H } from './camera';

/** Along-axis travel, as a fraction of design width, before the stroke may choose. */
export const INTENT_CLEAR = 0.01;
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
