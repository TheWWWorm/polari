import { Component, OnDestroy, computed, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Action, COLS, Cell, DEPLOY, Game, Kind, Piece, ROWS, STATS, Side, TERRAIN, Terrain, army, cellName, makeField, roadLinks, step } from './engine';
import { acceptsDraw, chooseTurn } from './opponent';
import { GLYPH } from './glyphs';
import { BoardPiece, StratemyBoard3d } from './board3d';

/** Hex radius of the flat board; flat side up, odd columns half a cell lower. */
const HR = 22, SQ = Math.sqrt(3);
const hexPoints = (rad: number) => [0, 60, 120, 180, 240, 300].map((a) => `${(rad * Math.cos(a * Math.PI / 180)).toFixed(2)},${(rad * Math.sin(a * Math.PI / 180)).toFixed(2)}`).join(' ');
const KINDS: Kind[] = ['iskra', 'podkova', 'mech', 'moneta', 'serp', 'strela'];

interface Hint { text: string; good: boolean }

@Component({
  selector: 'app-stratemy-page',
  imports: [RouterLink, StratemyBoard3d],
  templateUrl: './stratemy-page.html',
  styleUrl: './stratemy-page.css',
})
export class StratemyPage implements OnDestroy {
  protected readonly hexPts = hexPoints(HR * 0.97);
  protected readonly rimPts = hexPoints(HR * 1.3);
  protected readonly boardW = (COLS - 1) * 1.5 * HR + 2 * HR;
  protected readonly boardH = (ROWS + 0.5) * SQ * HR;
  protected readonly rows = Array.from({ length: ROWS }, (_, i) => i);
  protected readonly cols = Array.from({ length: COLS }, (_, i) => i);
  protected readonly glyph = GLYPH;
  protected readonly stats = STATS;
  protected readonly terrainInfo = TERRAIN;
  protected readonly kinds = KINDS;
  protected readonly letters = 'АБВГДЕЖЗИКЛМНО'.slice(0, COLS).split('');

  protected readonly vsComputer = signal(true);
  protected readonly view3d = signal(true);
  /** One spark for the short game, two for the full one. */
  protected readonly sparks = signal(1);
  protected readonly seed = signal(newSeed());
  protected readonly phase = signal<'setup' | 'play'>('setup');
  private readonly game = signal(this.fresh());
  /** Bumped after every change to the mutable game. */
  private readonly tick = signal(0);
  protected readonly selected = signal<number | null>(null);
  protected readonly hover = signal<number | null>(null);
  protected readonly log = signal<{ side: Side; turn: number; text: string }[]>([]);
  protected readonly thinking = signal(false);
  private timers: ReturnType<typeof setTimeout>[] = [];

  // the game is mutated in place, so every tick must count as a change downstream
  protected readonly view = computed(() => { this.tick(); return this.game(); }, { equal: () => false });
  protected readonly pieces = computed(() => this.view().pieces.slice());
  protected readonly field = computed(() => this.game().field);
  protected readonly sel = computed(() => { const id = this.selected(); return id == null ? undefined : this.view().byId(id); });
  protected readonly reach = computed<Cell[]>(() => {
    const p = this.sel(), g = this.view();
    if (!p) return [];
    if (this.phase() === 'setup') return this.setupCells(p.side);
    if (!this.canAct(p)) return [];
    if (this.lead()) return this.leadMoves().map((m) => m.to);
    return g.reach(p);
  });
  /** Where the selected spark can lead its стратема: a direction and up to its slowest piece's speed. */
  private readonly leadMoves = computed(() => {
    const p = this.sel(), g = this.view(), out: { dir: number; steps: number; to: Cell }[] = [];
    if (!p || !this.lead()) return out;
    for (let dir = 0; dir < 6; dir++) {
      let at: Cell = p;
      for (let steps = 1; g.shifted(p, dir, steps); steps++) { at = step(at, dir)!; out.push({ dir, steps, to: at }); }
    }
    return out;
  });
  protected readonly targets = computed<Piece[]>(() => {
    const p = this.sel(), g = this.view();
    if (!p || this.phase() === 'setup' || this.lead() || !this.canAct(p)) return [];
    return g.targets(p);
  });
  /** Whether the selected spark leads its whole стратема instead of moving alone. */
  protected readonly lead = linkedSignal<number | null, boolean>({ source: () => this.selected(), computation: () => false });
  /** The стратема that moves with the spark: the spark and the friends beside it. */
  protected readonly led = computed(() => {
    const p = this.sel();
    return new Set(p && this.lead() ? this.view().stratema(p).map((q) => q.id) : []);
  });
  protected readonly canLead = computed(() => {
    const p = this.sel();
    return !!p && this.phase() === 'play' && p.kind === 'iskra' && this.canAct(p) && this.view().stratema(p).length > 1;
  });
  /** A spark on the rim of the field may be led away: the game given up with honour. */
  protected readonly canLeave = computed(() => {
    const p = this.sel();
    return !!p && this.phase() === 'play' && p.kind === 'iskra' && this.canAct(p) && this.view().onBorder(p);
  });
  protected readonly boardPieces = computed<BoardPiece[]>(() => {
    const g = this.view(), sel = this.selected(), targets = this.targets(), group = this.led();
    return g.pieces.map((p) => {
      return { id: p.id, kind: p.kind, side: p.side, r: p.r, c: p.c, sel: sel === p.id || group.has(p.id),
        target: targets.some((t) => t.id === p.id), can: this.canAct(p), hurt: !!p.hurt };
    });
  });
  /** Every cell on the board with its centre. */
  protected readonly hexes = computed(() => {
    const f = this.field(), out = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = f[r][c];
      if (t === 'edge') continue;
      const at = this.hexAt({ r, c });
      out.push({ k: r * COLS + c, r, c, t, x: at.x, y: at.y });
    }
    return out;
  });
  protected readonly roads = computed(() => roadLinks(this.field()).map(([a, b]) => ({ a: this.hexAt(a), b: this.hexAt(b) })));
  protected readonly colLabels = computed(() => this.cols.map((c) => {
    const r = [...this.rows].reverse().find((r) => this.field()[r][c] !== 'edge')!;
    const at = this.hexAt({ r, c });
    return { text: this.letters[c], x: at.x, y: at.y + HR * 1.45 };
  }));
  protected readonly rowLabels = computed(() => this.rows.map((r) => {
    const c = this.cols.find((c) => this.field()[r][c] !== 'edge')!;
    const at = this.hexAt({ r, c });
    return { text: String(ROWS - r), x: at.x - HR * 2.1, y: at.y };
  }));
  protected readonly hint = computed<Hint | null>(() => {
    const p = this.sel(), h = this.hover(), g = this.view();
    if (!p || h == null) return null;
    const q = g.byId(h);
    if (!q || !this.targets().some((t) => t.id === q.id)) return null;
    // blows are certain, so the hint simply plays the touch on a copy
    const g2 = g.clone(), out = g2.apply({ id: p.id, target: q.id });
    const q2 = g2.byId(q.id), gained = !q2 || q2.side === p.side || (!q.hurt && !!q2.hurt);
    const kept = !!g2.byId(p.id) || p.kind === 'moneta';
    return { text: `Если коснуться: ${out.text[0].toLowerCase()}${out.text.slice(1)}`, good: gained && kept };
  });
  protected readonly status = computed(() => {
    const g = this.view();
    if (this.phase() === 'setup') return 'Расставьте войско: выберите свою фишку и клетку в четырёх нижних рядах. Затем начните партию.';
    if (g.over) {
      const w = g.winner === 'red' ? 'алых' : 'лазурных';
      switch (g.ending) {
        case 'unconditional': return `Безоговорочная победа ${w}: все искры противника сбиты, свои целы. Ставка выплачивается вдвойне.`;
        case 'merciful': return `Милосердная победа ${w}. «Поле ваше, сударь». — «Мудрый выбор». Победитель поднимает кубок за здоровье побеждённого.`;
        case 'dear': return `Дорогая победа ${w}: победитель потерял искру. Кубок пьют без поздравлений.`;
        default: return 'Ничья: соперники сочли дальнейшую партию бессмысленной.';
      }
    }
    if (this.thinking()) return 'Лазурные обдумывают ход…';
    const who = g.side === 'red' ? 'алых' : 'лазурных';
    return `Ход ${g.turn}, очередь ${who}. Осталось касаний: ${g.actionsLeft()} из ${g.perTurn}. Одну фишку за ход можно тронуть лишь раз.`;
  });
  protected readonly lost = computed(() => {
    const g = this.view(), start = this.fresh();
    const count = (gm: Game, side: Side) => KINDS.map((k) => gm.pieces.filter((p) => p.side === side && p.kind === k).length);
    return (['red', 'blue'] as Side[]).map((side) => {
      const before = count(start, side), now = count(g, side);
      // coins that paid out and sparks led off the field were not struck down
      const gone = (k: Kind) => (k === 'moneta' ? g.spentCoins[side] : k === 'iskra' ? g.withdrawn[side] : 0);
      return { side, items: KINDS.map((k, i) => ({ k, n: before[i] - now[i] - gone(k) })).filter((x) => x.n > 0) };
    });
  });

  ngOnDestroy(): void { this.timers.forEach(clearTimeout); }

  private fresh(): Game { return new Game(makeField(this.seed()), army(this.sparks()), this.sparks()); }
  private bump(): void { this.tick.update((n) => n + 1); }

  protected restart(seed = this.seed()): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.seed.set(seed);
    this.game.set(this.fresh());
    this.phase.set('setup');
    this.selected.set(null);
    this.log.set([]);
    this.thinking.set(false);
    this.bump();
  }
  protected newField(): void { this.restart(newSeed()); }
  protected setSparks(n: number): void { this.sparks.set(n); this.restart(); }
  protected setMode(vs: boolean): void { this.vsComputer.set(vs); this.restart(); }
  protected start(): void { this.phase.set('play'); this.selected.set(null); this.bump(); }

  private setupCells(side: Side): Cell[] {
    const rows = Array.from({ length: DEPLOY }, (_, k) => (side === 'red' ? ROWS - 1 - k : k));
    return rows.flatMap((r) => this.cols.filter((c) => this.field()[r][c] !== 'edge').map((c) => ({ r, c })));
  }

  protected hexAt(p: Cell): { x: number; y: number } { return { x: p.c * 1.5 * HR + HR, y: (p.r + (p.c & 1) * 0.5) * SQ * HR + SQ / 2 * HR }; }
  protected terrainAt(r: number, c: number): Terrain { return this.field()[r][c]; }
  protected isReach(r: number, c: number): boolean { return this.reach().some((x) => x.r === r && x.c === c); }
  protected isTarget(id: number): boolean { return this.targets().some((t) => t.id === id); }
  protected inLead(id: number): boolean { return this.led().has(id); }
  protected cellName(r: number, c: number): string { return cellName({ r, c }); }
  protected canAct(p: Piece): boolean {
    const g = this.view();
    if (this.phase() === 'setup') return p.side === 'red' || !this.vsComputer();
    return !g.over && !this.thinking() && p.side === g.side && g.actionsLeft() > 0 && !g.used.has(p.id) && (!this.vsComputer() || p.side === 'red');
  }
  protected label(p: Piece): string {
    return `${p.side === 'red' ? 'Алая' : 'Лазурная'} фишка «${STATS[p.kind].name}»${p.hurt ? ', ранена,' : ''} на ${cellName(p)}`;
  }

  protected clickPieceId(id: number): void { const p = this.view().byId(id); if (p) this.clickPiece(p); }

  protected clickPiece(p: Piece, ev?: Event): void {
    ev?.stopPropagation();
    if (this.isTarget(p.id)) return this.act({ id: this.selected()!, target: p.id });
    if (this.phase() === 'setup') {
      const s = this.sel();
      if (s && s.side === p.side && s.id !== p.id) { [s.r, s.c, p.r, p.c] = [p.r, p.c, s.r, s.c]; this.selected.set(null); this.bump(); return; }
    }
    this.selected.set(this.canAct(p) && this.selected() !== p.id ? p.id : null);
  }

  protected clickCell(r: number, c: number): void {
    const p = this.sel();
    if (!p || !this.isReach(r, c)) { this.selected.set(null); return; }
    if (this.phase() === 'setup') { p.r = r; p.c = c; this.selected.set(null); this.bump(); return; }
    if (this.lead()) {
      const m = this.leadMoves().find((m) => m.to.r === r && m.to.c === c);
      if (m) this.act({ id: p.id, shift: m.dir, steps: m.steps });
      return;
    }
    this.act({ id: p.id, to: { r, c } });
  }

  protected cancel(): void { this.selected.set(null); }
  /** Lead the selected spark off the field. */
  protected leave(): void { const p = this.sel(); if (p) this.act({ id: p.id, off: true }); }

  /** Offer a draw: at the table both agree; the computer agrees only when it is not ahead. */
  protected offerDraw(): void {
    const g = this.view();
    if (g.over || this.thinking()) return;
    const side = g.side, ok = !this.vsComputer() || acceptsDraw(g);
    if (ok) g.agreeDraw();
    this.log.update((l) => [{ side, turn: g.turn, text: ok ? 'Соперники соглашаются на ничью.' : 'Лазурные отклоняют ничью.' }, ...l].slice(0, 60));
    this.cancel();
    this.bump();
  }

  protected endTurn(): void {
    const g = this.view();
    if (g.over || this.thinking()) return;
    this.cancel();
    g.endTurn();
    this.bump();
    this.afterHuman();
  }

  private act(a: Action): void {
    const g = this.view();
    if (!g.legal(a)) return;
    const side = g.side, turn = g.turn;
    const out = g.apply(a);
    this.log.update((l) => [{ side, turn, text: out.text }, ...l].slice(0, 60));
    // a touched piece is tired for the rest of the turn, so it leaves the hand
    this.selected.set(null);
    this.bump();
    if (g.side !== side) this.afterHuman();
  }

  private afterHuman(): void {
    const g = this.view();
    if (!this.vsComputer() || g.over || g.side !== 'blue') return;
    this.thinking.set(true);
    this.timers.push(setTimeout(() => {
      const plan = chooseTurn(g);
      const step = (i: number) => {
        if (i >= plan.length || g.over || g.side !== 'blue') {
          if (!g.over && g.side === 'blue') g.endTurn();
          this.thinking.set(false);
          this.bump();
          return;
        }
        const turn = g.turn, out = g.apply(plan[i]);
        this.log.update((l) => [{ side: 'blue' as Side, turn, text: out.text }, ...l].slice(0, 60));
        this.bump();
        this.timers.push(setTimeout(() => step(i + 1), 650));
      };
      step(0);
    }, 350));
  }
}

function newSeed(): number { return Math.floor(Math.random() * 9000) + 1000; }
