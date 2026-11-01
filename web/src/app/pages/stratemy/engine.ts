/**
 * Стратемы by the author's own rules: Roman Surzhikov's article of 2019 («Поларипедия»), gathered
 * from his posts. From it come the touches (two per turn in the short game, four in the full one,
 * no own piece touched twice, but several may strike one enemy), the speeds, wounds and return
 * blows instead of numbers, the horseshoe that ignores the sword's armour, the bow that takes no
 * return blow, the cowardly sickle, the coin's limited purse, the стратема that moves up to seven
 * pieces and strikes and answers as one, the terrain, the sets of pieces and the four endings.
 * Where the article is silent the books and our own choices stand: the hex field of 280 cells with
 * its terrain and home castle, the «классический порядок», a castle that strikes first like a
 * wall, hills that slow the horsemen, a стратема marching as far as its slowest piece in a line.
 */

export type Side = 'red' | 'blue';
export type Kind = 'serp' | 'mech' | 'strela' | 'podkova' | 'moneta' | 'iskra';
/** `edge` lies off the board: a master cuts each field to its own outline. */
export type Terrain = 'plain' | 'road' | 'forest' | 'hill' | 'stream' | 'ruins' | 'edge';

/** `hurt`: an armoured piece struck once and turned over; `spent`: what a coin has already paid out. */
export interface Piece { id: number; kind: Kind; side: Side; r: number; c: number; hurt?: boolean; spent?: number }
export interface Cell { r: number; c: number }
/**
 * One touch: an own piece moves (`to`), strikes or bribes an enemy (`target`), a spark leads its
 * whole стратема `steps` cells in one direction (`shift`), or a spark leaves the field (`off`).
 */
export interface Action { id: number; to?: Cell; target?: number; shift?: number; steps?: number; off?: boolean }
export interface Outcome { text: string; removed: number[]; converted?: number }
export type Ending = 'unconditional' | 'merciful' | 'dear' | 'draw';

/** Hexagonal cells, flat side up, odd columns set half a cell lower. An even column count keeps the field point-symmetric. */
export const ROWS = 20;
export const COLS = 14;
/** Touches per turn: two in the short game (one spark), four in the full one (two sparks). */
export const touchesFor = (sparks: number) => (sparks === 1 ? 2 : 4);
/** Rows each side may set its army in. */
export const DEPLOY = 4;

export const STATS: Record<Kind, { speed: number; armour: boolean; name: string; plural: string; value: number }> = {
  serp: { speed: 1, armour: false, name: 'серп', plural: 'серпы', value: 1 },
  mech: { speed: 1, armour: true, name: 'меч', plural: 'мечи', value: 3 },
  strela: { speed: 1, armour: false, name: 'лук', plural: 'луки', value: 2 },
  podkova: { speed: 2, armour: true, name: 'подкова', plural: 'подковы', value: 5 },
  moneta: { speed: 2, armour: false, name: 'монета', plural: 'монеты', value: 3 },
  iskra: { speed: 2, armour: false, name: 'искра', plural: 'искры', value: 40 },
};
export const TERRAIN: Record<Terrain, { name: string }> = {
  plain: { name: 'равнина' },
  road: { name: 'дорога' },
  forest: { name: 'лес' },
  hill: { name: 'холм' },
  stream: { name: 'река' },
  ruins: { name: 'руины замка' },
  edge: { name: 'край поля' },
};

/** The senior pieces, beside which a sickle dares to stand. */
const SENIOR: Kind[] = ['mech', 'podkova', 'iskra'];

export class Game {
  pieces: Piece[] = [];
  side: Side = 'red';
  /** Touches spent this turn. */
  touches = 0;
  /** Own pieces already touched this turn: a tired troop does not march again. */
  used = new Set<number>();
  /** A coin waiting this turn for a second coin to buy a horseshoe together. */
  pledges: { coin: number; target: number }[] = [];
  winner: Side | null = null;
  ending: Ending | null = null;
  turn = 1;
  readonly perTurn: number;
  /** Sparks each side has led off the field, and coins that paid out and left. */
  withdrawn: Record<Side, number> = { red: 0, blue: 0 };
  spentCoins: Record<Side, number> = { red: 0, blue: 0 };

  constructor(public field: Terrain[][], army: Kind[][], public sparks: number) {
    this.perTurn = touchesFor(sparks);
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
    Object.assign(g, this);
    g.pieces = this.pieces.map((p) => ({ ...p }));
    g.used = new Set(this.used);
    g.pledges = this.pledges.map((x) => ({ ...x }));
    g.withdrawn = { ...this.withdrawn };
    g.spentCoins = { ...this.spentCoins };
    return g;
  }

  get over(): boolean { return this.ending != null; }
  at(r: number, c: number): Piece | undefined { return this.pieces.find((p) => p.r === r && p.c === c); }
  byId(id: number): Piece | undefined { return this.pieces.find((p) => p.id === id); }
  terrain(r: number, c: number): Terrain { return this.field[r][c]; }
  /** The neighbouring cells that are on the board. */
  around(r: number, c: number): Cell[] { return neighbours(r, c).filter((n) => this.field[n.r][n.c] !== 'edge'); }
  /** A cell on the rim of the field, from which a spark can be led away. */
  onBorder(p: Cell): boolean { return this.around(p.r, p.c).length < 6; }

  /** Cavalry bogs down: in a forest (the article) or on a hill (ours) a horseshoe moves one cell. */
  private slowed(kind: Kind, t: Terrain): boolean { return kind === 'podkova' && (t === 'forest' || t === 'hill'); }
  speed(p: Piece): number { return this.slowed(p.kind, this.field[p.r][p.c]) ? 1 : STATS[p.kind].speed; }

  /**
   * Cells the piece can end its move on. A road adds one cell to a march along it, and so does a
   * river to a march along its water; a piece that steps into a river from the bank stops there,
   * so a crossing costs an extra touch. A horseshoe entering a forest or a hill stops too.
   */
  reach(p: Piece): Cell[] {
    const found = new Map<number, Cell>();
    const walk = (limit: number, only?: Terrain) => {
      const seen = new Set([p.r * COLS + p.c]);
      let front: Cell[] = [p];
      for (let s = 0; s < limit && front.length; s++) {
        const next: Cell[] = [];
        for (const a of front) for (const n of this.around(a.r, a.c)) {
          const k = n.r * COLS + n.c, t = this.field[n.r][n.c];
          if (seen.has(k) || this.at(n.r, n.c) || (only && t !== only)) continue;
          seen.add(k);
          found.set(k, n);
          const stops = (t === 'stream' && this.field[a.r][a.c] !== 'stream') || this.slowed(p.kind, t);
          if (!stops) next.push(n);
        }
        front = next;
      }
    };
    const sp = this.speed(p), t0 = this.field[p.r][p.c];
    walk(sp);
    if (t0 === 'road' || t0 === 'stream') walk(sp + 1, t0);
    return [...found.values()].filter((c) => p.kind !== 'serp' || this.nearSenior(p.side, c, p.id));
  }

  /** Cowardice: a sickle only steps onto a cell beside one of its own senior pieces. */
  private nearSenior(side: Side, at: Cell, self: number): boolean {
    return this.pieces.some((q) => q.side === side && q.id !== self && SENIOR.includes(q.kind) && dist(q, at) === 1);
  }

  /** Enemies the piece could strike, or for a coin bribe, from where it stands. */
  targets(p: Piece): Piece[] {
    const near = this.pieces.filter((q) => q.side !== p.side && dist(q, p) === 1);
    if (p.kind !== 'moneta') return near;
    const left = 2 - (p.spent ?? 0);
    return near.filter((q) => q.kind === 'serp' || q.kind === 'strela' || (left === 2 && (q.kind === 'mech' || q.kind === 'podkova')));
  }

  /** The стратема a piece belongs to: a spark with the friends around it, or the piece alone. */
  group(p: Piece): Piece[] {
    const spark = p.kind === 'iskra' ? p : this.pieces.find((s) => s.side === p.side && s.kind === 'iskra' && dist(s, p) === 1);
    const g = spark ? this.stratema(spark) : [p];
    return g.length > 1 ? g : [p];
  }

  /** A spark's стратема: the spark and every friend standing beside it, up to seven pieces. */
  stratema(p: Piece): Piece[] {
    return p.kind !== 'iskra' ? [p] : [p, ...this.pieces.filter((q) => q.side === p.side && q.id !== p.id && dist(q, p) === 1)];
  }

  /** How far a стратема marches with one touch: as fast as its slowest piece. */
  groupSpeed(p: Piece): number { return Math.min(...this.stratema(p).map((q) => this.speed(q))); }

  /**
   * Where a стратема would stand after `steps` cells in a direction, or null if the way is blocked.
   * It marches in a line, keeping its shape, and stops on entering a river.
   */
  shifted(p: Piece, dir: number, steps = 1): Cell[] | null {
    const group = this.stratema(p);
    if (group.length < 2 || steps < 1 || steps > this.groupSpeed(p)) return null;
    const ids = new Set(group.map((q) => q.id));
    let cur: Cell[] = group.map((q) => ({ r: q.r, c: q.c })), prev = cur;
    for (let j = 0; j < steps; j++) {
      if (cur.some((c, i) => this.field[c.r][c.c] === 'stream' && this.field[prev[i].r][prev[i].c] !== 'stream')) return null;
      prev = cur;
      const next: Cell[] = [];
      for (const q of cur) {
        const to = step(q, dir);
        if (!to || this.field[to.r][to.c] === 'edge') return null;
        const occ = this.at(to.r, to.c);
        if (occ && !ids.has(occ.id)) return null;
        next.push(to);
      }
      cur = next;
    }
    return cur;
  }

  legal(a: Action): boolean {
    const p = this.byId(a.id);
    if (!p || p.side !== this.side || this.over || this.touches >= this.perTurn || this.used.has(p.id)) return false;
    const kinds = [a.to, a.target, a.shift, a.off].filter((x) => x != null && x !== false).length;
    if (kinds !== 1) return false;
    if (a.off) return p.kind === 'iskra' && this.onBorder(p);
    if (a.shift != null) return !!this.shifted(p, a.shift, a.steps ?? 1);
    if (a.to) return this.reach(p).some((c) => c.r === a.to!.r && c.c === a.to!.c);
    return this.targets(p).some((q) => q.id === a.target);
  }

  /** Whether a blow from `att` goes through the armour of `def`: the horseshoe ignores a sword's, but not in a forest or against a wall. */
  private pierces(att: Piece, def: Piece): boolean {
    return att.kind === 'podkova' && def.kind === 'mech' && this.field[att.r][att.c] !== 'forest' && this.field[def.r][def.c] !== 'ruins';
  }

  /** Blows land on a piece: the unarmoured and the wounded fall, the armoured are wounded and turned over. */
  private land(def: Piece, hits: number, pierce: boolean): boolean {
    if (!STATS[def.kind].armour || def.hurt || pierce || hits >= 2) {
      this.pieces = this.pieces.filter((x) => x.id !== def.id);
      this.pledges = this.pledges.filter((x) => x.coin !== def.id && x.target !== def.id);
      return true;
    }
    def.hurt = true;
    return false;
  }

  /** The friend of a fallen or struck piece that hits back: one of its стратема beside the attacker, the strongest first. */
  private answerer(group: Piece[], att: Piece, skip: number): Piece | undefined {
    return group.filter((q) => q.id !== skip && q.kind !== 'moneta' && !!this.byId(q.id) && dist(q, att) === 1)
      .sort((a, b) => STATS[b.kind].value * (b.hurt ? 0.5 : 1) - STATS[a.kind].value * (a.hurt ? 0.5 : 1))[0];
  }

  apply(a: Action): Outcome {
    const p = this.byId(a.id)!;
    const out: Outcome = { text: '', removed: [] };
    const before = new Set(this.pieces.map((x) => x.id));
    const who = (q: Piece) => `${q.side === 'red' ? 'алая' : 'лазурная'} фишка «${STATS[q.kind].name}»`;
    const whom = (q: Piece) => who(q).replace('фишка', 'фишку').replace('лазурная', 'лазурную').replace('алая', 'алую');
    const parts: string[] = [];
    this.used.add(p.id);
    if (a.off) {
      this.pieces = this.pieces.filter((x) => x.id !== p.id);
      this.withdrawn[p.side]++;
      parts.push(`${p.side === 'red' ? 'Алая' : 'Лазурная'} искра уходит за край поля`);
    } else if (a.shift != null) {
      const group = this.stratema(p), to = this.shifted(p, a.shift, a.steps ?? 1)!;
      group.forEach((q, i) => { q.r = to[i].r; q.c = to[i].c; this.used.add(q.id); });
      parts.push(`${p.side === 'red' ? 'Алая' : 'Лазурная'} искра ведёт стратему (${group.length} ${pieces(group.length)}) на ${cellName(p)}`);
    } else if (a.to) {
      p.r = a.to.r; p.c = a.to.c;
      parts.push(`${cap(who(p))} идёт на ${cellName(a.to)}`);
    } else if (p.kind === 'moneta') {
      this.bribe(p, this.byId(a.target!)!, parts, who, whom);
    } else {
      this.attack(p, this.byId(a.target!)!, parts, who, whom);
    }
    this.touches++;
    out.removed = [...before].filter((id) => !this.byId(id));
    out.text = parts.join('; ') + '.';
    this.judge();
    if (!this.over && this.actionsLeft() === 0) this.endTurn();
    return out;
  }

  /**
   * A strike from the cell beside the target. The whole стратема of the attacker that touches the
   * target strikes with it; a castle wall or an archer on a hill strikes first; then the target, if
   * it stands, or a friend of its стратема beside the attacker, strikes back — unless the attacker
   * is a bow.
   */
  private attack(p: Piece, q: Piece, parts: string[], who: (q: Piece) => string, whom: (q: Piece) => string): void {
    const t = this.field[q.r][q.c];
    let answered = false;
    if (q.kind !== 'moneta' && (t === 'ruins' || (t === 'hill' && q.kind === 'strela'))) {
      answered = true;
      const fell = this.land(p, 1, this.pierces(q, p));
      parts.push(`${cap(who(q))} на ${t === 'ruins' ? 'стене' : 'холме'} бьёт первой: ${whom(p)} ${fell ? 'сбивает' : 'ранит'}`);
      if (fell) return;
    }
    const hitters = [p, ...this.group(p).filter((x) => x.id !== p.id && x.kind !== 'moneta' && dist(x, q) === 1)];
    const defenders = this.group(q);
    const fell = this.land(q, hitters.length, hitters.some((h) => this.pierces(h, q)));
    const by = `${parts.length ? 'тогда ' + who(p) : cap(who(p))}${hitters.length > 1 ? ` со стратемой (${hitters.length} ${pieces(hitters.length)})` : ''} бьёт`;
    parts.push(`${by} ${whom(q)} на ${cellName(q)} — ${fell ? 'сбита' : 'ранена'}`);
    if (answered || p.kind === 'strela') return;
    const back = fell ? this.answerer(defenders, p, q.id) : q;
    if (!back) return;
    const down = this.land(p, 1, this.pierces(back, p));
    parts.push(`ответный удар (${STATS[back.kind].name}) ${down ? 'сбивает' : 'ранит'} её`);
  }

  /**
   * A coin bribes the enemy it touches, who turns over to its side: two sickles or bows, or one
   * sword, and then the coin leaves the field; a horseshoe only to two coins at once; a spark never.
   * A стратема answers a bribe of one of its own with a blow like any other attack.
   */
  private bribe(p: Piece, q: Piece, parts: string[], who: (q: Piece) => string, whom: (q: Piece) => string): void {
    const defenders = this.group(q);
    if (q.kind === 'podkova') {
      const mate = this.pledges.find((x) => x.target === q.id && x.coin !== p.id && this.byId(x.coin)?.side === p.side);
      const other = mate && this.byId(mate.coin);
      if (!other || dist(other, q) !== 1) {
        this.pledges.push({ coin: p.id, target: q.id });
        parts.push(`${cap(who(p))} предлагает деньги подкове на ${cellName(q)}: нужна вторая монета в этот же ход`);
        return;
      }
      this.pieces = this.pieces.filter((x) => x.id !== p.id && x.id !== other.id);
      this.spentCoins[p.side] += 2;
    } else {
      p.spent = (p.spent ?? 0) + (q.kind === 'mech' ? 2 : 1);
      if (p.spent >= 2) { this.pieces = this.pieces.filter((x) => x.id !== p.id); this.spentCoins[p.side]++; }
    }
    this.pledges = this.pledges.filter((x) => x.target !== q.id);
    parts.push(q.kind === 'podkova'
      ? `Две ${p.side === 'red' ? 'алые' : 'лазурные'} монеты сообща подкупают ${whom(q)} на ${cellName(q)} и покидают поле`
      : `${cap(who(p))} подкупает ${whom(q)} на ${cellName(q)}${this.byId(p.id) ? '' : ' и покидает поле'}`);
    q.side = p.side;
    this.used.add(q.id);
    if (!this.byId(p.id)) return;
    const back = this.answerer(defenders, p, q.id);
    if (back) { this.land(p, 1, false); parts.push(`стратема отвечает ударом (${STATS[back.kind].name}) — монета сбита`); }
  }

  /** The game ends when a side has no spark left on the field; how it ends depends on how they left. */
  private judge(): void {
    const left = (s: Side) => this.pieces.some((x) => x.side === s && x.kind === 'iskra');
    const red = left('red'), blue = left('blue');
    if (red && blue) return;
    if (!red && !blue) { this.ending = 'draw'; return; }
    const w: Side = red ? 'red' : 'blue', l: Side = red ? 'blue' : 'red';
    this.winner = w;
    const mine = this.pieces.filter((x) => x.side === w && x.kind === 'iskra').length;
    this.ending = mine < this.sparks ? 'dear' : this.withdrawn[l] > 0 ? 'merciful' : 'unconditional';
  }

  /** Both players find the rest of the game pointless. */
  agreeDraw(): void { if (!this.over) this.ending = 'draw'; }

  actionsLeft(): number { return this.perTurn - this.touches; }

  endTurn(): void {
    this.touches = 0;
    this.used.clear();
    this.pledges = [];
    this.side = this.side === 'red' ? 'blue' : 'red';
    if (this.side === 'red') this.turn++;
  }

  /** Every touch available to one piece. */
  actionsFor(p: Piece): Action[] {
    if (this.used.has(p.id)) return [];
    const list: Action[] = [];
    for (const t of this.targets(p)) list.push({ id: p.id, target: t.id });
    for (const to of this.reach(p)) list.push({ id: p.id, to });
    if (p.kind === 'iskra') {
      for (let d = 0; d < 6; d++) for (let s = 1; s <= 2; s++) if (this.shifted(p, d, s)) list.push({ id: p.id, shift: d, steps: s });
      if (this.onBorder(p)) list.push({ id: p.id, off: true });
    }
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
function pieces(n: number): string { return n === 1 ? 'фишка' : n < 5 ? 'фишки' : 'фишек'; }

/**
 * Armies, red side, front row first, in Adrian's «классический порядок»: the spark at the head of a
 * стратема of swords and horseshoes, sickles on the flanks, coins at the back. The short game has
 * the author's basic set of seventeen: a spark, two horseshoes, four swords, two coins, eight
 * sickles, and no bows. The full game doubles it and adds the four bows played «по договоренности».
 */
export function army(sparks: number): Kind[][] {
  const K: Record<string, Kind | ''> = { s: 'serp', m: 'mech', t: 'strela', p: 'podkova', o: 'moneta', I: 'iskra', _: '' };
  const rows = sparks === 1
    ? ['___sssmmsss___', '_____mpIpm____', '_____osso_____']
    : ['_ssmm_ss_mmss_', '_tpIp_ss_pIpt_', '__smmostomms__', '___sstoosss___'];
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
