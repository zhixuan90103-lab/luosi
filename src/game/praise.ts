/**
 * Praise for a screw leaving its sleeve, or a nut pulled off its rod.
 * The first departure on a board is silent. Then Great, Perfect, Excellent, Amazing.
 * A hit or a stall returns the next word to Great. A new board is silent again.
 * The word sits 72 design pixels above the finger and stays inside 390×844.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';

export type PraiseCombo = {
  /** 0 after a break. Caps at 4. */
  rank: number;
  /** This board has already had one departure. That one shows no word. */
  seen: boolean;
};

const LINES = [
  { text: 'Great!', top: '#c8ff72', bottom: '#2fbe28' },
  { text: 'Perfect', top: '#ffe56a', bottom: '#ff8a1a' },
  { text: 'Excellent!', top: '#9ad8ff', bottom: '#2b86ff' },
  { text: 'Amazing', top: '#ee9bff', bottom: '#7a34ee' },
] as const;

/** Index is the rank. Great 200, Perfect 300, Excellent 400, Amazing 500. */
const CLEAR_POINTS = [0, 200, 300, 400, 500];

export function freshPraise(): PraiseCombo {
  return { rank: 0, seen: false };
}

/** A hit or a stall. The next word starts at Great. The first departure stays silent. */
export function breakPraise(combo: PraiseCombo): void {
  combo.rank = 0;
}

/** A new board. The next departure is silent again. */
export function resetPraise(combo: PraiseCombo): void {
  combo.rank = 0;
  combo.seen = false;
}

/**
 * One piece leaving.
 * The first departure on this board shows nothing and scores nothing.
 * Returns null when the word stays hidden.
 */
export function awardPraise(combo: PraiseCombo): { rank: number; points: number } | null {
  if (!combo.seen) {
    combo.seen = true;
    return null;
  }
  const rank = combo.rank === 0 ? 1 : Math.min(LINES.length, combo.rank + 1);
  combo.rank = rank;
  return { rank, points: CLEAR_POINTS[rank] ?? 200 };
}

let serial = 0;

/** Design pixels above the finger so the word clears the fingertip. */
const PRAISE_LIFT = 72;
const PRAISE_RISE = 28;
const PRAISE_DRIFT = 4;
const PRAISE_EDGE = 8;
const WORD_POP = 1.08;
const WORD_SHADOW = 4;

type WordLayout = { viewW: number; viewH: number; drawW: number; drawH: number };

function wordLayout(text: string): WordLayout {
  const viewW = text.length * 30 + 36;
  const viewH = 84;
  return { viewW, viewH, drawW: viewW * 0.605, drawH: 50.82 };
}

export function praiseSize(text: string): { w: number; h: number } {
  const word = wordLayout(text);
  return { w: word.drawW * WORD_POP, h: word.drawH * WORD_POP + WORD_SHADOW };
}

/**
 * Center of the word in design pixels.
 * The point is the finger lift. Sit 72px above it. Sink when that rise would leave the stage.
 */
export function placePraise(x: number, y: number, text: string): { x: number; y: number; below: boolean } {
  const { w, h } = praiseSize(text);
  const halfW = w / 2;
  const halfH = h / 2;
  const minX = PRAISE_EDGE + halfW;
  const maxX = DESIGN_WIDTH - PRAISE_EDGE - halfW - PRAISE_DRIFT;
  const cx = Math.min(Math.max(x, minX), maxX);
  const minY = PRAISE_EDGE + halfH;
  const maxY = DESIGN_HEIGHT - PRAISE_EDGE - halfH;
  const above = y - PRAISE_LIFT;
  if (above - PRAISE_RISE >= minY && above <= maxY) return { x: cx, y: above, below: false };
  let below = y + PRAISE_LIFT;
  if (below + PRAISE_RISE > maxY) below = maxY - PRAISE_RISE;
  if (below < minY) below = minY;
  return { x: cx, y: below, below: true };
}

const praiseNodes: HTMLDivElement[] = [];

function takePraiseNode(host: HTMLElement): HTMLDivElement {
  const idle = praiseNodes.find((node) => !node.isConnected);
  if (idle) return idle;
  const node = document.createElement('div');
  node.addEventListener('animationend', (event) => {
    if (event.target !== node) return;
    if (event.animationName !== 'praise-rise' && event.animationName !== 'praise-drop') return;
    node.remove();
  });
  praiseNodes.push(node);
  host.append(node);
  return node;
}

export function showPraise(x: number, y: number, rank: number): void {
  const host = document.getElementById('ui-root');
  if (!host || rank <= 0) return;
  const line = LINES[Math.min(rank, LINES.length) - 1];
  const id = `praise-fill-${serial}`;
  serial += 1;
  const spot = placePraise(x, y, line.text);
  const word = wordLayout(line.text);

  const node = takePraiseNode(host);
  node.className = '';
  node.style.left = `${spot.x}px`;
  node.style.top = `${spot.y}px`;
  node.innerHTML = `<svg viewBox="0 0 ${word.viewW} ${word.viewH}" width="${word.drawW}" height="${word.drawH}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line.top}"/>
        <stop offset="55%" stop-color="${line.top}"/>
        <stop offset="100%" stop-color="${line.bottom}"/>
      </linearGradient>
    </defs>
    <text x="${word.viewW / 2}" y="62" text-anchor="middle"
      fill="url(#${id})" stroke="#ffffff" stroke-width="13" stroke-linejoin="round" paint-order="stroke">${line.text}</text>
  </svg>`;
  if (!node.isConnected) host.append(node);
  void node.offsetWidth;
  node.className = spot.below ? 'praise is-below' : 'praise';
}
