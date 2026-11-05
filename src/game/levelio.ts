import type { Board } from './board';
import levelOrder from '../../public/levels/order.json';
import { pinLocks, stockNuts } from './screws';

let packed: Record<string, Board> = {};
let packedOrder: string[] = [...levelOrder];

/** Phone builds read these instead of fetching `public/levels`. */
export function usePackedLevels(levels: Record<string, Board>): void {
  packed = levels;
}

function bundledBoard(id: string): Board | undefined {
  const key = Object.keys(packed).find((item) => item.endsWith(`/${id}.json`));
  return key ? packed[key] : undefined;
}

async function orderIds(): Promise<string[]> {
  if (import.meta.env.DEV) {
    const response = await fetch('./levels/order.json', { cache: 'no-store' });
    if (response.ok) {
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('json')) {
        const ids = (await response.json()) as unknown;
        if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) return ids;
      }
    }
  }
  if (packedOrder.length > 0) return packedOrder;
  return Object.keys(packed)
    .map((key) => key.match(/(\d+)\.json$/)?.[1])
    .filter((id): id is string => !!id)
    .sort((a, b) => Number(a) - Number(b));
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
  const ids = await orderIds();
  const id = ids[index - 1];
  if (!id) return emptyBoard();
  if (import.meta.env.DEV) {
    const response = await fetch(`./levels/${id}.json`, { cache: 'no-store' });
    if (response.ok) {
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('json')) return normalizeLevel((await response.json()) as Board);
    }
  }
  const board = bundledBoard(id);
  if (!board) return emptyBoard();
  return normalizeLevel(structuredClone(board));
}

export async function fetchLevelCount(): Promise<number> {
  const ids = await orderIds();
  return Math.max(1, ids.length);
}
