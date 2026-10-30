/**
 * Стратемы, reconstructed from the games described in the cycle. The books fix the pieces and their
 * characters (the sword wears armour, the horseshoe pierces it and is the fastest, the arrow takes no
 * return blow, the sickle fears to leave the regular troops, the coin bribes swordsmen, the spark
 * commands its стратема), three touches per turn that may all go to one piece, a whole стратема
 * moved with one touch, terrain that matters, a castle worth three points of defence, a short game
 * with one spark and a long one with a double set, and victory by striking down the enemy sparks.
 * Numbers are our own.
 */

export type Side = 'red' | 'blue';
export type Kind = 'serp' | 'mech' | 'strela' | 'podkova' | 'moneta' | 'iskra';
/** `edge` lies off the board: a master cuts each field to its own outline. */
export type Terrain = 'plain' | 'road' | 'forest' | 'hill' | 'stream' | 'ruins' | 'edge';

export interface Piece { id: number; kind: Kind; side: Side; r: number; c: number }
export interface Cell { r: number; c: number }
/**
 * One touch: a piece moves, strikes or bribes (a horseshoe or coin may move and then strike), or,
 * with `shift`, a spark leads its whole стратема one cell in that direction.
 */
export interface Action { id: number; to?: Cell; target?: number; shift?: number }
export interface Outcome { text: string; removed: number[]; converted?: number }

/** Hexagonal cells, flat side up, odd columns set half a cell lower. An even column count keeps the field point-symmetric. */
export const ROWS = 20;
export const COLS = 14;
export const ACTIONS_PER_TURN = 3;
/** Rows each side may set its army in. */
export const DEPLOY = 4;

export const STATS: Record<Kind, { a: number; d: number; mp: number; name: string; plural: string; value: number }> = {
  serp: { a: 1, d: 1, mp: 2, name: 'серп', plural: 'серпы', value: 1 },
  mech: { a: 2, d: 3, mp: 2, name: 'меч', plural: 'мечи', value: 3 },
  strela: { a: 2, d: 1, mp: 2, name: 'стрела', plural: 'стрелы', value: 3 },
  podkova: { a: 3, d: 2, mp: 4, name: 'подкова', plural: 'подковы', value: 5 },
  moneta: { a: 0, d: 1, mp: 4, name: 'монета', plural: 'монеты', value: 3 },
  iskra: { a: 1, d: 2, mp: 2, name: 'искра', plural: 'искры', value: 40 },
};
export const TERRAIN: Record<Terrain, { name: string; def: number }> = {
  plain: { name: 'равнина', def: 0 },
  road: { name: 'дорога', def: 0 },
  forest: { name: 'лес', def: 1 },
  hill: { name: 'холм', def: 1 },
  stream: { name: 'река', def: -1 },
  ruins: { name: 'руины замка', def: 3 },
  edge: { name: 'край поля', def: 0 },
};

const REGULAR: Kind[] = ['mech', 'strela', 'podkova', 'iskra'];

export class Game {
  pieces: Piece[] = [];
  side: Side = 'red';
  /** Touches spent this turn. */
  touches = 0;
  winner: Side | null = null;
  turn = 1;

  constructor(public field: Terrain[][], army: Kind[][], public sparks: number) {
    let id = 1;
    // army rows are written from the front line backwards, for the red side at the bottom
    const off = Math.floor((COLS - army[0].length) / 2);
    army.forEach((row, k) => row.forEach((kind, c) => {
      if (kind) {
        this.pieces.push({ id: id++, kind, side: 'red', r: ROWS - army.length + k, c: off + c });
        this.pieces.push({ id: id++, kind, side: 'blue', r: army.length - 1 - k, c: COLS - 1 - off - c });
      }
    }));
  }

  clone(): Game {
    const g = Object.create(Game.prototype) as Game;
    g.field = this.field; g.sparks = this.sparks; g.side = this.side; g.turn = this.turn; g.winner = this.winner;
    g.pieces = this.pieces.map((p) => ({ ...p }));
    g.touches = this.touches;
    return g;
  }

  at(r: number, c: number): Piece | undefined { return this.pieces.find((p) => p.r === r && p.c === c); }
  byId(id: number): Piece | undefined { return this.pieces.find((p) => p.id === id); }
  terrain(r: number, c: number): Terrain { return this.field[r][c]; }
  /** The neighbouring cells that are on the board. */
  around(r: number, c: number): Cell[] { return neighbours(r, c).filter((n) => this.field[n.r][n.c] !== 'edge'); }

  /** Movement cost in half-steps: roads speed everyone up, forest and hills slow the cavalry. */
  private cost(kind: Kind, t: Terrain): number {
    const horse = kind === 'podkova';
    switch (t) {
      case 'road': return 1;
      case 'forest': return horse ? 4 : 2;
      case 'hill': return horse ? 3 : 2;
      case 'stream': return horse ? 4 : 99; // infantry wading a stream stops there
      default: return 2;
    }
  }

  /** Cells the piece can end its move on. */
  reach(p: Piece): Cell[] {
    const best = new Map<number, number>([[p.r * COLS + p.c, 0]]);
    const queue: [number, number, number][] = [[p.r, p.c, 0]];
    const out: Cell[] = [];
    while (queue.length) {
      queue.sort((a, b) => a[2] - b[2]);
      const [r, c, spent] = queue.shift()!;
      if (spent > 0 && this.field[r][c] === 'stream' && p.kind !== 'podkova') continue;
      for (const { r: nr, c: nc } of this.around(r, c)) {
        const occ = this.at(nr, nc);
        if (occ) continue; // no passing through any piece
        const t = this.field[nr][nc];
        let step = this.cost(p.kind, t);
        if (step === 99) step = Math.max(1, STATS[p.kind].mp - spent); // may enter, then stops
        const total = spent + step;
        if (total > STATS[p.kind].mp) continue;
        const k = nr * COLS + nc;
        if ((best.get(k) ?? 99) <= total) continue;
        best.set(k, total);
        queue.push([nr, nc, total]);
      }
    }
    for (const k of best.keys()) {
      const r = Math.floor(k / COLS), c = k % COLS;
      if (r === p.r && c === p.c) continue;
      if (p.kind === 'serp' && !this.nearRegular(p.side, r, c, p.id)) continue;
      out.push({ r, c });
    }
    return out;
  }

  /** The sickle never strays more than two cells from regular troops. */
  private nearRegular(side: Side, r: number, c: number, self: number): boolean {
    return this.pieces.some((q) => q.side === side && q.id !== self && REGULAR.includes(q.kind) && dist(q, { r, c }) <= 2);
  }

  /** Enemies the piece could strike (or bribe) from the given cell. */
  targets(p: Piece, from: Cell = p): Piece[] {
    if (p.kind === 'moneta')
      return this.pieces.filter((q) => q.side !== p.side && q.kind === 'mech' && dist(q, from) === 1 && !this.ledBySpark(q));
    const range = p.kind === 'strela' ? 2 : 1;
    return this.pieces.filter((q) => q.side !== p.side && dist(q, from) <= range);
  }

  /** A swordsman standing beside his own spark cannot be bought. */
  private ledBySpark(q: Piece): boolean {
    return this.pieces.some((s) => s.side === q.side && s.kind === 'iskra' && dist(s, q) === 1);
  }

  /** Which pieces may still strike after moving in the same action. */
  static movesThenActs(kind: Kind): boolean { return kind === 'podkova' || kind === 'moneta'; }

  /** A spark beside a piece joins it into a battalion: +1 to strike and to defence. */
  private battalion(p: Piece): number {
    return p.kind !== 'iskra' && this.pieces.some((s) => s.side === p.side && s.kind === 'iskra' && dist(s, p) === 1) ? 1 : 0;
  }

  attackValue(att: Piece, def: Piece): number {
    let a = STATS[att.kind].a + this.battalion(att);
    if (att.kind === 'podkova' && def.kind === 'mech') a += 2; // the horseshoe pierces the sword's armour
    if (att.kind === 'podkova' && this.field[att.r][att.c] === 'forest') a -= 1;
    // pincers: every other friend touching the defender adds weight, up to two
    const helpers = this.pieces.filter((q) => q.side === att.side && q.id !== att.id && q.kind !== 'moneta' && dist(q, def) === 1).length;
    return a + Math.min(2, helpers);
  }

  defenceValue(def: Piece): number {
    const t = this.field[def.r][def.c];
    let d = STATS[def.kind].d + this.battalion(def) + TERRAIN[t].def;
    // the «коробочка»: every friend beside a spark shields it, up to two
    if (def.kind === 'iskra') d += Math.min(2, this.pieces.filter((q) => q.side === def.side && q.id !== def.id && dist(q, def) === 1).length);
    return Math.max(0, d);
  }

  /** Predict a strike without making it. */
  strike(att: Piece, def: Piece): 'win' | 'repelled' | 'lost' {
    if (this.attackValue(att, def) > this.defenceValue(def)) return 'win';
    if (att.kind === 'strela') return 'repelled';
    const back = STATS[def.kind].a + this.battalion(def);
    return back > this.defenceValue(att) ? 'lost' : 'repelled';
  }

  /** A spark's стратема: the spark and every friend standing beside it. */
  stratema(p: Piece): Piece[] {
    return p.kind !== 'iskra' ? [p] : [p, ...this.pieces.filter((q) => q.side === p.side && q.id !== p.id && dist(q, p) === 1)];
  }

  /** Where a стратема would stand after one step in a direction, or null if the way is blocked. */
  shifted(p: Piece, dir: number): Cell[] | null {
    const group = this.stratema(p);
    if (group.length < 2) return null;
    const ids = new Set(group.map((q) => q.id)), out: Cell[] = [];
    for (const q of group) {
      const to = step(q, dir);
      if (!to || this.field[to.r][to.c] === 'edge') return null;
      const occ = this.at(to.r, to.c);
      if (occ && !ids.has(occ.id)) return null;
      out.push(to);
    }
    return out;
  }

  legal(a: Action): boolean {
    const p = this.byId(a.id);
    if (!p || p.side !== this.side || this.winner || this.touches >= ACTIONS_PER_TURN) return false;
    if (a.shift != null) return !a.to && a.target == null && !!this.shifted(p, a.shift);
    if (!a.to && a.target == null) return false;
    if (a.to && !this.reach(p).some((c) => c.r === a.to!.r && c.c === a.to!.c)) return false;
    if (a.to && a.target != null && !Game.movesThenActs(p.kind)) return false;
    if (a.target != null && !this.targets(p, a.to ?? p).some((q) => q.id === a.target)) return false;
    return true;
  }

  apply(a: Action): Outcome {
    const p = this.byId(a.id)!;
    const out: Outcome = { text: '', removed: [] };
    const who = (q: Piece) => `${q.side === 'red' ? 'алая' : 'лазурная'} фишка «${STATS[q.kind].name}»`;
    const parts: string[] = [];
    if (a.shift != null) {
      const group = this.stratema(p), to = this.shifted(p, a.shift)!;
      group.forEach((q, i) => { q.r = to[i].r; q.c = to[i].c; });
      parts.push(`${p.side === 'red' ? 'Алая' : 'Лазурная'} искра ведёт стратему из ${group.length} фишек на ${cellName(p)}`);
    }
    if (a.to) {
      p.r = a.to.r; p.c = a.to.c;
      parts.push(`${cap(who(p))} идёт на ${cellName(a.to)}`);
    }
    if (a.target != null) {
      const q = this.byId(a.target)!;
      if (p.kind === 'moneta') {
        q.side = p.side;
        out.converted = q.id;
        parts.push(`${parts.length ? 'и подкупает' : cap(who(p)) + ' подкупает'} вражеский меч на ${cellName(q)}`);
      } else {
        const res = this.strike(p, q);
        const verb = parts.length ? 'и бьёт' : cap(who(p)) + ' бьёт';
        if (res === 'win') {
          this.pieces = this.pieces.filter((x) => x.id !== q.id);
          out.removed.push(q.id);
          parts.push(`${verb} ${who(q).replace('фишка', 'фишку').replace('лазурная', 'лазурную').replace('алая', 'алую')} — сбита`);
          // the horsemen sweep through: a winning horseshoe takes the cell
          if (p.kind === 'podkova' && dist(p, q) === 1) { p.r = q.r; p.c = q.c; }
        } else if (res === 'lost') {
          this.pieces = this.pieces.filter((x) => x.id !== p.id);
          out.removed.push(p.id);
          parts.push(`${verb} на ${cellName(q)}, но отбита и сама сбита ответным ударом`);
        } else {
          parts.push(`${verb} на ${cellName(q)}, но удар отбит`);
        }
      }
    }
    this.touches++;
    out.text = parts.join(' ') + '.';
    for (const s of ['red', 'blue'] as Side[])
      if (!this.pieces.some((x) => x.side === s && x.kind === 'iskra')) this.winner = s === 'red' ? 'blue' : 'red';
    if (!this.winner && this.actionsLeft() === 0) this.endTurn();
    return out;
  }

  actionsLeft(): number { return ACTIONS_PER_TURN - this.touches; }

  endTurn(): void {
    this.touches = 0;
    this.side = this.side === 'red' ? 'blue' : 'red';
    if (this.side === 'red') this.turn++;
  }

  /** Every action available to one piece. */
  actionsFor(p: Piece): Action[] {
    const list: Action[] = [];
    for (const t of this.targets(p)) list.push({ id: p.id, target: t.id });
    for (const to of this.reach(p)) {
      list.push({ id: p.id, to });
      if (Game.movesThenActs(p.kind)) for (const t of this.targets(p, to)) list.push({ id: p.id, to, target: t.id });
    }
    if (p.kind === 'iskra') for (let d = 0; d < 6; d++) if (this.shifted(p, d)) list.push({ id: p.id, shift: d });
    return list;
  }
}

/** Steps to the six neighbours, in the same order for both column parities: up, down, upper-left, lower-left, upper-right, lower-right. */
const HEX_EVEN = [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
const HEX_ODD = [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
/** The cell one step away in a direction, or null off the board's bounds. */
export function step(from: Cell, dir: number): Cell | null {
  const [dr, dc] = (from.c & 1 ? HEX_ODD : HEX_EVEN)[dir];
  const r = from.r + dr, c = from.c + dc;
  return r >= 0 && c >= 0 && r < ROWS && c < COLS ? { r, c } : null;
}
/** The six cells around a hex, inside the board's bounds. */
export function neighbours(r: number, c: number): Cell[] {
  return [0, 1, 2, 3, 4, 5].map((d) => step({ r, c }, d)).filter((n): n is Cell => !!n);
}
/** Steps between two hexes. */
export function dist(a: Cell, b: Cell): number {
  const az = a.r - (a.c - (a.c & 1)) / 2, bz = b.r - (b.c - (b.c & 1)) / 2;
  const dx = a.c - b.c, dz = az - bz;
  return Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dx + dz));
}
const LETTERS = 'АБВГДЕЖЗИКЛМНОП';
export function cellName(c: Cell): string { return LETTERS[c.c] + (ROWS - c.r); }
function cap(s: string): string { return s[0].toUpperCase() + s.slice(1); }

/**
 * Armies, red side, front row first. The short game has one set; the long game a double set
 * («двойной набор фишек») in Adrian's «классический порядок»: the spark and a wedge of horsemen
 * in front, swords behind them, and the second spark at the back with the coins under a
 * «коробочка» of sickles.
 */
export function army(sparks: number): Kind[][] {
  const K: Record<string, Kind | ''> = { s: 'serp', m: 'mech', t: 'strela', p: 'podkova', o: 'moneta', I: 'iskra', _: '' };
  const rows = sparks === 1
    ? ['____sspIpss___', '_____mmtm_____', '______sos_____', '______________']
    : ['__sssppIppsss_', '___tmmmmmmt___', '___ssoIoss____', '_____ss_______'];
  return rows.map((r) => r.split('').map((ch) => K[ch] as Kind));
}

/**
 * A unique field from a seed, like a master's carved board: its own outline, a river with fords,
 * groves, two hills with a hollow between them, a road, and a castle at home for each side.
 * Point-symmetric, so neither side starts on better ground.
 */
export function makeField(seed: number): Terrain[][] {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = (n: number) => Math.floor(rnd() * n);
  const f: Terrain[][] = Array.from({ length: ROWS }, () => Array<Terrain>(COLS).fill('plain'));
  const H = ROWS / 2;
  const set = (r: number, c: number, t: Terrain) => {
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return;
    f[r][c] = t; f[ROWS - 1 - r][COLS - 1 - c] = t;
  };
  // the outline: rounded back corners and a bay or two along the sides
  const k = 2 + pick(2);
  for (let r = 0; r < k; r++) for (let c = 0; c < k - r; c++) { set(r, c, 'edge'); set(r, COLS - 1 - c, 'edge'); }
  for (let i = 0; i < 2; i++) {
    const r = 5 + pick(H - 5), side = rnd() < 0.5 ? 0 : COLS - 1;
    set(r, side, 'edge');
    if (rnd() < 0.5) set(r + 1, side, 'edge');
  }
  const free = (r: number, c: number) => f[r]?.[c] === 'plain';
  const blob = (t: Terrain, r0: number, c0: number, n: number) => {
    let r = r0, c = c0;
    for (let i = 0; i < n; i++) {
      if (free(r, c)) set(r, c, t);
      const nb = neighbours(r, c).filter((x) => x.r >= 3 && x.r < H);
      if (nb.length) ({ r, c } = nb[pick(nb.length)]);
    }
  };
  // a river across each half, wandering, with two fords
  const sr = 6 + pick(2);
  let rr = sr;
  for (let c = 0; c < COLS; c++) {
    if (f[rr][c] !== 'edge') set(rr, c, 'stream');
    const go = rnd();
    if (go < 0.25 && rr > sr - 1) rr--; else if (go > 0.75 && rr < sr + 1) rr++;
  }
  for (let i = 0; i < 2; i++) {
    const c = 1 + pick(COLS - 2);
    for (let r = sr - 1; r <= sr + 1; r++) if (f[r][c] === 'stream') set(r, c, 'plain');
  }
  // groves
  blob('forest', 3 + pick(3), pick(4), 7 + pick(4));
  blob('forest', 3 + pick(3), COLS - 4 + pick(4), 5 + pick(4));
  blob('forest', 4 + pick(4), 5 + pick(4), 3 + pick(3));
  // two hills squeezing the plain into a hollow near the middle
  const hc = 3 + pick(COLS - 8), hr = H - 2 + pick(2);
  blob('hill', hr, hc, 3 + pick(2));
  blob('hill', hr, hc + 3, 3 + pick(2));
  // a road from the back through the middle of the field
  let c = 3 + pick(COLS - 6);
  for (let r = 0; r < H; r++) {
    if (f[r][c] !== 'edge') set(r, c, 'road');
    if (rnd() < 0.35) c = Math.max(2, Math.min(COLS - 3, c + (rnd() < 0.5 ? -1 : 1)));
    if (f[r][c] === 'plain') set(r, c, 'road');
  }
  // along the middle row to the centre, where it meets the other half's road
  for (let k = Math.min(c, COLS / 2 - 1); k <= Math.max(c, COLS / 2); k++) set(H - 1, k, 'road');
  // the home castle, in ruins, by a rear corner
  set(1 + pick(2), rnd() < 0.5 ? k : COLS - 1 - k, 'ruins');
  return f;
}

/** The stretches of road to draw: each road cell joined to one neighbour, so the road has no loops or ladders. */
export function roadLinks(f: Terrain[][]): [Cell, Cell][] {
  const seen = new Set<number>(), links: [Cell, Cell][] = [];
  for (let r0 = 0; r0 < ROWS; r0++) for (let c0 = 0; c0 < COLS; c0++) {
    if (f[r0][c0] !== 'road' || seen.has(r0 * COLS + c0)) continue;
    seen.add(r0 * COLS + c0);
    const queue: Cell[] = [{ r: r0, c: c0 }];
    while (queue.length) {
      const a = queue.shift()!;
      for (const b of neighbours(a.r, a.c)) {
        const k = b.r * COLS + b.c;
        if (f[b.r][b.c] !== 'road' || seen.has(k)) continue;
        seen.add(k);
        links.push([a, b]);
        queue.push(b);
      }
    }
  }
  return links;
}
