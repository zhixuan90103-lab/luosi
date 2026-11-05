import type { Board } from './board';
import { pinLocks, stockNuts } from './screws';

let packed: Record<string, Board> = {};

/** Phone builds read these instead of fetching `public/levels`. */
export function usePackedLevels(levels: Record<string, Board>): void {
  packed = levels;
}

function bundledBoard(index: number): Board | undefined {
  const key = Object.keys(packed).find((item) => item.endsWith(`/${index}.json`));
  return key ? packed[key] : undefined;
}

export function emptyBoard(): Board {
  return { screws: [] };
}

function normalizeLevel(data: Board): Board {
  data.screws ??= [];
  if (data.screws.length > 0 && !data.nuts) data.nuts = stockNuts(data.screws);
  for (const screw of data.screws) pinLocks(screw);
  return data;
}

export async function loadLevel(index: number): Promise<Board> {
  if (import.meta.env.DEV) {
    const response = await fetch(`./levels/${index}.json`);
    if (response.ok) {
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('json')) return normalizeLevel((await response.json()) as Board);
    }
  }
  const board = bundledBoard(index);
  if (!board) return emptyBoard();
  return normalizeLevel(structuredClone(board));
}

export async function fetchLevelCount(): Promise<number> {
  const numbers = Object.keys(packed)
    .map((key) => Number(key.match(/(\d+)\.json$/)?.[1]))
    .filter((n) => Number.isFinite(n));
  return Math.max(1, ...numbers, 0);
}
