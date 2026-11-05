/**
 * Screw shafts, octagon heads, nuts, and the silver buckle.
 * Sleeve sizes live in `buckleMetrics`. The mesh and the contact test both read them.
 */

import * as THREE from 'three';

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

export function straightBar(length: number, width: number, depth: number, material: THREE.Material): THREE.Mesh {
  const r = Math.min(width * 0.28, depth * 0.45);
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
  const metal = new THREE.MeshStandardMaterial({ color: BUCKLE_COLOR, metalness: 0.04, roughness: 0.38 });
  const sleeve = straightBar(sleeveLen, sleeveW, depth * 1.2, metal);
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
  /**
   * Nut hole diameter. Shaft core is a little under this.
   * Thread crests are this divided by 0.83, the coarse-metric minor-to-major ratio.
   */
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

/** +X shaft from the head center to the open tip. */
function straightCenter(): ScrewSample[] {
  const samples: ScrewSample[] = [];
  pushLine(samples, 0, 0, SCREW.straight, 0, 8);
  return samples;
}

/**
 * Elbow in the bottom-left. One open tip runs +X, the other runs +Y.
 * Arc goes the short way from the horizontal leg to the vertical leg.
 */
function lCenter(): ScrewSample[] {
  const r = SCREW.bend;
  const leg = SCREW.leg;
  const samples: ScrewSample[] = [];
  pushLine(samples, r + leg, -r, 0, -r, 8);
  pushArc(samples, 0, 0, r, -Math.PI / 2, -Math.PI, 16);
  pushLine(samples, -r, 0, -r, leg, 8);
  return dedupe(samples);
}

/** Both open tips point +Y. The two elbows are the base. */
function uCenter(): ScrewSample[] {
  const r = SCREW.bend;
  const leg = SCREW.leg;
  const span = SCREW.span;
  const samples: ScrewSample[] = [];
  pushLine(samples, 0, leg, 0, 0, 8);
  pushArc(samples, r, 0, r, Math.PI, Math.PI * 1.5, 16);
  pushLine(samples, r, -r, r + span, -r, 6);
  pushArc(samples, r + span, 0, r, -Math.PI / 2, 0, 16);
  pushLine(samples, span + r * 2, 0, span + r * 2, leg, 8);
  return dedupe(samples);
}

function centerOf(kind: ScrewKind): ScrewSample[] {
  if (kind === 'straight') return straightCenter();
  if (kind === 'l') return lCenter();
  return uCenter();
}

/** Local AABB of the finished screw, before world rotation. */
export function screwLocalBounds(kind: ScrewKind): { minX: number; minY: number; maxX: number; maxY: number } {
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
  for (const p of centerOf(kind)) {
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
const shaftUp = new THREE.Vector3(0, 1, 0);
const torusAxis = new THREE.Vector3(0, 0, 1);

function addRod(group: THREE.Group, x0: number, y0: number, x1: number, y1: number, radius: number, material: THREE.Material): void {
  shaftAxis.set(x1 - x0, y1 - y0, 0);
  const length = shaftAxis.length();
  if (length < 1e-4) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), material);
  mesh.quaternion.setFromUnitVectors(shaftUp, shaftAxis.multiplyScalar(1 / length));
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
  group.add(mesh);
}

function addTip(group: THREE.Group, x: number, y: number, radius: number, material: THREE.Material): void {
  const tip = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  tip.position.set(x, y, 0);
  group.add(tip);
}

/** Quarter elbow. `rotationZ` turns the default +X→+Y arc onto the bend. */
function addElbow(group: THREE.Group, cx: number, cy: number, rotationZ: number, radius: number, tube: number, material: THREE.Material): void {
  const elbow = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 18, Math.PI / 2), material);
  elbow.position.set(cx, cy, 0);
  elbow.rotation.z = rotationZ;
  group.add(elbow);
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
  const coil = radius * 0.72;
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
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, steps, radius * 0.36, 5, false), material));
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
  hole.absarc(0, 0, SCREW.width / 2, 0, Math.PI * 2, true);
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
  hole.absarc(0, 0, SCREW.width / 2, 0, Math.PI * 2, true);
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
  if (kind === 'straight') {
    return {
      head: true,
      buckles: [{ x: 0.19, y: 0 }],
      runs: [
        {
          x0: 0,
          y0: 0,
          x1: SCREW.straight,
          y1: 0,
          stations: runStations(SCREW.straight, 3, 0.17, SCREW.nut * 0.7),
          minT: 0.19 + 0.08 + NUT_AXIAL,
        },
      ],
    };
  }
  if (kind === 'l') {
    const span = r + leg;
    return {
      head: false,
      buckles: [{ x: 0.175, y: -r }],
      runs: [
        {
          x0: 0,
          y0: -r,
          x1: span,
          y1: -r,
          stations: runStations(span, 2, r * 0.55, SCREW.nut * 0.65),
          minT: 0.175 + 0.08 + NUT_AXIAL,
        },
        {
          x0: -r,
          y0: 0,
          x1: -r,
          y1: leg,
          stations: runStations(leg, 1, r * 0.55, SCREW.nut * 0.65),
          minT: r * 0.55,
        },
      ],
    };
  }
  const pitch = SCREW.span + r * 2;
  return {
    head: false,
    buckles: [
      { x: 0, y: 0.2 },
      { x: pitch, y: 0.2 },
    ],
    runs: [0, pitch].map((x) => ({
      x0: x,
      y0: 0,
      x1: x,
      y1: leg,
      stations: runStations(leg, 2, 0.2, SCREW.nut * 0.65),
      minT: 0.2 + 0.08 + NUT_AXIAL,
    })),
  };
}

export function nutMesh(depth: number, color: number): THREE.Mesh {
  return new THREE.Mesh(nutGeometry(depth), new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.12 }));
}

/** Point the nut's hole along a local shaft direction. */
export function aimNut(mesh: THREE.Object3D, dx: number, dy: number): void {
  shaftAxis.set(dx, dy, 0);
  if (shaftAxis.lengthSq() < 1e-8) return;
  shaftAxis.normalize();
  mesh.quaternion.setFromUnitVectors(torusAxis, shaftAxis);
}

export function screwMesh(kind: ScrewKind, depth: number, color: number): THREE.Group {
  void color;
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.z = 0.35;
  group.add(body);
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.22, roughness: 0.62 });
  const thread = metal;
  const hole = SCREW.width / 2;
  const radius = hole;
  const crest = hole;
  const r = SCREW.bend;
  const leg = SCREW.leg;
  if (kind === 'straight') {
    const headLength = screwCap(depth).length;
    addRod(body, headLength / 2, 0, SCREW.straight, 0, radius, metal);
    addThreads(body, headLength / 2, 0, SCREW.straight, 0, crest, thread);
    addTip(body, SCREW.straight, 0, radius, metal);
    const head = new THREE.Mesh(headGeometry(depth), metal);
    head.quaternion.setFromUnitVectors(torusAxis, new THREE.Vector3(1, 0, 0));
    group.add(head);
    const straightBuckle = silverBuckle(SCREW.width, SCREW.straight, depth, BUCKLE_LENGTH_SCALE);
    straightBuckle.position.set(0.19, 0, 0);
    straightBuckle.userData.buckle = true;
    group.add(straightBuckle);
    return group;
  }
  if (kind === 'l') {
    addRod(body, r + leg, -r, 0, -r, radius, metal);
    addThreads(body, r + leg, -r, 0, -r, crest, thread);
    addTip(body, r + leg, -r, radius, metal);
    addElbow(body, 0, 0, Math.PI, r, radius, metal);
    addRod(body, -r, 0, -r, leg, radius, metal);
    addThreads(body, -r, 0, -r, leg, crest, thread);
    addTip(body, -r, leg, radius, metal);
    const lBuckle = silverBuckle(SCREW.width, SCREW.straight, depth, BUCKLE_LENGTH_SCALE);
    lBuckle.position.set(0.175, -r, 0);
    lBuckle.userData.buckle = true;
    group.add(lBuckle);
    return group;
  }
  const span = SCREW.span;
  addRod(body, 0, leg, 0, 0, radius, metal);
  addThreads(body, 0, leg, 0, 0, crest, thread);
  addTip(body, 0, leg, radius, metal);
  addElbow(body, r, 0, Math.PI, r, radius, metal);
  addRod(body, r, -r, r + span, -r, radius, metal);
  const uBuckleY = 0.2;
  for (const x of [0, span + r * 2]) {
    const uBuckle = silverBuckle(SCREW.width, SCREW.straight, depth, BUCKLE_LENGTH_SCALE);
    uBuckle.position.set(x, uBuckleY, 0);
    uBuckle.rotation.z = Math.PI / 2;
    uBuckle.userData.buckle = true;
    group.add(uBuckle);
  }
  addElbow(body, r + span, 0, -Math.PI / 2, r, radius, metal);
  addRod(body, span + r * 2, 0, span + r * 2, leg, radius, metal);
  addThreads(body, span + r * 2, 0, span + r * 2, leg, crest, thread);
  addTip(body, span + r * 2, leg, radius, metal);
  return group;
}
