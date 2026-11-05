/**
 * What happens after a piece leaves its track.
 *
 * Linear speed starts at 0. Gravity pulls world −Y. Nothing else pushes.
 * A nut spins on one world axis chosen at release and keeps that axis.
 * Speed grows along the axis, so the flip continues the way it started.
 * A screw turns in the screen plane toward its heavy side as it falls.
 * Its buckle does not spin.
 * The mesh is lifted toward the camera (+Z) by its own reach, then stacked,
 * so a tumble stays in front of pieces still on the board. Orthographic
 * zoom does not change with Z.
 * Left, right, and top are culled a full view past the edge. The bottom
 * is culled a short margin past the edge, because pieces fall that way.
 */

import * as THREE from 'three';

export const FALL_GRAVITY = 30;
/** World +Z where the first faller's near side starts. Camera is on +Z. */
export const FALL_FRONT = 0.45;
/** Gap between stacked fallers, past both reaches. */
export const FALL_LAYER_GAP = 0.08;
/** How far below the view the origin may travel before it is removed. */
export const FALL_BOTTOM_MARGIN = 0.8;

export type FallSpin = { axisX: number; axisY: number; axisZ: number; speed: number; accel: number };

export type FallMotion = FallSpin & { vy: number };

/**
 * Spin whose first move brings the open end of the shaft toward the camera.
 * `out` points from the dead end toward the open tip, in world XY.
 * Yaw is up to ±90°, plus a sideways component. Speed stays above 0.
 * For rim (cos θ, sin θ, 0), ω = (sin θ, −cos θ, 0) points that rim toward +Z.
 */
export function nutDepartureSpin(out: { x: number; y: number }): FallSpin {
  const len = Math.hypot(out.x, out.y) || 1;
  const theta = Math.atan2(out.y / len, out.x / len) + (Math.random() - 0.5) * Math.PI;
  const speed = 2.4 + Math.random() * 2.4;
  const side = (Math.random() - 0.5) * speed * 0.8;
  const wx = Math.sin(theta) * speed + Math.cos(theta) * side;
  const wy = -Math.cos(theta) * speed + Math.sin(theta) * side;
  const mag = Math.hypot(wx, wy) || 1;
  return { axisX: wx / mag, axisY: wy / mag, axisZ: 0, speed: mag, accel: 5 + Math.random() * 5 };
}

/**
 * Screen-plane spin. `heavy` is the center of mass relative to the anchor, in world XY.
 * The heavy side drops. A longer offset tips faster.
 */
export function screwDepartureSpin(heavy: { x: number; y: number }): FallSpin {
  const lever = Math.hypot(heavy.x, heavy.y);
  const sign = Math.abs(heavy.x) > 0.02 ? Math.sign(heavy.x) : Math.sign(heavy.y || 1);
  const speed = 1.4 + Math.min(2.4, lever * 1.6);
  return { axisX: 0, axisY: 0, axisZ: sign, speed, accel: 0.4 + Math.min(1.6, lever) };
}

/** Farthest corner of the world bounds from the mesh origin. Rotation stays inside it. */
export function pieceReach(mesh: THREE.Object3D): number {
  mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mesh);
  const origin = mesh.getWorldPosition(new THREE.Vector3());
  let reach = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        reach = Math.max(reach, Math.hypot(x - origin.x, y - origin.y, z - origin.z));
      }
    }
  }
  return Math.max(reach, 0.05);
}

/** Park `mesh` in front of the board. Returns the front value for the next piece. */
export function parkInFront(mesh: THREE.Object3D, front: number): number {
  const reach = pieceReach(mesh);
  mesh.position.z = front + reach;
  return front + reach * 2 + FALL_LAYER_GAP;
}

export function stillSpin(): FallSpin {
  return { axisX: 1, axisY: 0, axisZ: 0, speed: 0, accel: 0 };
}

export function stepFall(motion: FallMotion, dt: number): void {
  motion.vy += -FALL_GRAVITY * dt;
  motion.speed += motion.accel * dt;
}

export function fallPastView(
  x: number,
  y: number,
  view: { w: number; h: number },
  camera: { x: number; y: number; zoom: number },
): boolean {
  const zoom = Math.max(camera.zoom, 1e-4);
  const left = camera.x - view.w / 2 / zoom;
  const right = camera.x + view.w / 2 / zoom;
  const bottom = camera.y - view.h / 2 / zoom;
  const top = camera.y + view.h / 2 / zoom;
  return x < left - view.w || x > right + view.w || y > top + view.h || y < bottom - FALL_BOTTOM_MARGIN;
}
