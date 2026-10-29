/**
 * Стратемы, reconstructed from the games described in the cycle. The books fix the pieces and their
 * characters (the sword wears armour, the horseshoe pierces it and is the fastest, the arrow takes no
 * return blow, the sickle fears to leave the regular troops, the coin bribes swordsmen, the spark
 * commands), three moves by different pieces per turn, terrain that matters, a castle worth three
 * points of defence, and victory by striking down the enemy sparks. Numbers are our own.
 */

export type Side = 'red' | 'blue';
export type Kind = 'serp' | 'mech' | 'strela' | 'podkova' | 'moneta' | 'iskra';
export type Terrain = 'plain' | 'road' | 'forest' | 'hill' | 'stream' | 'ruins';

export interface Piece { id: number; kind: Kind; side: Side; r: number; c: number }
export interface Cell { r: number; c: number }
/** One activation of a piece: an optional move, then an optional strike or bribe. */
export interface Action { id: number; to?: Cell; target?: number }
export interface Outcome { text: string; removed: number[]; converted?: number }

export const ROWS = 16;
export const COLS = 12;
export const ACTIONS_PER_TURN = 3;

export const STATS: Record<Kind, { a: number; d: number; mp: number; name: string; plural: string; value: number }> = {
  serp: { a: 1, d: 1, mp: 2, name: 'серп', plural: 'серпы', value: 1 },
  mech: { a: 2, d: 3, mp: 2, name: 'меч', plural: 'мечи', value: 3 },
  strela: { a: 2, d: 1, mp: 2, name: 'стрела', plural: 'стрелы', value: 3 },
  podkova: { a: 3, d: 2, mp: 6, name: 'подкова', plural: 'подковы', value: 5 },
  moneta: { a: 0, d: 1, mp: 4, name: 'монета', plural: 'монеты', value: 3 },
  iskra: { a: 1, d: 2, mp: 4, name: 'искра', plural: 'искры', value: 40 },
};
export const TERRAIN: Record<Terrain, { name: string; def: number }> = {
  plain: { name: 'равнина', def: 0 },
  road: { name: 'дорога', def: 0 },
  forest: { name: 'лес', def: 1 },
  hill: { name: 'холм', def: 1 },
  stream: { name: 'ручей', def: -1 },
  ruins: { name: 'руины замка', def: 3 },
};

const REGULAR: Kind[] = ['mech', 'strela', 'podkova', 'iskra'];

export class Game {
  pieces: Piece[] = [];
  side: Side = 'red';
  used = new Set<number>();
  winner: Side | null = null;
  turn = 1;

  constructor(public field: Terrain[][], army: Kind[][], public sparks: number) {
    let id = 1;
    // army rows are written from the front line backwards, for the red side at the bottom
    army.forEach((row, k) => row.forEach((kind, c) => {
      if (kind) {
        this.pieces.push({ id: id++, kind, side: 'red', r: ROWS - 3 + k, c });
        this.pieces.push({ id: id++, kind, side: 'blue', r: 2 - k, c: COLS - 1 - c });
      }
    }));
  }

  clone(): Game {
    const g = Object.create(Game.prototype) as Game;
    g.field = this.field; g.sparks = this.sparks; g.side = this.side; g.turn = this.turn; g.winner = this.winner;
    g.pieces = this.pieces.map((p) => ({ ...p }));
    g.used = new Set(this.used);
    return g;
  }

  at(r: number, c: number): Piece | undefined { return this.pieces.find((p) => p.r === r && p.c === c); }
  byId(id: number): Piece | undefined { return this.pieces.find((p) => p.id === id); }
  terrain(r: number, c: number): Terrain { return this.field[r][c]; }

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
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
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

  legal(a: Action): boolean {
    const p = this.byId(a.id);
    if (!p || p.side !== this.side || this.used.has(p.id) || this.winner) return false;
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
    if (a.to) {
      p.r = a.to.r; p.c = a.to.c;
      parts.push(`${cap(who(p))} идёт на ${cellName(a.to)}`);
    }
    if (a.target != null) {
      const q = this.byId(a.target)!;
      if (p.kind === 'moneta') {
        q.side = p.side;
        this.used.add(q.id);
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
    this.used.add(p.id);
    out.text = parts.join(' ') + '.';
    for (const s of ['red', 'blue'] as Side[])
      if (!this.pieces.some((x) => x.side === s && x.kind === 'iskra')) this.winner = s === 'red' ? 'blue' : 'red';
    if (!this.winner && this.actionsLeft() === 0) this.endTurn();
    return out;
  }

  actionsLeft(): number {
    const mine = this.pieces.filter((p) => p.side === this.side && !this.used.has(p.id));
    return Math.min(ACTIONS_PER_TURN - [...this.used].filter((id) => this.byId(id)?.side === this.side).length, mine.length);
  }

  endTurn(): void {
    this.used.clear();
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
    return list;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export function dist(a: Cell, b: Cell): number { return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)); }
const LETTERS = 'АБВГДЕЖЗИКЛМНОП';
export function cellName(c: Cell): string { return LETTERS[c.c] + (ROWS - c.r); }
function cap(s: string): string { return s[0].toUpperCase() + s.slice(1); }

/** Armies, red side, front row first. The full one follows Adrian's «классический порядок». */
export function army(sparks: number): Kind[][] {
  const _ = '' as Kind;
  if (sparks === 1)
    return [
      [_, _, 'serp', 'serp', 'podkova', 'iskra', 'podkova', 'serp', 'serp', _, _, _],
      [_, _, _, 'mech', 'mech', 'strela', 'mech', 'moneta', _, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _, _],
    ];
  return [
    [_, 'serp', 'serp', 'podkova', 'podkova', 'iskra', 'podkova', 'podkova', 'serp', 'serp', _, _],
    [_, _, 'strela', 'mech', 'mech', 'mech', 'mech', 'mech', 'strela', _, _, _],
    [_, _, _, _, 'serp', 'iskra', 'moneta', 'serp', _, _, _, _],
  ];
}

/** A unique field from a seed: point-symmetric, so neither side starts on better ground. */
export function makeField(seed: number): Terrain[][] {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const f: Terrain[][] = Array.from({ length: ROWS }, () => Array<Terrain>(COLS).fill('plain'));
  const set = (r: number, c: number, t: Terrain) => {
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return;
    f[r][c] = t; f[ROWS - 1 - r][COLS - 1 - c] = t;
  };
  const blob = (t: Terrain, r0: number, c0: number, n: number) => {
    let r = r0, c = c0;
    for (let i = 0; i < n; i++) {
      set(r, c, t);
      r += Math.round(rnd() * 2 - 1); c += Math.round(rnd() * 2 - 1);
      r = Math.max(3, Math.min(ROWS / 2 - 1, r)); c = Math.max(0, Math.min(COLS - 1, c));
    }
  };
  // a stream across one half, wandering, with the middle rows left open
  let c = Math.floor(rnd() * 3);
  const sr = 5 + Math.floor(rnd() * 2);
  for (let k = 0; k < COLS; k++) {
    if (k === c) set(sr + Math.round(rnd() - .3), k, 'stream'); else set(sr, k, 'stream');
  }
  // fords: a couple of gaps in the stream
  for (let i = 0; i < 2; i++) set(sr, 1 + Math.floor(rnd() * (COLS - 2)), 'plain');
  blob('forest', 3 + Math.floor(rnd() * 4), Math.floor(rnd() * 4), 6 + Math.floor(rnd() * 4));
  blob('forest', 4 + Math.floor(rnd() * 2), 7 + Math.floor(rnd() * 4), 4 + Math.floor(rnd() * 3));
  blob('hill', 6 + Math.floor(rnd() * 2), 3 + Math.floor(rnd() * 6), 3 + Math.floor(rnd() * 3));
  // a road from one side to the other through the centre
  c = 2 + Math.floor(rnd() * (COLS - 4));
  for (let r = 0; r < ROWS / 2; r++) {
    if (f[r][c] !== 'stream' || r === sr) set(r, c, 'road');
    if (rnd() < .35) c = Math.max(1, Math.min(COLS - 2, c + (rnd() < .5 ? -1 : 1)));
    if (f[r][c] === 'plain') set(r, c, 'road');
  }
  set(ROWS / 2 - 1, COLS / 2 - 1, 'road'); set(ROWS / 2 - 1, COLS / 2, 'road');
  // the ruins of a castle near each rear corner
  set(1 + Math.floor(rnd() * 2), rnd() < .5 ? 1 : COLS - 2, 'ruins');
  return f;
}
