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
/** Empty design pixels kept around the level, inside the chrome. */
export const FRAME_MARGIN = 24;
/**
 * Share of the usable rect the level is fitted into.
 * 0.9 is the normal framing: screws read 10% smaller than a tight fit.
 */
export const FIT_FILL = 0.9;
/** How far the fitted level sits above the usable center, when the frame has room. */
export const FRAME_LIFT = 48;

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

export type UsableRect = { left: number; top: number; right: number; bottom: number };

export type Frame = {
  minZoom: number;
  maxZoom: number;
  /** NDC of the usable rect's center. (0, 0) is the full design center. */
  nx: number;
  ny: number;
  /** World size of the usable rect when zoom is 1. */
  worldW: number;
  worldH: number;
};

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

export function frameFor(bounds: Aabb, usable: UsableRect): Frame {
  const { w, h } = viewSize();
  const widthPx = Math.max(usable.right - usable.left, 1);
  const heightPx = Math.max(usable.bottom - usable.top, 1);
  const worldW = (widthPx / DESIGN_WIDTH) * w;
  const worldH = (heightPx / DESIGN_HEIGHT) * h;
  const cx = (usable.left + usable.right) / 2;
  const cy = (usable.top + usable.bottom) / 2;
  const ndc = designNdc(cx, cy);
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-3);
  const minZoom = Math.min(worldW / bw, worldH / bh) * FIT_FILL;
  return { minZoom, maxZoom: minZoom, nx: ndc.x, ny: ndc.y, worldW, worldH };
}

/** World distance the fit may raise the level. Never enough to leave the usable rect. */
export function frameLift(bounds: Aabb, frame: Frame, zoom: number): number {
  const room = frame.worldH / 2 / zoom - (bounds.maxY - bounds.minY) / 2;
  const want = (FRAME_LIFT / DESIGN_HEIGHT) * viewSize().h / zoom;
  return Math.max(0, Math.min(want, room));
}

/** Camera x/y is the center of the full stage, not the usable rect. */
export function cameraForFit(bounds: Aabb, frame: Frame): { x: number; y: number; zoom: number } {
  const { w, h } = viewSize();
  const zoom = frame.minZoom;
  const ox = (frame.nx * (w / 2)) / zoom;
  const oy = (frame.ny * (h / 2)) / zoom;
  return {
    x: (bounds.minX + bounds.maxX) / 2 - ox,
    y: (bounds.minY + bounds.maxY) / 2 - oy - frameLift(bounds, frame, zoom),
    zoom,
  };
}
