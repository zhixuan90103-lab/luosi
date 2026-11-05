/**
 * Orthographic window onto the XY board.
 * The camera sits on +Z and looks toward −Z, so screen-right is world +X
 * and screen-up is world +Y. Design y grows downward; world y grows upward.
 * Zoom and pan live on the camera. This module is the only place that turns
 * a design point into that window.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import type { Board } from './board';
import { screwLocalBounds } from './parts';

export const VIEW_H = 10;
/** Default play and editor zoom. The camera does not refit each level. */
export const STAGE_ZOOM = 1.7;

let stageZoom = STAGE_ZOOM;
const zoomListeners = new Set<() => void>();

/** Live play zoom. The gear slider writes this. */
export function stageZoomValue(): number {
  return stageZoom;
}

export function setStageZoom(value: number): void {
  const next = Math.min(2.5, Math.max(0.4, value));
  if (next === stageZoom) return;
  stageZoom = next;
  for (const listener of zoomListeners) listener();
}

export function onStageZoom(listener: () => void): () => void {
  zoomListeners.add(listener);
  return () => zoomListeners.delete(listener);
}
export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

export function viewSize(): { w: number; h: number } {
  return { w: VIEW_H * (DESIGN_WIDTH / DESIGN_HEIGHT), h: VIEW_H };
}

/** Design pixel to NDC. (0, 0) is the top-left of the 390×844 stage. */
export function designNdc(dx: number, dy: number): { x: number; y: number } {
  return {
    x: (dx / DESIGN_WIDTH) * 2 - 1,
    y: -((dy / DESIGN_HEIGHT) * 2 - 1),
  };
}

export function designFromWorld(
  x: number,
  y: number,
  camX: number,
  camY: number,
  zoom: number,
): { x: number; y: number } {
  const { w, h } = viewSize();
  const z = Math.max(zoom, 1e-4);
  const ndcX = ((x - camX) * z) / (w / 2);
  const ndcY = ((y - camY) * z) / (h / 2);
  return {
    x: ((ndcX + 1) / 2) * DESIGN_WIDTH,
    y: ((1 - ndcY) / 2) * DESIGN_HEIGHT,
  };
}

export function worldFromDesign(
  dx: number,
  dy: number,
  camX: number,
  camY: number,
  zoom: number,
): { x: number; y: number } {
  const ndc = designNdc(dx, dy);
  const { w, h } = viewSize();
  const z = Math.max(zoom, 1e-4);
  return {
    x: camX + (ndc.x * (w / 2)) / z,
    y: camY + (ndc.y * (h / 2)) / z,
  };
}

export function boardBounds(board: Board): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const screw of board.screws) {
    const local = screwLocalBounds(screw.kind, screw.edges);
    const c = Math.cos(screw.theta);
    const s = Math.sin(screw.theta);
    for (const x of [local.minX, local.maxX]) {
      for (const y of [local.minY, local.maxY]) {
        add(screw.x + c * x - s * y, screw.y + s * x + c * y);
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}
