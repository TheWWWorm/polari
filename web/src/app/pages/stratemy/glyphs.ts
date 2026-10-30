import { Kind } from './engine';

/**
 * Signs carved on the pieces, drawn in a 24-unit box: sickle, sword, arrow, horseshoe, coin,
 * and for the spark a lightning bolt («костяной кругляш с золоченной молнией»).
 */
export const GLYPH: Record<Kind, string> = {
  serp: 'M16 4.5a7.5 7.5 0 1 0 2.5 9.5A5.6 5.6 0 1 1 16 4.5ZM8.5 15.5 4.5 20',
  mech: 'M12 3v13M7.5 16h9M12 16v5',
  strela: 'M5 19 19 5M19 5h-6M19 5v6M5 19h3M5 19v-3',
  podkova: 'M7 20v-8a5 5 0 0 1 10 0v8M5.5 20h3M15.5 20h3',
  moneta: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM12 8.5v7',
  iskra: 'M14.2 2 5.6 13.4h5.6L9.4 22l9-12.2h-5.8Z',
};
