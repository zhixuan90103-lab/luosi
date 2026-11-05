import type { Board, NutBody, ScrewBody } from '../game/board';
import { PALETTE, randomPaletteColor } from '../game/palette';
import {
  SCREW,
  buckleSleeveLen,
  clampBuckleT,
  defaultBuckleT,
  defaultEdges,
  minEdgeLength,
  resolveEdges,
  runLength,
  shapeRuns,
} from '../game/parts';
import { NUT_HALF, stockNuts, toWorld } from '../game/screws';

export function shownNuts(board: Board): NutBody[] {
  return board.nuts ?? stockNuts(board.screws);
}

export function materialize(board: Board, screw: ScrewBody): void {
  if (!board.nuts) board.nuts = stockNuts(board.screws);
  if (!screw.edges) screw.edges = defaultEdges(screw.kind);
  if (!screw.buckleT) screw.buckleT = defaultBuckleT(screw.kind, screw.edges);
}

/** Pull buckles and nuts back onto the edges after a length change. */
export function settle(board: Board, screw: ScrewBody): void {
  materialize(board, screw);
  const edges = resolveEdges(screw.kind, screw.edges).map((length, index) =>
    Math.max(minEdgeLength(screw.kind, index), length),
  );
  screw.edges = edges;
  const runs = shapeRuns(screw.kind, edges);
  const half = buckleSleeveLen() / 2;
  screw.buckleT = runs.map((run, index) => clampBuckleT(runLength(run), screw.buckleT?.[index] ?? 0));
  for (const nut of board.nuts ?? []) {
    if (nut.screwId !== screw.id) continue;
    const run = runs[nut.run];
    if (!run) continue;
    const length = runLength(run);
    const buckle = screw.buckleT[nut.run];
    const tipSide = buckle + half + NUT_HALF;
    const deadSide = buckle - half - NUT_HALF;
    const tipMax = Math.max(tipSide, length - NUT_HALF);
    if (deadSide < NUT_HALF) {
      nut.t = Math.min(tipMax, Math.max(tipSide, nut.t));
      continue;
    }
    if (nut.t >= buckle) nut.t = Math.min(tipMax, Math.max(tipSide, nut.t));
    else nut.t = Math.min(deadSide, Math.max(NUT_HALF, nut.t));
  }
}

export function spawnScrew(board: Board, kind: ScrewBody['kind'], x: number, y: number, color = randomPaletteColor()): ScrewBody {
  const screw: ScrewBody = {
    id: `s${Date.now().toString(36)}`,
    kind,
    x,
    y,
    theta: 0,
    color,
    edges: defaultEdges(kind),
    buckleT: defaultBuckleT(kind),
  };
  board.screws.push(screw);
  board.nuts ??= [];
  settle(board, screw);
  return screw;
}

/** `along` is the distance from the dead end along the whole straight run. */
export function setEdgeLength(board: Board, screw: ScrewBody, index: number, along: number, fromDead: boolean): void {
  materialize(board, screw);
  const runs = shapeRuns(screw.kind, screw.edges);
  const run = runs[index];
  const oldLine = runLength(run);
  let nextEdge = along;
  if (screw.kind === 'l' && index === 0) nextEdge = along - SCREW.bend;
  nextEdge = Math.max(minEdgeLength(screw.kind, index), nextEdge);
  const nextLine = screw.kind === 'l' && index === 0 ? SCREW.bend + nextEdge : nextEdge;
  const delta = nextLine - oldLine;
  if (fromDead && Math.abs(delta) > 1e-6) {
    const local = { x: run.x1 - run.x0, y: run.y1 - run.y0 };
    const span = Math.hypot(local.x, local.y) || 1;
    const step = toWorld(screw, (-delta * local.x) / span, (-delta * local.y) / span);
    const origin = toWorld(screw, 0, 0);
    screw.x += step.x - origin.x;
    screw.y += step.y - origin.y;
    screw.buckleT![index] += delta;
    for (const nut of board.nuts ?? []) {
      if (nut.screwId === screw.id && nut.run === index) nut.t += delta;
    }
  }
  screw.edges![index] = nextEdge;
  settle(board, screw);
}

export function setBuckleT(board: Board, screw: ScrewBody, index: number, t: number): void {
  materialize(board, screw);
  screw.buckleT![index] = t;
  settle(board, screw);
}

export function addNut(board: Board, screw: ScrewBody, run: number, t: number, color = randomPaletteColor()): void {
  materialize(board, screw);
  board.nuts!.push({
    id: `n${Date.now().toString(36)}`,
    screwId: screw.id,
    run,
    t,
    color,
  });
  settle(board, screw);
}

/** Even gaps along each straight edge, with the same margin at both ends. */
export function spaceNuts(board: Board, screw: ScrewBody): void {
  settle(board, screw);
  const runs = shapeRuns(screw.kind, screw.edges);
  const half = buckleSleeveLen() / 2;
  runs.forEach((run, index) => {
    const nuts = (board.nuts ?? []).filter((nut) => nut.screwId === screw.id && nut.run === index);
    if (nuts.length === 0) return;
    nuts.sort((a, b) => a.t - b.t);
    const length = runLength(run);
    const buckle = screw.buckleT?.[index] ?? 0;
    const lo = buckle + half + NUT_HALF;
    const hi = Math.max(lo, length - NUT_HALF);
    const gap = (hi - lo) / (nuts.length + 1);
    nuts.forEach((nut, order) => {
      nut.t = lo + gap * (order + 1);
    });
  });
  settle(board, screw);
}

export function deleteNut(board: Board, id: string): void {
  if (!board.nuts) board.nuts = shownNuts(board);
  board.nuts = board.nuts.filter((nut) => nut.id !== id);
}

export function deleteScrew(board: Board, id: string): void {
  board.screws = board.screws.filter((screw) => screw.id !== id);
  if (board.nuts) board.nuts = board.nuts.filter((nut) => nut.screwId !== id);
}

export function levelPayload(board: Board): Board {
  return {
    screws: board.screws.map((screw) => {
      const saved: ScrewBody = {
        id: screw.id,
        kind: screw.kind,
        x: round(screw.x),
        y: round(screw.y),
        theta: round(screw.theta),
        color: screw.color,
      };
      if (screw.edges) saved.edges = screw.edges.map((value) => round(value));
      if (screw.buckleT) saved.buckleT = screw.buckleT.map((value) => round(value));
      return saved;
    }),
    ...(board.nuts ? { nuts: board.nuts.map((nut) => ({ ...nut, t: round(nut.t) })) } : {}),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function paletteHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export { PALETTE };
