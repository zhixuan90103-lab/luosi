/** Screw and nut colors. Silver buckles stay out of this list. */
export const PALETTE = [
  0x3498db, 0x2ecc71, 0xf4d03f, 0xe74c3c, 0xe67e22, 0x1ace9c, 0x3a7bd5, 0x8e44ad, 0xe84393, 0x5c4ddb,
  0xa15c2f, 0xc2185b,
] as const;

export function randomPaletteColor(): number {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}
