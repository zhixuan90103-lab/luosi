import type { NutBody, ScrewBody } from './board';
import {
  BUCKLE_LENGTH_SCALE,
  NUT_COLORS,
  SCREW,
  SCREW_CAP_HALF,
  THREAD_PITCH,
  buckleMetrics,
  screwLayout,
  type ScrewKind,
  type ScrewRun,
} from './parts';

/** Half the nut's length along the shaft. Same extrude as the mesh. */
export const NUT_HALF = SCREW_CAP_HALF;
/** How wide a nut blocks across the shaft. Vertex radius of the octagon. */
const NUT_ACROSS = SCREW.nut;
/** Pickup radius. A little outside the flats so a tap on the rim still grabs. */
const NUT_PICK = SCREW.nut + 0.01;

/** Half a flat per thread turn. A full flat still looked faster than the groove. */
export function nutSpin(t: number): number {
  return (t / THREAD_PITCH) * (Math.PI / 8);
}
const SHAFT_RADIUS = SCREW.width / 2;
/** Silver starts outside the rod. The hole is the shaft diameter. */
const HOLE_RADIUS = SHAFT_RADIUS;
const SLEEVE = buckleMetrics(SCREW.width, SCREW.straight * BUCKLE_LENGTH_SCALE);
const SLEEVE_HALF = SLEEVE.sleeveLen / 2;
const SLEEVE_HALF_W = SLEEVE.sleeveW / 2;
const GRIP_HALF = SLEEVE.gripSpan / 2;
const GRIP_HALF_W = SLEEVE.gripStick / 2;
const GRIP_ACROSS = SLEEVE_HALF_W + GRIP_HALF_W;
/** Touching is allowed. Overlap deeper than this is a hit. */
const SKIN = 0.001;
const HEAD_ACROSS = SCREW.head;

export function stockNuts(screws: ScrewBody[]): NutBody[] {
  const nuts: NutBody[] = [];
  for (const screw of screws) {
    const layout = screwLayout(screw.kind);
    let colorAt = 0;
    layout.runs.forEach((run, runIndex) => {
      const ordered = [...run.stations].sort((a, b) => (screw.kind === 'straight' ? a - b : b - a));
      ordered.forEach((t, n) => {
        nuts.push({
          id: `${screw.id}:${runIndex}:${n}`,
          screwId: screw.id,
          run: runIndex,
          t,
          color: NUT_COLORS[colorAt % NUT_COLORS.length],
        });
        colorAt += 1;
      });
    });
  }
  return nuts;
}

function screwOf(screws: ScrewBody[], id: string): ScrewBody | undefined {
  return screws.find((screw) => screw.id === id);
}

function runOf(kind: ScrewKind, index: number): ScrewRun {
  return screwLayout(kind).runs[index];
}

export function toWorld(screw: ScrewBody, x: number, y: number): { x: number; y: number } {
  const c = Math.cos(screw.theta);
  const s = Math.sin(screw.theta);
  return { x: screw.x + x * c - y * s, y: screw.y + x * s + y * c };
}

export function nutLocal(screw: ScrewBody, nut: NutBody): { x: number; y: number; dx: number; dy: number } {
  const run = runOf(screw.kind, nut.run);
  const dx = run.x1 - run.x0;
  const dy = run.y1 - run.y0;
  const length = Math.hypot(dx, dy) || 1;
  const u = nut.t / length;
  return { x: run.x0 + dx * u, y: run.y0 + dy * u, dx, dy };
}

export function nutWorld(screw: ScrewBody, nut: NutBody): { x: number; y: number } {
  const local = nutLocal(screw, nut);
  return toWorld(screw, local.x, local.y);
}

/** Shaft direction in world space, dead end toward the tip. */
export function nutAxis(screw: ScrewBody, nut: NutBody): { x: number; y: number } {
  const run = runOf(screw.kind, nut.run);
  const localX = run.x1 - run.x0;
  const localY = run.y1 - run.y0;
  const length = Math.hypot(localX, localY) || 1;
  const c = Math.cos(screw.theta);
  const s = Math.sin(screw.theta);
  return { x: (localX * c - localY * s) / length, y: (localX * s + localY * c) / length };
}

export function nutAt(nuts: NutBody[], screws: ScrewBody[], x: number, y: number): NutBody | null {
  let best: { nut: NutBody; distance: number } | null = null;
  for (const nut of nuts) {
    const screw = screwOf(screws, nut.screwId);
    if (!screw) continue;
    const at = nutWorld(screw, nut);
    const distance = Math.hypot(at.x - x, at.y - y);
    if (distance > NUT_PICK + 0.04) continue;
    if (!best || distance < best.distance) best = { nut, distance };
  }
  return best?.nut ?? null;
}

type Circle = { x: number; y: number; r: number };
type Slab = { x: number; y: number; ax: number; ay: number; halfAlong: number; halfAcross: number };
type Rect = { x: number; y: number; ax: number; ay: number; halfAlong: number; halfAcross: number; hole: boolean };

function pushSegment(out: Circle[], screw: ScrewBody, x0: number, y0: number, x1: number, y1: number): void {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.05));
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const at = toWorld(screw, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
    out.push({ x: at.x, y: at.y, r: SHAFT_RADIUS });
  }
}

function pushArc(out: Circle[], screw: ScrewBody, cx: number, cy: number, a0: number, a1: number): void {
  const steps = 10;
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const at = toWorld(screw, cx + Math.cos(a) * SCREW.bend, cy + Math.sin(a) * SCREW.bend);
    out.push({ x: at.x, y: at.y, r: SHAFT_RADIUS });
  }
}

/** Shaft and elbow centerlines. The head, nuts, and buckles are slabs, not fat circles. */
function tubeCircles(screw: ScrewBody): Circle[] {
  const out: Circle[] = [];
  const r = SCREW.bend;
  const leg = SCREW.leg;
  if (screw.kind === 'straight') {
    pushSegment(out, screw, 0, 0, SCREW.straight, 0);
  } else if (screw.kind === 'l') {
    pushSegment(out, screw, 0, -r, r + leg, -r);
    pushSegment(out, screw, -r, 0, -r, leg);
    pushArc(out, screw, 0, 0, -Math.PI / 2, -Math.PI);
  } else {
    const pitch = SCREW.span + r * 2;
    pushSegment(out, screw, 0, 0, 0, leg);
    pushSegment(out, screw, r, -r, r + SCREW.span, -r);
    pushSegment(out, screw, pitch, 0, pitch, leg);
    pushArc(out, screw, r, 0, Math.PI, Math.PI * 1.5);
    pushArc(out, screw, r + SCREW.span, 0, -Math.PI / 2, 0);
  }
  return out;
}

function elbowCircles(screw: ScrewBody): Circle[] {
  if (screw.kind === 'straight') return [];
  const out: Circle[] = [];
  const r = SCREW.bend;
  if (screw.kind === 'l') pushArc(out, screw, 0, 0, -Math.PI / 2, -Math.PI);
  else {
    pushArc(out, screw, r, 0, Math.PI, Math.PI * 1.5);
    pushArc(out, screw, r + SCREW.span, 0, -Math.PI / 2, 0);
  }
  return out;
}

function capSlab(at: { x: number; y: number }, axis: { x: number; y: number }, halfAcross: number): Slab {
  return { x: at.x, y: at.y, ax: axis.x, ay: axis.y, halfAlong: SCREW_CAP_HALF, halfAcross };
}

/** Head and the nuts still on this screw. Each nut's long axis is its own run. */
function capSlabs(screw: ScrewBody, nuts: NutBody[]): Slab[] {
  const slabs: Slab[] = [];
  if (screw.kind === 'straight') slabs.push(capSlab(toWorld(screw, 0, 0), screwSlideAxis(screw), HEAD_ACROSS));
  for (const nut of nuts) {
    if (nut.screwId !== screw.id) continue;
    slabs.push(capSlab(nutWorld(screw, nut), nutAxis(screw, nut), NUT_ACROSS));
  }
  return slabs;
}

/** Sleeve plus the two grips. `hole` is the slot the screw's own straight rod may occupy. */
function buckleRects(screw: ScrewBody): Rect[] {
  const axis = screwSlideAxis(screw);
  const rects: Rect[] = [];
  for (const lock of screw.locks ?? []) {
    rects.push({
      x: lock.x,
      y: lock.y,
      ax: axis.x,
      ay: axis.y,
      halfAlong: SLEEVE_HALF,
      halfAcross: SLEEVE_HALF_W,
      hole: true,
    });
    for (const side of [-1, 1]) {
      const across = side * GRIP_ACROSS;
      rects.push({
        x: lock.x + -axis.y * across,
        y: lock.y + axis.x * across,
        ax: axis.x,
        ay: axis.y,
        halfAlong: GRIP_HALF,
        halfAcross: GRIP_HALF_W,
        hole: false,
      });
    }
  }
  return rects;
}

function frameOf(rect: { x: number; y: number; ax: number; ay: number }, x: number, y: number): { along: number; across: number } {
  const dx = x - rect.x;
  const dy = y - rect.y;
  return { along: dx * rect.ax + dy * rect.ay, across: dx * -rect.ay + dy * rect.ax };
}

function circleHitsRect(circle: Circle, rect: Rect, ownHole: boolean): boolean {
  const { along, across } = frameOf(rect, circle.x, circle.y);
  if (ownHole && rect.hole && Math.abs(across) + circle.r <= HOLE_RADIUS + SKIN) return false;
  const a = Math.abs(along) - rect.halfAlong;
  const c = Math.abs(across) - rect.halfAcross;
  return Math.hypot(Math.max(0, a), Math.max(0, c)) < circle.r - SKIN;
}

function slabHitsRect(slab: Slab, rect: Rect): boolean {
  const dx = rect.x - slab.x;
  const dy = rect.y - slab.y;
  const axes = [
    { x: slab.ax, y: slab.ay },
    { x: -slab.ay, y: slab.ax },
    { x: rect.ax, y: rect.ay },
    { x: -rect.ay, y: rect.ax },
  ];
  for (const axis of axes) {
    const dist = Math.abs(dx * axis.x + dy * axis.y);
    const reach =
      Math.abs(slab.halfAlong * (slab.ax * axis.x + slab.ay * axis.y)) +
      Math.abs(slab.halfAcross * (-slab.ay * axis.x + slab.ax * axis.y)) +
      Math.abs(rect.halfAlong * (rect.ax * axis.x + rect.ay * axis.y)) +
      Math.abs(rect.halfAcross * (-rect.ay * axis.x + rect.ax * axis.y));
    if (dist > reach - SKIN) return false;
  }
  return true;
}

function circlesHit(a: Circle, b: Circle): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - SKIN;
}

function circleHitsSlab(circle: Circle, slab: Slab): boolean {
  const { along, across } = frameOf(slab, circle.x, circle.y);
  const a = Math.abs(along) - slab.halfAlong;
  const c = Math.abs(across) - slab.halfAcross;
  return Math.hypot(Math.max(0, a), Math.max(0, c)) < circle.r - SKIN;
}

/** Own head, nuts, and elbow tube against this screw's sleeve and grips. The straight rod may stay in the hole. */
function hitsOwnBuckle(screw: ScrewBody, nuts: NutBody[]): boolean {
  const rects = buckleRects(screw);
  if (rects.length === 0) return false;
  for (const slab of capSlabs(screw, nuts)) {
    if (rects.some((rect) => slabHitsRect(slab, rect))) return true;
  }
  for (const elbow of elbowCircles(screw)) {
    if (rects.some((rect) => circleHitsRect(elbow, rect, true))) return true;
  }
  return false;
}

function hitsForeign(screw: ScrewBody, nuts: NutBody[], screws: ScrewBody[]): boolean {
  const tubes = tubeCircles(screw);
  const slabs = capSlabs(screw, nuts);
  for (const other of screws) {
    if (other.id === screw.id) continue;
    const foreignTubes = tubeCircles(other);
    const foreignSlabs = capSlabs(other, nuts);
    const foreignRects = buckleRects(other);
    for (const tube of tubes) {
      if (foreignTubes.some((otherTube) => circlesHit(tube, otherTube))) return true;
      if (foreignSlabs.some((slab) => circleHitsSlab(tube, slab))) return true;
      if (foreignRects.some((rect) => circleHitsRect(tube, rect, false))) return true;
    }
    for (const slab of slabs) {
      if (foreignTubes.some((tube) => circleHitsSlab(tube, slab))) return true;
      if (foreignSlabs.some((otherSlab) => slabHitsRect(slab, { ...otherSlab, hole: false }))) return true;
      if (foreignRects.some((rect) => slabHitsRect(slab, rect))) return true;
    }
  }
  return false;
}

function poseBlocked(screw: ScrewBody, nuts: NutBody[], screws: ScrewBody[]): boolean {
  return hitsOwnBuckle(screw, nuts) || hitsForeign(screw, nuts, screws);
}

/**
 * Slide one nut along its run. Both ways follow the finger.
 * The open tip drops the nut. The dead end, a neighbour nut, or another screw stops it.
 */
export function slideNut(
  nuts: NutBody[],
  screws: ScrewBody[],
  id: string,
  target: number,
): { blocked: boolean; exited: boolean } {
  const nut = nuts.find((item) => item.id === id);
  const screw = nut ? screwOf(screws, nut.screwId) : undefined;
  if (!nut || !screw) return { blocked: false, exited: false };
  const run = runOf(screw.kind, nut.run);
  const length = Math.hypot(run.x1 - run.x0, run.y1 - run.y0);
  const clearAt = length + SHAFT_RADIUS + NUT_HALF;
  let lo = run.minT;
  let hi = clearAt;
  for (const other of nuts) {
    if (other.id === nut.id || other.screwId !== nut.screwId || other.run !== nut.run) continue;
    if (other.t < nut.t) lo = Math.max(lo, other.t + NUT_HALF * 2);
    else hi = Math.min(hi, other.t - NUT_HALF * 2);
  }
  const wanted = Math.min(hi, Math.max(lo, target));
  const from = nut.t;
  const dir = Math.sign(wanted - from);
  if (dir === 0) return { blocked: false, exited: false };
  let safe = from;
  let blocked = false;
  const steps = Math.max(1, Math.ceil(Math.abs(wanted - from) / 0.02));
  for (let i = 1; i <= steps; i += 1) {
    const t = from + ((wanted - from) * i) / steps;
    const probe = { ...nut, t };
    const at = nutWorld(screw, probe);
    const slab = capSlab(at, nutAxis(screw, probe), NUT_ACROSS);
    const ownBuckle = buckleRects(screw).some((rect) => slabHitsRect(slab, rect));
    let foreign = false;
    if (!ownBuckle) {
      for (const other of screws) {
        if (other.id === screw.id) continue;
        if (tubeCircles(other).some((tube) => circleHitsSlab(tube, slab))) {
          foreign = true;
          break;
        }
        if (capSlabs(other, nuts).some((otherSlab) => slabHitsRect(slab, { ...otherSlab, hole: false }))) {
          foreign = true;
          break;
        }
        if (buckleRects(other).some((rect) => slabHitsRect(slab, rect))) {
          foreign = true;
          break;
        }
      }
    }
    if (ownBuckle || foreign) {
      let loT = safe;
      let hiT = t;
      for (let n = 0; n < 10; n += 1) {
        const mid = (loT + hiT) / 2;
        const midNut = { ...nut, t: mid };
        const midAt = nutWorld(screw, midNut);
        const midSlab = capSlab(midAt, nutAxis(screw, midNut), NUT_ACROSS);
        const hit =
          buckleRects(screw).some((rect) => slabHitsRect(midSlab, rect)) ||
          screws.some((other) => {
            if (other.id === screw.id) return false;
            return (
              tubeCircles(other).some((tube) => circleHitsSlab(tube, midSlab)) ||
              capSlabs(other, nuts).some((otherSlab) => slabHitsRect(midSlab, { ...otherSlab, hole: false })) ||
              buckleRects(other).some((rect) => slabHitsRect(midSlab, rect))
            );
          });
        if (hit) hiT = mid;
        else loT = mid;
      }
      safe = loT;
      blocked = true;
      break;
    }
    safe = t;
  }
  nut.t = safe;
  if (safe >= clearAt - 1e-3) {
    const index = nuts.indexOf(nut);
    if (index >= 0) nuts.splice(index, 1);
    return { blocked: false, exited: true };
  }
  return { blocked: blocked || Math.abs(safe - target) > 0.02, exited: false };
}

/** Axis the screw slides on, the same way a capsule bar slides through its buckle. */
export function screwSlideAxis(screw: ScrewBody): { x: number; y: number } {
  const local = screw.kind === 'u' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const c = Math.cos(screw.theta);
  const s = Math.sin(screw.theta);
  return { x: local.x * c - local.y * s, y: local.x * s + local.y * c };
}

/** Remember buckle positions in world space before the screw starts sliding. */
export function pinLocks(screw: ScrewBody): void {
  if (screw.locks && screw.locks.length > 0) return;
  screw.locks = screwLayout(screw.kind).buckles.map((buckle) => toWorld(screw, buckle.x, buckle.y));
}

function shaftSegments(screw: ScrewBody): { ax: number; ay: number; bx: number; by: number }[] {
  const r = SCREW.bend;
  const leg = SCREW.leg;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const a = toWorld(screw, x0, y0);
    const b = toWorld(screw, x1, y1);
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  };
  if (screw.kind === 'straight') return [line(0, 0, SCREW.straight, 0)];
  if (screw.kind === 'l') return [line(0, -r, r + leg, -r), line(-r, 0, -r, leg)];
  const pitch = SCREW.span + r * 2;
  return [line(0, 0, 0, leg), line(r, -r, r + SCREW.span, -r), line(pitch, 0, pitch, leg)];
}

/** True while any of this screw's sleeves still contains its rod, head, bend, or a nut. */
export function screwHeld(screw: ScrewBody, nuts: NutBody[]): boolean {
  const sleeves = buckleRects(screw).filter((rect) => rect.hole);
  if (sleeves.length === 0) return false;
  for (const tube of tubeCircles(screw)) {
    for (const sleeve of sleeves) {
      const { along, across } = frameOf(sleeve, tube.x, tube.y);
      if (Math.abs(across) <= HOLE_RADIUS + SKIN && Math.abs(along) <= SLEEVE_HALF + SHAFT_RADIUS) return true;
    }
  }
  return hitsOwnBuckle(screw, nuts);
}

export function screwAt(screws: ScrewBody[], nuts: NutBody[], x: number, y: number): ScrewBody | null {
  if (nutAt(nuts, screws, x, y)) return null;
  let best: { screw: ScrewBody; distance: number } | null = null;
  for (const screw of screws) {
    let distance = Infinity;
    if (screw.kind === 'straight') {
      const head = toWorld(screw, 0, 0);
      distance = Math.min(distance, Math.hypot(head.x - x, head.y - y) - HEAD_ACROSS);
    }
    for (const seg of shaftSegments(screw)) {
      const abx = seg.bx - seg.ax;
      const aby = seg.by - seg.ay;
      const len2 = abx * abx + aby * aby || 1;
      const t = Math.max(0, Math.min(1, ((x - seg.ax) * abx + (y - seg.ay) * aby) / len2));
      const px = seg.ax + abx * t;
      const py = seg.ay + aby * t;
      distance = Math.min(distance, Math.hypot(px - x, py - y) - SHAFT_RADIUS);
    }
    for (const lock of screw.locks ?? []) {
      distance = Math.min(distance, Math.hypot(lock.x - x, lock.y - y) - SLEEVE_HALF_W);
    }
    if (distance > 0.06) continue;
    if (!best || distance < best.distance) best = { screw, distance };
  }
  return best?.screw ?? null;
}

/** Slide the screw along its buckle. Other screws stop it. Returns how far it actually moved. */
export function slideScrew(
  screws: ScrewBody[],
  nuts: NutBody[],
  id: string,
  dx: number,
  dy: number,
): { blocked: boolean } {
  const screw = screwOf(screws, id);
  if (!screw) return { blocked: false };
  const axis = screwSlideAxis(screw);
  const along = dx * axis.x + dy * axis.y;
  if (Math.abs(along) < 1e-5) return { blocked: false };
  const originX = screw.x;
  const originY = screw.y;
  const dir = Math.sign(along);
  const dist = Math.abs(along);
  const place = (travel: number) => {
    screw.x = originX + axis.x * dir * travel;
    screw.y = originY + axis.y * dir * travel;
  };
  const steps = Math.max(1, Math.ceil(dist / 0.02));
  let clear = 0;
  for (let i = 1; i <= steps; i += 1) {
    const travel = (dist * i) / steps;
    place(travel);
    if (!poseBlocked(screw, nuts, screws)) {
      clear = travel;
      continue;
    }
    let lo = clear;
    let hi = travel;
    for (let n = 0; n < 12; n += 1) {
      const mid = (lo + hi) / 2;
      place(mid);
      if (poseBlocked(screw, nuts, screws)) hi = mid;
      else lo = mid;
    }
    place(lo);
    return { blocked: true };
  }
  place(dist);
  return { blocked: false };
}

