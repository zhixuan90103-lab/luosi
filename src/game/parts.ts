/**
 * Screw shafts, octagon heads, nuts, and the silver buckle.
 * Sleeve sizes live in `buckleMetrics`. The mesh and the contact test both read them.
 */

import * as THREE from 'three';
import { metalMaterial } from './finish';

export const PART = {
  outer: 0.72,
  bandRatio: 0.28,
  gap: 1.75,
  depth: 0.18,
  scale: 0.9,
} as const;

/** Screw buckles use the bar sleeve, shortened once. Mesh and contact both read this. */
export const BUCKLE_LENGTH_SCALE = 0.45;

/** Axial thickness of the octagon head and nut. Bevel is the same share the extrude uses. */
export function screwCap(depth: number): { length: number; bevel: number; half: number } {
  const length = Math.max(0.12, depth * 0.75);
  const bevel = length * 0.22;
  return { length, bevel, half: (length + bevel * 2) / 2 };
}

/**
 * Top-view half-width of an octagon whose vertices sit on `vertex`.
 * The head and nut are turned so the bolt axis lies in the board. Only the local Y
 * of that octagon shows up across the shaft, and the widest of those is cos(π/8).
 */
export function flatHalf(vertex: number): number {
  return vertex * Math.cos(Math.PI / 8);
}

/** Head and nut half-length at the depth `showLevel` passes into the mesh. */
export const SCREW_CAP_HALF = screwCap(PART.depth * PART.scale).half;

const BUCKLE_COLOR = 0xc8c7c5;

export function buckleMetrics(width: number, basis: number): {
  sleeveLen: number;
  sleeveW: number;
  gripSpan: number;
  gripStick: number;
} {
  const sleeveLen = basis * 0.32 * (2 / 3);
  const sleeveW = width * 1.3;
  return { sleeveLen, sleeveW, gripSpan: sleeveLen * 0.62 * 0.7, gripStick: width * 0.48 * 0.7 };
}

/** Corner radius of a rounded bar. Same value the mesh and the contact test use. */
export function barCorner(width: number, depth: number): number {
  return Math.min(width * 0.28, depth * 0.45);
}

/** Sleeve and grips at the depth passed into the mesh, including the round corners. */
export function buckleShape(depth: number): {
  sleeveLen: number;
  sleeveW: number;
  gripSpan: number;
  gripStick: number;
  sleeveCorner: number;
  gripCorner: number;
} {
  const metrics = buckleMetrics(SCREW.width, SCREW.straight * BUCKLE_LENGTH_SCALE);
  const barDepth = depth * 1.2;
  return {
    ...metrics,
    sleeveCorner: barCorner(metrics.sleeveW, barDepth),
    gripCorner: barCorner(metrics.gripStick, barDepth),
  };
}

export function straightBar(
  length: number,
  width: number,
  depth: number,
  material: THREE.Material,
  holeRadius = 0,
): THREE.Mesh {
  const r = barCorner(width, depth);
  const x = -width / 2;
  const y = -depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.absarc(x + width - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + width, y + depth - r);
  shape.absarc(x + width - r, y + depth - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + depth);
  shape.absarc(x + r, y + depth - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  if (holeRadius > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, holeRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 8 });
  geometry.translate(0, 0, -length / 2);
  geometry.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}
function fakeShadow(length: number, width: number, x: number, y: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.shadowColor = 'rgba(70, 52, 36, 0.45)';
  ctx.shadowBlur = 7;
  ctx.fillStyle = 'rgba(70, 52, 36, 0.38)';
  ctx.beginPath();
  ctx.roundRect(28, 36, 72, 56, 12);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(length * 2.15, width * 2.35),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.position.set(x, y, -0.4);
  mesh.userData.fakeShadow = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
/** Silver sleeve and two grips. Local +X runs along the rod. */
export function silverBuckle(width: number, basis: number, depth: number, lengthScale = 1): THREE.Group {
  const group = new THREE.Group();
  const { sleeveLen, sleeveW, gripSpan, gripStick } = buckleMetrics(width, basis * lengthScale);
  const metal = metalMaterial(BUCKLE_COLOR, 'buckle');
  const sleeve = straightBar(sleeveLen, sleeveW, depth * 1.2, metal, SHAFT_RADIUS + THREAD_HOLE_GAP);
  sleeve.position.z = 0.03;
  sleeve.castShadow = false;
  sleeve.userData.noShadow = true;
  group.add(sleeve);
  group.add(fakeShadow(sleeveLen, sleeveW, 0.016, -0.014));
  for (const side of [-1, 1]) {
    const grip = straightBar(gripSpan, gripStick, depth * 1.2, metal);
    const y = side * (sleeveW / 2 + gripStick / 2);
    grip.position.set(0, y, 0.03);
    grip.castShadow = false;
    grip.userData.noShadow = true;
    group.add(grip);
    group.add(fakeShadow(gripSpan, gripStick, 0.016, y - 0.014));
  }
  return group;
}
/**
 * Flat screws in the XY plane, thickness along Z.
 * Straight: round head at the local origin, shaft along +X, open tip at +X.
 * L and U: the elbow is the dead end. Open tips are the straight ends.
 * `bend` is the centerline radius of an elbow. `width` is the finished shaft width.
 */
export const SCREW = {
  /** Shaft core diameter. The hole and the contact radius are the thread crest, not this. */
  width: 0.14,
  /** Round flange radius. Straight screws only. */
  head: 0.19,
  /** Eight-sided nut, center to vertex. */
  nut: 0.15,
  straight: 1.55,
  bend: 0.16,
  leg: 1.12,
  span: 0.48,
} as const;

/** One thread turn along the shaft. Same pitch the helix uses. */
export const THREAD_PITCH = (SCREW.width / 2) * 0.9;

/** Core cylinder radius. The helix is raised around this. */
export const SHAFT_CORE = SCREW.width / 2;
/** Coil center, as a share of the core radius. Same numbers `addThreads` uses. */
const THREAD_COIL = 0.72;
/** Thread tube radius, as a share of the core radius. */
const THREAD_TUBE = 0.36;
/** Outermost metal of the rod. Bend and contact use this. The drawn helix is art and does not block. */
export const SHAFT_RADIUS = SHAFT_CORE * (THREAD_COIL + THREAD_TUBE);
/** Mesh holes are this much wider than the crest so the decorative thread does not meet the wall. */
const THREAD_HOLE_GAP = 0.008;

export const NUT_COLORS = [0x3498db, 0x2ecc71, 0xf4d03f, 0xe74c3c] as const;

export type ScrewKind = 'straight' | 'l' | 'u';

type ScrewSample = { x: number; y: number; tx: number; ty: number };

function pushLine(out: ScrewSample[], x0: number, y0: number, x1: number, y1: number, steps: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const tx = (x1 - x0) / len;
  const ty = (y1 - y0) / len;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, tx, ty });
  }
}

/** `a1` may be less than `a0`. Tangent follows the sweep. */
function pushArc(out: ScrewSample[], cx: number, cy: number, radius: number, a0: number, a1: number, steps: number): void {
  const sweep = a1 - a0;
  const sign = Math.sign(sweep) || 1;
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + (sweep * i) / steps;
    out.push({
      x: cx + Math.cos(a) * radius,
      y: cy + Math.sin(a) * radius,
      tx: -Math.sin(a) * sign,
      ty: Math.cos(a) * sign,
    });
  }
}

function dedupe(samples: ScrewSample[]): ScrewSample[] {
  const out: ScrewSample[] = [];
  for (const sample of samples) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev.x - sample.x, prev.y - sample.y) < 1e-4) continue;
    out.push(sample);
  }
  return out;
}

/** One span of a screw. Lines are the barrel. Arcs are the bends. */
export type ScrewSpan =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'arc'; cx: number; cy: number; a0: number; a1: number };

/** How many straight edges this kind has. */
export function edgeCount(kind: ScrewKind): number {
  if (kind === 'straight') return 1;
  if (kind === 'l') return 2;
  return 3;
}

/** Built-in edge lengths: straight, then L's two legs, then U's left, bottom, right. */
export function defaultEdges(kind: ScrewKind): number[] {
  if (kind === 'straight') return [SCREW.straight];
  if (kind === 'l') return [SCREW.leg, SCREW.leg];
  return [SCREW.leg, SCREW.span, SCREW.leg];
}

export function resolveEdges(kind: ScrewKind, edges?: readonly number[]): number[] {
  const base = defaultEdges(kind);
  return base.map((value, index) => edges?.[index] ?? value);
}

/** Sleeve length shared by every silver buckle. */
export function buckleSleeveLen(): number {
  return buckleMetrics(SCREW.width, SCREW.straight * BUCKLE_LENGTH_SCALE).sleeveLen;
}

/** Shortest straight edge. Without a buckle it only has to stay a stub. */
export function minEdgeLength(kind: ScrewKind, index: number, hasBuckle = true): number {
  if (!hasBuckle || keptBuckleT(kind, index, 0) == null) return 0.05;
  const sleeve = buckleSleeveLen();
  if (kind === 'straight') return SCREW_CAP_HALF + sleeve;
  if (kind === 'l' && index === 0) return Math.max(0.05, sleeve - SCREW.bend);
  return sleeve;
}

/**
 * Straight runs from the dead end toward the open tip.
 * U's bottom uses the left bend as the dead end.
 */
export function shapeRuns(kind: ScrewKind, edges?: readonly number[]): { x0: number; y0: number; x1: number; y1: number }[] {
  const e = resolveEdges(kind, edges);
  const r = SCREW.bend;
  if (kind === 'straight') return [{ x0: 0, y0: 0, x1: e[0], y1: 0 }];
  if (kind === 'l') {
    return [
      { x0: 0, y0: -r, x1: r + e[0], y1: -r },
      { x0: -r, y0: 0, x1: -r, y1: e[1] },
    ];
  }
  const span = e[1];
  return [
    { x0: 0, y0: 0, x1: 0, y1: e[0] },
    { x0: r, y0: -r, x1: r + span, y1: -r },
    { x0: span + r * 2, y0: 0, x1: span + r * 2, y1: e[2] },
  ];
}

/**
 * Center of mass in screw-local space. Straight edges weigh by length.
 * A straight screw's head adds a blob at the origin.
 */
export function screwMassCenter(kind: ScrewKind, edges?: readonly number[]): { x: number; y: number } {
  let mx = 0;
  let my = 0;
  let mass = 0;
  const add = (x: number, y: number, m: number) => {
    mx += x * m;
    my += y * m;
    mass += m;
  };
  if (kind === 'straight') add(0, 0, SCREW.head * SCREW.head * Math.PI);
  for (const span of screwSpans(kind, edges)) {
    if (span.kind === 'line') {
      const length = Math.hypot(span.x1 - span.x0, span.y1 - span.y0);
      add((span.x0 + span.x1) / 2, (span.y0 + span.y1) / 2, length);
      continue;
    }
    const sweep = span.a1 - span.a0;
    const mid = span.a0 + sweep / 2;
    add(span.cx + Math.cos(mid) * SCREW.bend, span.cy + Math.sin(mid) * SCREW.bend, Math.abs(sweep) * SCREW.bend);
  }
  if (mass <= 0) return { x: 0, y: 0 };
  return { x: mx / mass, y: my / mass };
}

export function runLength(run: { x0: number; y0: number; x1: number; y1: number }): number {
  return Math.hypot(run.x1 - run.x0, run.y1 - run.y0);
}

/** Buckle center distance from the dead end, kept fully on the run. */
export function clampBuckleT(length: number, t: number): number {
  const half = buckleSleeveLen() / 2;
  const lo = half;
  const hi = Math.max(lo, length - half);
  return Math.min(hi, Math.max(lo, t));
}

/** U's bottom edge never takes a buckle. Null means the edge has none. */
export function keptBuckleT(kind: ScrewKind, index: number, t: number | null | undefined): number | null {
  if (kind === 'u' && index === 1) return null;
  if (t == null || !Number.isFinite(t)) return null;
  return t;
}

export function defaultBuckleT(kind: ScrewKind, edges?: readonly number[]): (number | null)[] {
  const half = buckleSleeveLen() / 2;
  return shapeRuns(kind, edges).map((run, index) => {
    if (keptBuckleT(kind, index, 0) == null) return null;
    const inner = kind === 'straight' && index === 0 ? SCREW_CAP_HALF + half : half;
    return clampBuckleT(runLength(run), inner);
  });
}

export function buckleOnRun(
  run: { x0: number; y0: number; x1: number; y1: number },
  t: number,
): { x: number; y: number; rot: number } {
  const dx = run.x1 - run.x0;
  const dy = run.y1 - run.y0;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: run.x0 + (dx / length) * t,
    y: run.y0 + (dy / length) * t,
    rot: Math.atan2(dy, dx),
  };
}

/** Buckles that are actually on the screw. `edge` is the straight-edge index. */
export function authoredBuckles(
  kind: ScrewKind,
  edges: readonly number[],
  buckleT: readonly (number | null)[],
): { x: number; y: number; rot: number; edge: number }[] {
  const seats: { x: number; y: number; rot: number; edge: number }[] = [];
  shapeRuns(kind, edges).forEach((run, index) => {
    const t = keptBuckleT(kind, index, buckleT[index]);
    if (t == null) return;
    seats.push({ ...buckleOnRun(run, clampBuckleT(runLength(run), t)), edge: index });
  });
  return seats;
}

/** Local centerline. Mesh, contact, and picking all read this. */
export function screwSpans(kind: ScrewKind, edges?: readonly number[]): ScrewSpan[] {
  const r = SCREW.bend;
  const e = resolveEdges(kind, edges);
  if (kind === 'straight') return [{ kind: 'line', x0: 0, y0: 0, x1: e[0], y1: 0 }];
  if (kind === 'l') {
    return [
      { kind: 'line', x0: r + e[0], y0: -r, x1: 0, y1: -r },
      { kind: 'arc', cx: 0, cy: 0, a0: -Math.PI / 2, a1: -Math.PI },
      { kind: 'line', x0: -r, y0: 0, x1: -r, y1: e[1] },
    ];
  }
  const span = e[1];
  return [
    { kind: 'line', x0: 0, y0: e[0], x1: 0, y1: 0 },
    { kind: 'arc', cx: r, cy: 0, a0: Math.PI, a1: Math.PI * 1.5 },
    { kind: 'line', x0: r, y0: -r, x1: r + span, y1: -r },
    { kind: 'arc', cx: r + span, cy: 0, a0: -Math.PI / 2, a1: 0 },
    { kind: 'line', x0: span + r * 2, y0: 0, x1: span + r * 2, y1: e[2] },
  ];
}

/** +X shaft from the head center to the open tip. */
function straightCenter(): ScrewSample[] {
  const samples: ScrewSample[] = [];
  for (const span of screwSpans('straight')) {
    if (span.kind === 'line') pushLine(samples, span.x0, span.y0, span.x1, span.y1, 8);
  }
  return samples;
}

/**
 * Elbow in the bottom-left. One open tip runs +X, the other runs +Y.
 * Arc goes the short way from the horizontal leg to the vertical leg.
 */
function spanSamples(kind: ScrewKind, edges?: readonly number[]): ScrewSample[] {
  const samples: ScrewSample[] = [];
  for (const span of screwSpans(kind, edges)) {
    if (span.kind === 'line') pushLine(samples, span.x0, span.y0, span.x1, span.y1, 8);
    else pushArc(samples, span.cx, span.cy, SCREW.bend, span.a0, span.a1, 16);
  }
  return dedupe(samples);
}

function lCenter(): ScrewSample[] {
  return spanSamples('l');
}

/** Both open tips point +Y. The two elbows are the base. */
function uCenter(): ScrewSample[] {
  return spanSamples('u');
}

function centerOf(kind: ScrewKind): ScrewSample[] {
  if (kind === 'straight') return straightCenter();
  if (kind === 'l') return lCenter();
  return uCenter();
}

/** Local AABB of the finished screw, before world rotation. */
export function screwLocalBounds(kind: ScrewKind, edges?: readonly number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const half = Math.max(SCREW.width / 2, SCREW.nut);
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
  for (const p of (edges ? spanSamples(kind, edges) : centerOf(kind))) {
    add(p.x - half, p.y - half);
    add(p.x + half, p.y + half);
  }
  if (kind === 'straight') {
    add(-SCREW.head, -SCREW.head);
    add(SCREW.head, SCREW.head);
  }
  return { minX, minY, maxX, maxY };
}

const shaftAxis = new THREE.Vector3();
const torusAxis = new THREE.Vector3(0, 0, 1);

/** One tube for the whole centerline, bends included, so the elbow is the same rod. */
function addSweptShaft(group: THREE.Group, samples: ScrewSample[], radius: number, material: THREE.Material, capStart: boolean): void {
  if (samples.length < 2) return;
  const points = samples.map((sample) => new THREE.Vector3(sample.x, sample.y, 0));
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 3), radius, 16, false), material));
  const tip = samples[samples.length - 1];
  addTip(group, tip.x, tip.y, radius, material);
  if (capStart) addTip(group, samples[0].x, samples[0].y, radius, material);
}

function addTip(group: THREE.Group, x: number, y: number, radius: number, material: THREE.Material): void {
  const tip = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  tip.position.set(x, y, 0);
  group.add(tip);
}

const helixUp = new THREE.Vector3(0, 0, 1);

/** Raised spiral around a straight shaft. One turn every `pitch` along the rod. */
function addThreads(group: THREE.Group, x0: number, y0: number, x1: number, y1: number, radius: number, material: THREE.Material): void {
  shaftAxis.set(x1 - x0, y1 - y0, 0);
  const length = shaftAxis.length();
  if (length < 0.08) return;
  shaftAxis.multiplyScalar(1 / length);
  const pitch = THREAD_PITCH;
  const side = new THREE.Vector3().crossVectors(shaftAxis, helixUp);
  if (side.lengthSq() < 1e-6) return;
  side.normalize();
  const pad = radius * 1.6;
  const span = length - pad * 2;
  if (span < pitch) return;
  const turns = span / pitch;
  const steps = Math.max(16, Math.ceil(turns * 16));
  const coil = radius * THREAD_COIL;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const along = pad + t * span;
    points.push(new THREE.Vector3(
      x0 + shaftAxis.x * along + side.x * Math.cos(angle) * coil,
      y0 + shaftAxis.y * along + side.y * Math.cos(angle) * coil,
      Math.sin(angle) * coil,
    ));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const thread = new THREE.Mesh(new THREE.TubeGeometry(curve, steps, radius * THREAD_TUBE, 5, false), material);
  thread.userData.thread = true;
  group.add(thread);
}

/** Eight-sided head. Local +Z is the bolt axis, same as a nut. Shaft leaves one face. */
function headGeometry(depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 8; i += 1) {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
    const x = Math.cos(angle) * SCREW.head;
    const y = Math.sin(angle) * SCREW.head;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, SHAFT_RADIUS + THREAD_HOLE_GAP, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const cap = screwCap(depth);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: cap.length,
    bevelEnabled: true,
    bevelThickness: cap.bevel,
    bevelSize: SCREW.head * 0.08,
    bevelSegments: 2,
    curveSegments: 20,
  });
  geometry.translate(0, 0, -cap.half);
  return geometry;
}

/** Octagonal nut. Local +Z is the bolt axis. The shaft passes through the hole. */
function nutGeometry(depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 8; i += 1) {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
    const x = Math.cos(angle) * SCREW.nut;
    const y = Math.sin(angle) * SCREW.nut;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, SHAFT_RADIUS + THREAD_HOLE_GAP, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const cap = screwCap(depth);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: cap.length,
    bevelEnabled: true,
    bevelThickness: cap.bevel,
    bevelSize: SCREW.nut * 0.14,
    bevelSegments: 2,
    curveSegments: 16,
  });
  geometry.translate(0, 0, -cap.half);
  return geometry;
}

let headOutline: { halfAlong: number; halfAcross: number; shift: number } | null = null;

/** Top-view box of the octagon head. Same bevel shift as a nut. The head does not spin. */
export function headSilhouette(): { halfAlong: number; halfAcross: number; shift: number } {
  if (headOutline) return headOutline;
  const cap = screwCap(PART.depth * PART.scale);
  const position = headGeometry(PART.depth * PART.scale).getAttribute('position');
  let halfAcross = 0;
  for (let i = 0; i < position.count; i += 1) halfAcross = Math.max(halfAcross, Math.abs(position.getY(i)));
  headOutline = { halfAlong: cap.half, halfAcross, shift: -cap.bevel };
  return headOutline;
}

let nutLocalXY: Float32Array | null = null;

function nutPoints(): Float32Array {
  if (nutLocalXY) return nutLocalXY;
  const position = nutGeometry(PART.depth * PART.scale).getAttribute('position');
  const xy = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    xy[i * 2] = position.getX(i);
    xy[i * 2 + 1] = position.getY(i);
  }
  nutLocalXY = xy;
  return xy;
}

/**
 * Top-view box of the nut mesh. The extrude is centered `bevel` back along the bolt,
 * and the bevel makes the across-width change as the octagon spins.
 */
export function nutSilhouette(spin: number): { halfAlong: number; halfAcross: number; shift: number } {
  const cap = screwCap(PART.depth * PART.scale);
  const points = nutPoints();
  const sine = Math.sin(spin);
  const cosine = Math.cos(spin);
  let halfAcross = 0;
  for (let i = 0; i < points.length; i += 2) {
    const across = Math.abs(points[i] * sine + points[i + 1] * cosine);
    if (across > halfAcross) halfAcross = across;
  }
  return { halfAlong: cap.half, halfAcross, shift: -cap.bevel };
}

/** One straight run that can hold nuts. `t` is the distance from the dead end toward the open tip. */
export type ScrewRun = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Nut centers, dead end toward the tip. */
  stations: number[];
  /** A nut center cannot sit closer to the dead end than this. */
  minT: number;
};

export type ScrewLayout = {
  runs: ScrewRun[];
  buckles: { x: number; y: number }[];
  head: boolean;
};

const NUT_AXIAL = SCREW_CAP_HALF;

function sleeveHalfLen(): number {
  return buckleMetrics(SCREW.width, SCREW.straight * BUCKLE_LENGTH_SCALE).sleeveLen / 2;
}

function runStations(length: number, count: number, insetDead: number, insetTip: number): number[] {
  const usable = length - insetDead - insetTip;
  if (count < 1 || usable <= 0) return [];
  const step = usable / count;
  const stations: number[] = [];
  for (let n = count - 1; n >= 0; n -= 1) stations.push(insetDead + step * (n + 0.5));
  return stations;
}

/** Local layout shared by the mesh and the drag rules. Dead end is (x0, y0). */
export function screwLayout(kind: ScrewKind): ScrewLayout {
  const r = SCREW.bend;
  const leg = SCREW.leg;
  const sleeveHalf = sleeveHalfLen();
  if (kind === 'straight') {
    const buckleX = SCREW_CAP_HALF + sleeveHalf;
    return {
      head: true,
      buckles: [{ x: buckleX, y: 0 }],
      runs: [
        {
          x0: 0,
          y0: 0,
          x1: SCREW.straight,
          y1: 0,
          stations: runStations(SCREW.straight, 3, 0.17, SCREW.nut * 0.7),
          minT: buckleX + sleeveHalf + NUT_AXIAL,
        },
      ],
    };
  }
  if (kind === 'l') {
    const span = r + leg;
    const buckleX = SHAFT_RADIUS + sleeveHalf;
    return {
      head: false,
      buckles: [{ x: buckleX, y: -r }],
      runs: [
        {
          x0: 0,
          y0: -r,
          x1: span,
          y1: -r,
          stations: runStations(span, 2, r * 0.55, SCREW.nut * 0.65),
          minT: buckleX + sleeveHalf + NUT_AXIAL,
        },
        {
          x0: -r,
          y0: 0,
          x1: -r,
          y1: leg,
          stations: runStations(leg, 1, r * 0.55, SCREW.nut * 0.65),
          minT: NUT_AXIAL,
        },
      ],
    };
  }
  const pitch = SCREW.span + r * 2;
  const buckleY = SHAFT_RADIUS + sleeveHalf;
  return {
    head: false,
    buckles: [
      { x: 0, y: buckleY },
      { x: pitch, y: buckleY },
    ],
    runs: [0, pitch].map((x) => ({
      x0: x,
      y0: 0,
      x1: x,
      y1: leg,
      stations: runStations(leg, 2, 0.2, SCREW.nut * 0.65),
      minT: buckleY + sleeveHalf + NUT_AXIAL,
    })),
  };
}

/** Layout for a screw whose edges and buckle seats are stored on the level. */
export function authoredLayout(kind: ScrewKind, edges: readonly number[], buckleT: readonly (number | null)[]): ScrewLayout {
  const half = buckleSleeveLen() / 2;
  const runs = shapeRuns(kind, edges).map((run, index) => {
    const length = runLength(run);
    const t = keptBuckleT(kind, index, buckleT[index]);
    const minT = t == null ? Math.min(length, SCREW_CAP_HALF) : Math.min(length, clampBuckleT(length, t) + half + SCREW_CAP_HALF);
    return {
      x0: run.x0,
      y0: run.y0,
      x1: run.x1,
      y1: run.y1,
      stations: [] as number[],
      minT,
    };
  });
  return { head: kind === 'straight', buckles: authoredBuckles(kind, edges, buckleT), runs };
}

export function nutMesh(depth: number, color: number): THREE.Mesh {
  return new THREE.Mesh(nutGeometry(depth), metalMaterial(color, 'nut'));
}

/** Point the nut's hole along a local shaft direction. */
export function aimNut(mesh: THREE.Object3D, dx: number, dy: number): void {
  shaftAxis.set(dx, dy, 0);
  if (shaftAxis.lengthSq() < 1e-8) return;
  shaftAxis.normalize();
  mesh.quaternion.setFromUnitVectors(torusAxis, shaftAxis);
}

export function screwMesh(
  kind: ScrewKind,
  depth: number,
  color: number,
  buckles?: { x: number; y: number; rot?: number }[],
  edges?: readonly number[],
): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.z = 0.35;
  group.add(body);
  const metal = metalMaterial(color, 'screw');
  const radius = SHAFT_CORE;
  const layout = screwLayout(kind);
  const seats: { x: number; y: number; rot?: number }[] = buckles ?? layout.buckles;
  const placeBuckle = (x: number, y: number, rotationZ = 0) => {
    const buckle = silverBuckle(SCREW.width, SCREW.straight, depth, BUCKLE_LENGTH_SCALE);
    buckle.position.set(x, y, 0);
    buckle.rotation.z = rotationZ;
    buckle.userData.buckle = true;
    group.add(buckle);
  };
  if (kind === 'straight') {
    const headLength = screwCap(depth).length;
    const samples: ScrewSample[] = [];
    const length = edges?.[0] ?? SCREW.straight;
    pushLine(samples, headLength / 2, 0, length, 0, 24);
    addSweptShaft(body, samples, radius, metal, false);
    addThreads(body, headLength / 2, 0, length, 0, radius, metal);
    const head = new THREE.Mesh(headGeometry(depth), metal);
    head.userData.head = true;
    head.quaternion.setFromUnitVectors(torusAxis, new THREE.Vector3(1, 0, 0));
    group.add(head);
    placeBuckle(seats[0].x, seats[0].y);
    return group;
  }
  if (kind === 'l') {
    addSweptShaft(body, spanSamples('l', edges), radius, metal, true);
    for (const span of screwSpans('l', edges)) {
      if (span.kind === 'line') addThreads(body, span.x0, span.y0, span.x1, span.y1, radius, metal);
    }
    seats.forEach((seat) => placeBuckle(seat.x, seat.y, seat.rot ?? 0));
    return group;
  }
  addSweptShaft(body, spanSamples('u', edges), radius, metal, true);
  for (const span of screwSpans('u', edges)) {
    if (span.kind === 'line') addThreads(body, span.x0, span.y0, span.x1, span.y1, radius, metal);
  }
  for (const buckle of seats) placeBuckle(buckle.x, buckle.y, buckle.rot ?? Math.PI / 2);
  return group;
}
