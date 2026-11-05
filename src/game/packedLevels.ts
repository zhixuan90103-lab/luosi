import type { Board } from './board';

/** JSON files under public/levels, included in the phone build. */
const files = import.meta.glob('../../public/levels/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Board>;

export const packedLevels = Object.fromEntries(
  Object.entries(files).filter(([key]) => !key.endsWith('/order.json')),
);
