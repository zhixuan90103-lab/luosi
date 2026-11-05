import type { NutBody, ScrewBody } from './board';
import {
  NUT_COLORS,
  PART,
  SCREW,
  SCREW_CAP_HALF,
  SHAFT_CORE,
  SHAFT_RADIUS,
  THREAD_PITCH,
  buckleShape,
  headSilhouette,
  nutSilhouette,
  authoredLayout,
  keptBuckleT,
  screwLayout,
  shapeRuns,
  screwSpans,
  type ScrewKind,
  type ScrewLayout,
  type ScrewRun,
} from './parts';

/** Half the nut's length along the shaft. Same extrude as the mesh. */
export const NUT_HALF = SCREW_CAP_HALF;


/** Half a flat per thread turn. A full flat still looked faster than the groove. */
export function nutSpin(t: number): number {
  return (t / THREAD_PITCH) * (Math.PI / 8);
}
/** Silver starts outside the rod. The hole matches the thread crest. */
const HOLE_RADIUS = SHAFT_RADIUS;
const SLEEVE = buckleShape(PART.depth * PART.scale);
const SLEEVE_HALF = SLEEVE.sleeveLen / 2;
const SLEEVE_HALF_W = SLEEVE.sleeveW / 2;
const GRIP_HALF = SLEEVE.gripSpan / 2;
const GRIP_HALF_W = SLEEVE.gripStick / 2;
const GRIP_ACROSS = SLEEVE_HALF_W + GRIP_HALF_W;
/** Touching is allowed. Overlap deeper than this is a hit. */
const SKIN = 0.001;


export function stockNuts(screws: ScrewBody[]): NutBody[] {
  const nuts: NutBody[] = [];
  for (const screw of screws) {
    const layout = seatedLayout(screw.kind);
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

function layoutOf(screw: ScrewBody): ScrewLayout {
  if (screw.edges && screw.buckleT) return authoredLayout(screw.kind, screw.edges, screw.buckleT);
  return seatedLayout(screw.kind);
}

function runOf(screw: ScrewBody, index: number): ScrewRun {
  return layoutOf(screw).runs[index];
}

export function toWorld(screw: ScrewBody, x: number, y: number): { x: number; y: number } {
  const c = Math.cos(screw.theta);
  const s = Math.sin(screw.theta);
  return { x: screw.x + x * c - y * s, y: screw.y + x * s + y * c };
}

export function nutLocal(screw: ScrewBody, nut: NutBody): { x: number; y: number; dx: number; dy: number } {
  const run = runOf(screw, nut.run);
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
  const run = runOf(screw, nut.run);
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
    const distance = nutOutlineDistance(screw, nut, x, y);
    if (distance > 0) continue;
    const center = Math.hypot(nutSlab(screw, nut).x - x, nutSlab(screw, nut).y - y);
    if (!best || center < best.distance) best = { nut, distance: center };
  }
  return best?.nut ?? null;
}

type Circle = { x: number; y: number; r: number };
type Slab = { x: number; y: number; ax: number; ay: number; halfAlong: number; halfAcross: number };
type Rect = {
  x: number;
  y: number;
  ax: number;
  ay: number;
  halfAlong: number;
  halfAcross: number;
  /** Round corner, the same radius as the bar mesh. */
  radius: number;
  hole: boolean;
};

function pushSegment(out: Circle[], screw: ScrewBody, x0: number, y0: number, x1: number, y1: number): void {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.05));
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const at = toWorld(screw, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
    out.push({ x: at.x, y: at.y, r: SHAFT_CORE });
  }
}

function pushArc(out: Circle[], screw: ScrewBody, cx: number, cy: number, a0: number, a1: number): void {
  const steps = 10;
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const at = toWorld(screw, cx + Math.cos(a) * SCREW.bend, cy + Math.sin(a) * SCREW.bend);
    out.push({ x: at.x, y: at.y, r: SHAFT_CORE });
  }
}

/** Shaft and elbow centerlines. The head, nuts, and buckles are slabs, not fat circles. */
function tubeCircles(screw: ScrewBody): Circle[] {
  const out: Circle[] = [];
  for (const span of screwSpans(screw.kind, screw.edges)) {
    if (span.kind === 'line') pushSegment(out, screw, span.x0, span.y0, span.x1, span.y1);
    else pushArc(out, screw, span.cx, span.cy, span.a0, span.a1);
  }
  return out;
}

/** Straight runs in world space. The barrel is this capsule; metal past it is the bend. */
function straightEnds(screw: ScrewBody): { x0: number; y0: number; x1: number; y1: number }[] {
  const lines: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const span of screwSpans(screw.kind, screw.edges)) {
    if (span.kind !== 'line') continue;
    const a = toWorld(screw, span.x0, span.y0);
    const b = toWorld(screw, span.x1, span.y1);
    lines.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
  }
  return lines;
}

function inBarrel(screw: ScrewBody, x: number, y: number): boolean {
  for (const seg of straightEnds(screw)) {
    const dx = seg.x1 - seg.x0;
    const dy = seg.y1 - seg.y0;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((x - seg.x0) * dx + (y - seg.y0) * dy) / len2));
    const qx = seg.x0 + t * dx;
    const qy = seg.y0 + t * dy;
    if (Math.hypot(x - qx, y - qy) <= SHAFT_CORE + SKIN) return true;
  }
  return false;
}

/** Bend metal against the buckle. Points that still lie in the straight barrel may enter the hole. */
function bendHitsRect(screw: ScrewBody, circle: Circle, rect: Rect): boolean {
  const steps = 24;
  for (let ring = 1; ring <= 2; ring += 1) {
    const radius = (circle.r * ring) / 2;
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      const x = circle.x + Math.cos(angle) * radius;
      const y = circle.y + Math.sin(angle) * radius;
      if (inBarrel(screw, x, y)) continue;
      const { along, across } = frameOf(rect, x, y);
      if (rect.hole && Math.abs(across) <= HOLE_RADIUS + SKIN) continue;
      if (roundedRectDistance(along, across, rect) <= 0) return true;
    }
  }
  return false;
}

function elbowCircles(screw: ScrewBody): Circle[] {
  const out: Circle[] = [];
  for (const span of screwSpans(screw.kind, screw.edges)) {
    if (span.kind === 'arc') pushArc(out, screw, span.cx, span.cy, span.a0, span.a1);
  }
  return out;
}

function capSlab(at: { x: number; y: number }, axis: { x: number; y: number }, halfAcross: number, halfAlong = SCREW_CAP_HALF): Slab {
  return { x: at.x, y: at.y, ax: axis.x, ay: axis.y, halfAlong, halfAcross };
}

/** Slab that covers the nut mesh, including the bevel shift and the current spin. */
function nutSlab(screw: ScrewBody, nut: NutBody): Slab {
  const silhouette = nutSilhouette(nutSpin(nut.t));
  const at = nutWorld(screw, nut);
  const axis = nutAxis(screw, nut);
  return capSlab(
    { x: at.x + axis.x * silhouette.shift, y: at.y + axis.y * silhouette.shift },
    axis,
    silhouette.halfAcross,
    silhouette.halfAlong,
  );
}

/** Head and the nuts still on this screw. Each nut's long axis is its own run. */
function capSlabs(screw: ScrewBody, nuts: NutBody[]): Slab[] {
  const slabs: Slab[] = [];
  if (screw.kind === 'straight') {
    const head = headSilhouette();
    const axis = screwSlideAxis(screw);
    const origin = toWorld(screw, 0, 0);
    slabs.push(capSlab(
      { x: origin.x + axis.x * head.shift, y: origin.y + axis.y * head.shift },
      axis,
      head.halfAcross,
      head.halfAlong,
    ));
  }
  for (const nut of nuts) {
    if (nut.screwId !== screw.id) continue;
    slabs.push(nutSlab(screw, nut));
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
      radius: SLEEVE.sleeveCorner,
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
        radius: SLEEVE.gripCorner,
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

/** Signed distance to a rounded rectangle. Negative means inside. */
function roundedRectDistance(along: number, across: number, rect: Rect): number {
  const rad = Math.min(rect.radius, rect.halfAlong, rect.halfAcross);
  const a = Math.abs(along) - (rect.halfAlong - rad);
  const c = Math.abs(across) - (rect.halfAcross - rad);
  return Math.hypot(Math.max(a, 0), Math.max(c, 0)) + Math.min(Math.max(a, c), 0) - rad;
}

function circleHitsRect(circle: Circle, rect: Rect, ownHole: boolean): boolean {
  const { along, across } = frameOf(rect, circle.x, circle.y);
  if (ownHole && rect.hole && Math.abs(across) + circle.r <= HOLE_RADIUS + SKIN) return false;
  return roundedRectDistance(along, across, rect) < circle.r - SKIN;
}

function slabHitsRect(slab: Slab, rect: Rect): boolean {
  const dx = rect.x - slab.x;
  const dy = rect.y - slab.y;
  const rad = Math.min(rect.radius, rect.halfAlong, rect.halfAcross);
  const innerAlong = rect.halfAlong - rad;
  const innerAcross = rect.halfAcross - rad;
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
      Math.abs(innerAlong * (rect.ax * axis.x + rect.ay * axis.y)) +
      Math.abs(innerAcross * (-rect.ay * axis.x + rect.ax * axis.y)) +
      rad;
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
    if (rects.some((rect) => bendHitsRect(screw, elbow, rect))) return true;
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
      if (foreignSlabs.some((otherSlab) => slabHitsRect(slab, { ...otherSlab, radius: 0, hole: false }))) return true;
      if (foreignRects.some((rect) => slabHitsRect(slab, rect))) return true;
    }
  }
  return false;
}

const seatCache = new Map<ScrewKind, ScrewLayout>();

function seatScrew(kind: ScrewKind, locks: { x: number; y: number }[]): ScrewBody {
  return { id: 'seat', kind, x: 0, y: 0, theta: 0, locks };
}

/** Move the buckle along its run until the real outlines are just touching. */
function placeBuckles(kind: ScrewKind, layout: ScrewLayout): { x: number; y: number }[] {
  return layout.buckles.map((nominal) => {
    let run = layout.runs[0];
    let best = Infinity;
    for (const candidate of layout.runs) {
      const dx = candidate.x1 - candidate.x0;
      const dy = candidate.y1 - candidate.y0;
      const len = Math.hypot(dx, dy) || 1;
      const along = ((nominal.x - candidate.x0) * dx + (nominal.y - candidate.y0) * dy) / len;
      const across = Math.abs((nominal.x - candidate.x0) * -dy + (nominal.y - candidate.y0) * dx) / len;
      const miss = across + Math.max(0, -along);
      if (miss < best) {
        best = miss;
        run = candidate;
      }
    }
    const dx = run.x1 - run.x0;
    const dy = run.y1 - run.y0;
    const len = Math.hypot(dx, dy) || 1;
    const ax = dx / len;
    const ay = dy / len;
    let lo = 0;
    let hi = len;
    for (let step = 0; step < 28; step += 1) {
      const mid = (lo + hi) / 2;
      const lock = { x: run.x0 + ax * mid, y: run.y0 + ay * mid };
      if (hitsOwnBuckle(seatScrew(kind, [lock]), [])) lo = mid;
      else hi = mid;
    }
    return { x: run.x0 + ax * hi, y: run.y0 + ay * hi };
  });
}

/** Closest nut center whose outline does not enter the buckle. */
function clearNutT(kind: ScrewKind, locks: { x: number; y: number }[], index: number, run: ScrewRun): number {
  const screw = seatScrew(kind, locks);
  const length = Math.hypot(run.x1 - run.x0, run.y1 - run.y0);
  const hit = (t: number) => {
    const nut: NutBody = { id: 'seat-nut', screwId: screw.id, run: index, t, color: 0 };
    return nutBlocked(screw, [nut], [screw], nut);
  };
  const dx = run.x1 - run.x0;
  const dy = run.y1 - run.y0;
  const span = Math.hypot(dx, dy) || 1;
  const onThisRun = locks.some((lock) => {
    const along = ((lock.x - run.x0) * dx + (lock.y - run.y0) * dy) / span;
    const across = Math.abs((lock.x - run.x0) * -dy + (lock.y - run.y0) * dx) / span;
    return across < 0.05 && along >= -0.01 && along <= span;
  });
  if (!onThisRun) return run.minT;
  if (!hit(0)) return 0;
  let lo = 0;
  let hi = length;
  for (let step = 0; step < 28; step += 1) {
    const mid = (lo + hi) / 2;
    if (hit(mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Buckle seats and nut limits from the contact test, one answer per screw kind. */
export function seatedLayout(kind: ScrewKind): ScrewLayout {
  const cached = seatCache.get(kind);
  if (cached) return cached;
  const layout = screwLayout(kind);
  layout.buckles = placeBuckles(kind, layout);
  seatCache.set(kind, layout);
  layout.runs.forEach((run, index) => {
    run.minT = clearNutT(kind, layout.buckles, index, run);
  });
  return layout;
}

function poseBlocked(screw: ScrewBody, nuts: NutBody[], screws: ScrewBody[]): boolean {
  return hitsOwnBuckle(screw, nuts) || hitsForeign(screw, nuts, screws);
}

/** A nut slab against its own buckle and every other screw. The straight rod is not a nut. */
function nutBlocked(screw: ScrewBody, nuts: NutBody[], screws: ScrewBody[], nut: NutBody): boolean {
  const slab = nutSlab(screw, nut);
  if (buckleRects(screw).some((rect) => slabHitsRect(slab, rect))) return true;
  for (const other of screws) {
    if (other.id === screw.id) continue;
    if (tubeCircles(other).some((tube) => circleHitsSlab(tube, slab))) return true;
    if (capSlabs(other, nuts).some((otherSlab) => slabHitsRect(slab, { ...otherSlab, radius: 0, hole: false }))) return true;
    if (buckleRects(other).some((rect) => slabHitsRect(slab, rect))) return true;
  }
  return false;
}

/** Distance along the run where the nut's back edge is past the round tip. */
export function nutClearAt(screw: ScrewBody, nut: NutBody): number {
  const run = runOf(screw, nut.run);
  const length = Math.hypot(run.x1 - run.x0, run.y1 - run.y0);
  return length + SHAFT_RADIUS + NUT_HALF;
}

/** The nut is off the shaft, still held on the same axis until the finger lifts. */
export function nutPastTip(screw: ScrewBody, nut: NutBody): boolean {
  return nut.t >= nutClearAt(screw, nut) - 1e-3;
}

/**
 * Slide one nut along its run, and past the tip on that same line.
 * The dead end, a neighbour nut, or another screw stops it. The tip does not.
 */
export function slideNut(
  nuts: NutBody[],
  screws: ScrewBody[],
  id: string,
  target: number,
): { blocked: boolean } {
  const nut = nuts.find((item) => item.id === id);
  const screw = nut ? screwOf(screws, nut.screwId) : undefined;
  if (!nut || !screw) return { blocked: false };
  const run = runOf(screw, nut.run);
  let lo = run.minT;
  let hi = Number.POSITIVE_INFINITY;
  for (const other of nuts) {
    if (other.id === nut.id || other.screwId !== nut.screwId || other.run !== nut.run) continue;
    if (other.t < nut.t) lo = Math.max(lo, other.t + NUT_HALF * 2);
    else hi = Math.min(hi, other.t - NUT_HALF * 2);
  }
  const wanted = Math.min(hi, Math.max(lo, target));
  const from = nut.t;
  const dir = Math.sign(wanted - from);
  if (dir === 0) return { blocked: false };
  let safe = from;
  let blocked = false;
  const steps = Math.max(1, Math.ceil(Math.abs(wanted - from) / 0.02));
  for (let i = 1; i <= steps; i += 1) {
    const t = from + ((wanted - from) * i) / steps;
    const probe = { ...nut, t };
    if (nutBlocked(screw, nuts, screws, probe)) {
      let loT = safe;
      let hiT = t;
      for (let n = 0; n < 10; n += 1) {
        const mid = (loT + hiT) / 2;
        if (nutBlocked(screw, nuts, screws, { ...nut, t: mid })) hiT = mid;
        else loT = mid;
      }
      safe = loT;
      blocked = true;
      break;
    }
    safe = t;
  }
  nut.t = safe;
  return { blocked: blocked || Math.abs(safe - target) > 0.02 };
}

/** Local direction of the straight edge that still has a buckle. */
function slideLocal(screw: ScrewBody): { x: number; y: number } {
  if (screw.edges && screw.buckleT) {
    const runs = shapeRuns(screw.kind, screw.edges);
    for (let index = 0; index < runs.length; index += 1) {
      if (keptBuckleT(screw.kind, index, screw.buckleT[index]) == null) continue;
      const run = runs[index];
      const dx = run.x1 - run.x0;
      const dy = run.y1 - run.y0;
      const length = Math.hypot(dx, dy) || 1;
      return { x: dx / length, y: dy / length };
    }
  }
  return screw.kind === 'u' ? { x: 0, y: 1 } : { x: 1, y: 0 };
}

/** Axis the screw slides on. The hole follows the edge that still holds a buckle. */
export function screwSlideAxis(screw: ScrewBody): { x: number; y: number } {
  const local = slideLocal(screw);
  const c = Math.cos(screw.theta);
  const s = Math.sin(screw.theta);
  return { x: local.x * c - local.y * s, y: local.x * s + local.y * c };
}

/** Remember buckle positions in world space before the screw starts sliding. */
export function pinLocks(screw: ScrewBody): void {
  if (screw.locks && screw.locks.length > 0) return;
  const buckles = screw.edges && screw.buckleT
    ? authoredLayout(screw.kind, screw.edges, screw.buckleT).buckles
    : seatedLayout(screw.kind).buckles;
  screw.locks = buckles.map((buckle) => toWorld(screw, buckle.x, buckle.y));
}

function shaftSegments(screw: ScrewBody): { ax: number; ay: number; bx: number; by: number }[] {
  return straightEnds(screw).map((seg) => ({ ax: seg.x0, ay: seg.y0, bx: seg.x1, by: seg.y1 }));
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

function toLocal(screw: ScrewBody, x: number, y: number): { x: number; y: number } {
  const dx = x - screw.x;
  const dy = y - screw.y;
  const c = Math.cos(screw.theta);
  const s = Math.sin(screw.theta);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

function headSlab(screw: ScrewBody): Slab {
  const head = headSilhouette();
  const axis = screwSlideAxis(screw);
  const origin = toWorld(screw, 0, 0);
  return {
    x: origin.x + axis.x * head.shift,
    y: origin.y + axis.y * head.shift,
    ax: axis.x,
    ay: axis.y,
    halfAlong: head.halfAlong,
    halfAcross: head.halfAcross,
  };
}

type Arc = { cx: number; cy: number; a0: number; a1: number };

function bendArcs(screw: ScrewBody): Arc[] {
  const arcs: Arc[] = [];
  for (const span of screwSpans(screw.kind, screw.edges)) {
    if (span.kind === 'arc') arcs.push({ cx: span.cx, cy: span.cy, a0: span.a0, a1: span.a1 });
  }
  return arcs;
}

function angleOnArc(angle: number, arc: Arc): boolean {
  const sweep = arc.a1 - arc.a0;
  const turn = Math.PI * 2;
  let delta = angle - arc.a0;
  if (sweep >= 0) {
    delta = ((delta % turn) + turn) % turn;
    return delta <= sweep + 1e-4;
  }
  delta = (((-delta) % turn) + turn) % turn;
  return delta <= -sweep + 1e-4;
}

function distToArc(x: number, y: number, arc: Arc): number {
  const angle = Math.atan2(y - arc.cy, x - arc.cx);
  if (angleOnArc(angle, arc)) return Math.abs(Math.hypot(x - arc.cx, y - arc.cy) - SCREW.bend);
  const ends = [arc.a0, arc.a1].map((a) => Math.hypot(x - (arc.cx + Math.cos(a) * SCREW.bend), y - (arc.cy + Math.sin(a) * SCREW.bend)));
  return Math.min(ends[0], ends[1]);
}

/** Zero inside a slab. Outside, the distance to the slab edge. */
function slabOuterDistance(slab: Slab, x: number, y: number): number {
  const { along, across } = frameOf(slab, x, y);
  const dx = Math.abs(along) - slab.halfAlong;
  const dy = Math.abs(across) - slab.halfAcross;
  if (dx <= 0 && dy <= 0) return 0;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

function nutOutlineDistance(screw: ScrewBody, nut: NutBody, x: number, y: number): number {
  return slabOuterDistance(nutSlab(screw, nut), x, y);
}

/** Distance from the point to this screw's metal. Zero inside the outline. */
function screwOutlineDistance(screw: ScrewBody, x: number, y: number): number {
  let distance = screw.kind === 'straight' ? slabOuterDistance(headSlab(screw), x, y) : Infinity;
  for (const seg of shaftSegments(screw)) {
    const abx = seg.bx - seg.ax;
    const aby = seg.by - seg.ay;
    const len2 = abx * abx + aby * aby || 1;
    const t = Math.max(0, Math.min(1, ((x - seg.ax) * abx + (y - seg.ay) * aby) / len2));
    distance = Math.min(distance, Math.max(0, Math.hypot(seg.ax + abx * t - x, seg.ay + aby * t - y) - SHAFT_CORE));
  }
  const local = toLocal(screw, x, y);
  for (const arc of bendArcs(screw)) distance = Math.min(distance, Math.max(0, distToArc(local.x, local.y, arc) - SHAFT_CORE));
  for (const rect of buckleRects(screw)) {
    const { along, across } = frameOf(rect, x, y);
    distance = Math.min(distance, Math.max(0, roundedRectDistance(along, across, rect)));
  }
  return distance;
}

export type NearPiece = { kind: 'nut' | 'screw'; id: string; distance: number };

/** Pieces whose real outline is within `finger` of the point. Distance is 0 inside the outline. */
export function piecesNear(screws: ScrewBody[], nuts: NutBody[], x: number, y: number, finger: number): NearPiece[] {
  const hits: NearPiece[] = [];
  for (const nut of nuts) {
    const screw = screwOf(screws, nut.screwId);
    if (!screw) continue;
    const distance = nutOutlineDistance(screw, nut, x, y);
    if (distance <= finger) hits.push({ kind: 'nut', id: nut.id, distance });
  }
  for (const screw of screws) {
    const distance = screwOutlineDistance(screw, x, y);
    if (distance <= finger) hits.push({ kind: 'screw', id: screw.id, distance });
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

export function screwAt(screws: ScrewBody[], nuts: NutBody[], x: number, y: number): ScrewBody | null {
  if (nutAt(nuts, screws, x, y)) return null;
  let best: { screw: ScrewBody; distance: number } | null = null;
  for (const screw of screws) {
    const distance = screwOutlineDistance(screw, x, y);
    if (distance > 0) continue;
    if (!best || distance < best.distance) best = { screw, distance };
  }
  return best?.screw ?? null;
}

/**
 * Move the screw from where it already is by this world delta.
 * A drag feeds only the pointer's new projection. Replaying the whole
 * gesture from the press repeats every contact test and drops the frame rate.
 * The step is 0.02. The first pose that overlaps stops the move.
 */
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

/**
 * How far along `sign` this screw must slide to leave its own buckles.
 * Null when it is already clear, the finger reversed, or something else
 * still blocks inside `pad`. The screw is put back where it started.
 */
export function releaseSlack(
  screws: ScrewBody[],
  nuts: NutBody[],
  id: string,
  sign: number,
  pad: number,
): number | null {
  if (sign === 0 || pad <= 0) return null;
  const screw = screwOf(screws, id);
  if (!screw || !screwHeld(screw, nuts)) return null;
  const axis = screwSlideAxis(screw);
  const originX = screw.x;
  const originY = screw.y;
  const place = (travel: number) => {
    screw.x = originX + axis.x * sign * travel;
    screw.y = originY + axis.y * sign * travel;
  };
  const free = (travel: number) => {
    place(travel);
    return !poseBlocked(screw, nuts, screws);
  };
  if (!free(pad)) {
    place(0);
    return null;
  }
  let lo = 0;
  let hi = pad;
  for (let step = 0; step < 16; step += 1) {
    const mid = (lo + hi) / 2;
    if (free(mid)) hi = mid;
    else lo = mid;
  }
  place(0);
  return hi;
}

/** One pointer sample. Projects the new point onto the slide axis and advances only that far. */
export function dragScrew(
  screws: ScrewBody[],
  nuts: NutBody[],
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { blocked: boolean } {
  const screw = screwOf(screws, id);
  if (!screw) return { blocked: false };
  const axis = screwSlideAxis(screw);
  const along = (to.x - from.x) * axis.x + (to.y - from.y) * axis.y;
  return slideScrew(screws, nuts, id, axis.x * along, axis.y * along);
}

