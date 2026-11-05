import type { Board, NutBody, ScrewBody } from '../game/board';
import { PALETTE, randomPaletteColor } from '../game/palette';
import {
  SCREW,
  SCREW_CAP_HALF,
  buckleSleeveLen,
  clampBuckleT,
  defaultBuckleT,
  keptBuckleT,
  defaultEdges,
  minEdgeLength,
  resolveEdges,
  runLength,
  shapeRuns,
} from '../game/parts';
import { boardBounds } from '../game/camera';
import { NUT_HALF, stockNuts, toWorld } from '../game/screws';

function levelCenter(board: Board): { x: number; y: number } | null {
  if (board.screws.length === 0) return null;
  const bounds = boardBounds(board);
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** Slide every screw by the same world offset. Nuts and buckles ride along. */
export function shiftLevel(board: Board, dx: number, dy: number): void {
  for (const screw of board.screws) {
    screw.x += dx;
    screw.y += dy;
    screw.locks = undefined;
  }
}

/** Move every screw so the level's outline sits on the screen center. */
export function centerLevel(board: Board): void {
  const center = levelCenter(board);
  if (!center) return;
  for (const screw of board.screws) {
    screw.x -= center.x;
    screw.y -= center.y;
    screw.locks = undefined;
  }
}

/** Turn the whole level 90° clockwise on the screen, around its outline center. */
export function rotateLevelClockwise(board: Board): void {
  const center = levelCenter(board);
  if (!center) return;
  for (const screw of board.screws) {
    const dx = screw.x - center.x;
    const dy = screw.y - center.y;
    screw.x = center.x + dy;
    screw.y = center.y - dx;
    screw.theta -= Math.PI / 2;
    screw.locks = undefined;
  }
}

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
    Math.max(minEdgeLength(screw.kind, index, keptBuckleT(screw.kind, index, screw.buckleT?.[index]) != null), length),
  );
  screw.edges = edges;
  const runs = shapeRuns(screw.kind, edges);
  const half = buckleSleeveLen() / 2;
  screw.buckleT = runs.map((run, index) => {
    const t = keptBuckleT(screw.kind, index, screw.buckleT?.[index]);
    return t == null ? null : clampBuckleT(runLength(run), t);
  });
  for (const nut of board.nuts ?? []) {
    if (nut.screwId !== screw.id) continue;
    const run = runs[nut.run];
    if (!run) continue;
    const length = runLength(run);
    const buckle = screw.buckleT[nut.run];
    if (buckle == null) {
      nut.t = Math.min(length - NUT_HALF, Math.max(NUT_HALF, nut.t));
      continue;
    }
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
  nextEdge = Math.max(minEdgeLength(screw.kind, index, keptBuckleT(screw.kind, index, screw.buckleT?.[index]) != null), nextEdge);
  const nextLine = screw.kind === 'l' && index === 0 ? SCREW.bend + nextEdge : nextEdge;
  const delta = nextLine - oldLine;
  if (fromDead && Math.abs(delta) > 1e-6) {
    const local = { x: run.x1 - run.x0, y: run.y1 - run.y0 };
    const span = Math.hypot(local.x, local.y) || 1;
    const step = toWorld(screw, (-delta * local.x) / span, (-delta * local.y) / span);
    const origin = toWorld(screw, 0, 0);
    screw.x += step.x - origin.x;
    screw.y += step.y - origin.y;
    if (screw.buckleT![index] != null) screw.buckleT![index] += delta;
    for (const nut of board.nuts ?? []) {
      if (nut.screwId === screw.id && nut.run === index) nut.t += delta;
    }
  }
  screw.edges![index] = nextEdge;
  settle(board, screw);
}

export function setBuckleT(board: Board, screw: ScrewBody, index: number, t: number): void {
  materialize(board, screw);
  if (keptBuckleT(screw.kind, index, t) == null) {
    screw.buckleT![index] = null;
    return;
  }
  screw.buckleT![index] = t;
  settle(board, screw);
}

export function deleteBuckle(board: Board, screw: ScrewBody, index: number): void {
  materialize(board, screw);
  if (!screw.buckleT) return;
  screw.buckleT[index] = null;
  settle(board, screw);
}

/** Slide one nut along its straight edge. It stays on that edge, clear of the buckle and the other nuts. */
export function setNutT(board: Board, screw: ScrewBody, nutId: string, t: number): void {
  materialize(board, screw);
  const nut = board.nuts?.find((item) => item.id === nutId);
  const run = shapeRuns(screw.kind, screw.edges)[nut?.run ?? -1];
  if (!nut || !run) return;
  const length = runLength(run);
  const half = buckleSleeveLen() / 2;
  const buckle = keptBuckleT(screw.kind, nut.run, screw.buckleT?.[nut.run]);
  const width = NUT_HALF * 2;
  const onTip = buckle == null || nut.t >= buckle;
  let lo = buckle == null ? NUT_HALF : onTip ? buckle + half + NUT_HALF : NUT_HALF;
  let hi = buckle == null ? length - NUT_HALF : onTip ? length - NUT_HALF : buckle - half - NUT_HALF;
  for (const other of board.nuts ?? []) {
    if (other.id === nut.id || other.screwId !== screw.id || other.run !== nut.run) continue;
    if (buckle != null && (other.t >= buckle) !== onTip) continue;
    if (other.t < nut.t) lo = Math.max(lo, other.t + width);
    else hi = Math.min(hi, other.t - width);
  }
  if (hi < lo) return;
  nut.t = Math.min(hi, Math.max(lo, t));
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

/**
 * Even empty gaps along each straight rod.
 * The rod is the whole straight edge (straight screws start after the head).
 * The silver buckle keeps its place in line with the nuts. Buckle length and nut
 * thickness come out first. The leftover is one shared gap: before the first piece,
 * between pieces, and after the last piece.
 */
export function spaceNuts(board: Board, screw: ScrewBody): void {
  materialize(board, screw);
  const runs = shapeRuns(screw.kind, screw.edges);
  const nutWidth = NUT_HALF * 2;
  const buckleWidth = buckleSleeveLen();
  runs.forEach((run, index) => {
    const nuts = (board.nuts ?? []).filter((nut) => nut.screwId === screw.id && nut.run === index);
    const buckle = keptBuckleT(screw.kind, index, screw.buckleT?.[index]);
    const pieces: { t: number; width: number; nut?: NutBody }[] = [
      ...(buckle == null ? [] : [{ t: buckle, width: buckleWidth }]),
      ...nuts.map((nut) => ({ t: nut.t, width: nutWidth, nut })),
    ];
    pieces.sort((a, b) => a.t - b.t);
    const rodStart = screw.kind === 'straight' ? SCREW_CAP_HALF : 0;
    const rod = Math.max(0, runLength(run) - rodStart);
    const used = pieces.reduce((sum, piece) => sum + piece.width, 0);
    const gap = Math.max(0, (rod - used) / (pieces.length + 1));
    let cursor = rodStart + gap;
    for (const piece of pieces) {
      const center = cursor + piece.width / 2;
      if (piece.nut) piece.nut.t = center;
      else if (buckle != null) screw.buckleT![index] = center;
      cursor += piece.width + gap;
    }
  });
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
      if (screw.buckleT) saved.buckleT = screw.buckleT.map((value, index) => {
        const kept = keptBuckleT(screw.kind, index, value);
        return kept == null ? null : round(kept);
      });
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
