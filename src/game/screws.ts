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
  screwLayout,
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

function runOf(kind: ScrewKind, index: number): ScrewRun {
  return seatedLayout(kind).runs[index];
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

function pointInSlab(slab: Slab, x: number, y: number): boolean {
  const { along, across } = frameOf(slab, x, y);
  return Math.abs(along) <= slab.halfAlong && Math.abs(across) <= slab.halfAcross;
}

/** Click target is the nut outline grown by 20%. Blocking still uses the real outline. */
function nutPickSlab(screw: ScrewBody, nut: NutBody): Slab {
  const slab = nutSlab(screw, nut);
  return { ...slab, halfAlong: slab.halfAlong * 1.4, halfAcross: slab.halfAcross * 1.2 };
}

export function nutAt(nuts: NutBody[], screws: ScrewBody[], x: number, y: number): NutBody | null {
  let best: { nut: NutBody; distance: number } | null = null;
  for (const nut of nuts) {
    const screw = screwOf(screws, nut.screwId);
    if (!screw) continue;
    const slab = nutPickSlab(screw, nut);
    if (!pointInSlab(slab, x, y)) continue;
    const distance = Math.hypot(slab.x - x, slab.y - y);
    if (!best || distance < best.distance) best = { nut, distance };
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

/** Straight runs only. The barrel is this capsule; metal past it is the bend. */
function straightEnds(screw: ScrewBody): { x0: number; y0: number; x1: number; y1: number }[] {
  const r = SCREW.bend;
  const leg = SCREW.leg;
  if (screw.kind === 'straight') {
    const a = toWorld(screw, 0, 0);
    const b = toWorld(screw, SCREW.straight, 0);
    return [{ x0: a.x, y0: a.y, x1: b.x, y1: b.y }];
  }
  if (screw.kind === 'l') {
    const a = toWorld(screw, 0, -r);
    const b = toWorld(screw, r + leg, -r);
    const c = toWorld(screw, -r, 0);
    const d = toWorld(screw, -r, leg);
    return [
      { x0: a.x, y0: a.y, x1: b.x, y1: b.y },
      { x0: c.x, y0: c.y, x1: d.x, y1: d.y },
    ];
  }
  const pitch = SCREW.span + r * 2;
  const left0 = toWorld(screw, 0, 0);
  const left1 = toWorld(screw, 0, leg);
  const right0 = toWorld(screw, pitch, 0);
  const right1 = toWorld(screw, pitch, leg);
  return [
    { x0: left0.x, y0: left0.y, x1: left1.x, y1: left1.y },
    { x0: right0.x, y0: right0.y, x1: right1.x, y1: right1.y },
  ];
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
  screw.locks = seatedLayout(screw.kind).buckles.map((buckle) => toWorld(screw, buckle.x, buckle.y));
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

function bendArcs(kind: ScrewKind): Arc[] {
  const r = SCREW.bend;
  if (kind === 'l') return [{ cx: 0, cy: 0, a0: -Math.PI / 2, a1: -Math.PI }];
  if (kind === 'u') {
    return [
      { cx: r, cy: 0, a0: Math.PI, a1: Math.PI * 1.5 },
      { cx: r + SCREW.span, cy: 0, a0: -Math.PI / 2, a1: 0 },
    ];
  }
  return [];
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

/** Distance from the click to this screw's metal. Infinity when the click misses the outline. */
function screwPickDistance(screw: ScrewBody, x: number, y: number): number {
  let distance = Infinity;
  if (screw.kind === 'straight' && pointInSlab(headSlab(screw), x, y)) distance = 0;
  for (const seg of shaftSegments(screw)) {
    const abx = seg.bx - seg.ax;
    const aby = seg.by - seg.ay;
    const len2 = abx * abx + aby * aby || 1;
    const t = Math.max(0, Math.min(1, ((x - seg.ax) * abx + (y - seg.ay) * aby) / len2));
    distance = Math.min(distance, Math.hypot(seg.ax + abx * t - x, seg.ay + aby * t - y));
  }
  const local = toLocal(screw, x, y);
  for (const arc of bendArcs(screw.kind)) distance = Math.min(distance, distToArc(local.x, local.y, arc));
  if (distance <= SHAFT_CORE) return distance;
  for (const rect of buckleRects(screw)) {
    const { along, across } = frameOf(rect, x, y);
    if (roundedRectDistance(along, across, rect) <= 0) return 0;
  }
  return Infinity;
}

export function screwAt(screws: ScrewBody[], nuts: NutBody[], x: number, y: number): ScrewBody | null {
  if (nutAt(nuts, screws, x, y)) return null;
  let best: { screw: ScrewBody; distance: number } | null = null;
  for (const screw of screws) {
    const distance = screwPickDistance(screw, x, y);
    if (distance === Infinity) continue;
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

