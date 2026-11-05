/** Screws on the table. Nuts are generated when a level omits them. */

export type ScrewBody = {
  id: string;
  kind: 'straight' | 'l' | 'u';
  x: number;
  y: number;
  theta: number;
  color?: number;
  /**
   * Straight-edge lengths. Straight has one, L has two, U has three
   * (left leg, bottom, right leg). Missing means the built-in sizes.
   */
  edges?: number[];
  /** One silver buckle per edge, measured from that edge's dead end. */
  buckleT?: number[];
  /** Silver buckles locked in world space. The screw slides through them. */
  locks?: { x: number; y: number }[];
};

/** A nut parked on one straight run. `t` is the distance from that run's dead end. */
export type NutBody = {
  id: string;
  screwId: string;
  run: number;
  t: number;
  color: number;
};

export type Board = {
  screws: ScrewBody[];
  nuts?: NutBody[];
};
