/** Screws on the table. Nuts are generated when a level omits them. */

export type ScrewBody = {
  id: string;
  kind: 'straight' | 'l' | 'u';
  x: number;
  y: number;
  theta: number;
  color?: number;
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
