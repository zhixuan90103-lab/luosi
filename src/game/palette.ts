/**
 * Screw and nut colors on the paper field `#f6f1e8`, matching the Ring project.
 * Faces are blue, green, red, orange, purple, yellow.
 * In one level, screws take the least-used hue. A nut never uses its own screw's
 * hue, and also takes the least-used remaining hue. Buckles stay `#c8c7c5`.
 */
export const SCREW_HUES = [0x3aa8ff, 0x3dcc73, 0xff564c, 0xff8a2a, 0xa86bff, 0xf2c14e] as const;

export const PALETTE = [...SCREW_HUES];

/** Hue that appears least often. Ties follow the palette order. */
export function leastUsedHue(used: readonly (number | undefined)[], forbid?: number): number {
  let best: number = SCREW_HUES[0];
  let bestCount = Infinity;
  for (const hue of SCREW_HUES) {
    if (hue === forbid) continue;
    let count = 0;
    for (const color of used) if (color === hue) count += 1;
    if (count < bestCount) {
      bestCount = count;
      best = hue;
    }
  }
  return best;
}
