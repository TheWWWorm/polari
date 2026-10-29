import { Component, OnDestroy, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Action, COLS, Cell, Game, Kind, Piece, ROWS, STATS, Side, TERRAIN, Terrain, army, cellName, makeField } from './engine';
import { chooseTurn } from './opponent';

const SIZE = 44;
/** Pictograms carved on the pieces, drawn in a 24-unit box. */
export const GLYPH: Record<Kind, string> = {
  serp: 'M16 4.5a7.5 7.5 0 1 0 2.5 9.5A5.6 5.6 0 1 1 16 4.5ZM8.5 15.5 4.5 20',
  mech: 'M12 3v13M7.5 16h9M12 16v5',
  strela: 'M5 19 19 5M19 5h-6M19 5v6M5 19h3M5 19v-3',
  podkova: 'M7 20v-8a5 5 0 0 1 10 0v8M5.5 20h3M15.5 20h3',
  moneta: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM12 8.5v7',
  iskra: 'M12 2.5l2.3 6.6H21l-5.5 4 2.1 6.9L12 15.8 6.4 20l2.1-6.9L3 9.1h6.7Z',
};
const KINDS: Kind[] = ['iskra', 'podkova', 'mech', 'strela', 'moneta', 'serp'];

interface Hint { text: string; good: boolean }

@Component({
  selector: 'app-stratemy-page',
  imports: [RouterLink],
  templateUrl: './stratemy-page.html',
  styleUrl: './stratemy-page.css',
})
export class StratemyPage implements OnDestroy {
  protected readonly size = SIZE;
  protected readonly rows = Array.from({ length: ROWS }, (_, i) => i);
  protected readonly cols = Array.from({ length: COLS }, (_, i) => i);
  protected readonly glyph = GLYPH;
  protected readonly stats = STATS;
  protected readonly terrainInfo = TERRAIN;
  protected readonly kinds = KINDS;
  protected readonly letters = 'АБВГДЕЖЗИКЛМНО'.slice(0, COLS).split('');

  protected readonly vsComputer = signal(true);
  protected readonly sparks = signal(2);
  protected readonly seed = signal(newSeed());
  protected readonly phase = signal<'setup' | 'play'>('setup');
  private readonly game = signal(this.fresh());
  /** Bumped after every change to the mutable game. */
  private readonly tick = signal(0);
  protected readonly selected = signal<number | null>(null);
  /** A horseshoe or coin that has moved and may still strike from its new cell. */
  protected readonly staged = signal<{ id: number; to: Cell } | null>(null);
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
    if (!p || this.staged()) return [];
    if (this.phase() === 'setup') return this.setupCells(p.side);
    return g.used.has(p.id) || p.side !== g.side ? [] : g.reach(p);
  });
  protected readonly targets = computed<Piece[]>(() => {
    const p = this.sel(), g = this.view(), st = this.staged();
    if (!p || this.phase() === 'setup' || g.used.has(p.id) || p.side !== g.side) return [];
    return g.targets(p, st?.to ?? p);
  });
  protected readonly hint = computed<Hint | null>(() => {
    const p = this.sel(), h = this.hover(), g = this.view();
    if (!p || h == null) return null;
    const q = g.byId(h);
    if (!q || !this.targets().some((t) => t.id === q.id)) return null;
    if (p.kind === 'moneta') return { text: `Монета подкупит этот меч: он перейдёт на вашу сторону.`, good: true };
    const g2 = g.clone(), p2 = g2.byId(p.id)!, st = this.staged();
    if (st) { p2.r = st.to.r; p2.c = st.to.c; }
    const a = g2.attackValue(p2, g2.byId(q.id)!), d = g2.defenceValue(g2.byId(q.id)!), res = g2.strike(p2, g2.byId(q.id)!);
    const verdict = res === 'win' ? 'фишка будет сбита' : res === 'lost' ? 'удар отобьют, и ответный удар собьёт вашу фишку' : 'удар отобьют';
    return { text: `Удар ${a} против защиты ${d}: ${verdict}.`, good: res === 'win' };
  });
  protected readonly status = computed(() => {
    const g = this.view();
    if (this.phase() === 'setup') return 'Расставьте войско: выберите свою фишку и клетку в трёх нижних рядах. Затем начните партию.';
    if (g.winner) return g.winner === 'red' ? 'Победа алых: все лазурные искры сбиты.' : 'Победа лазурных: все алые искры сбиты.';
    if (this.thinking()) return 'Лазурные обдумывают ход…';
    const who = g.side === 'red' ? 'алых' : 'лазурных';
    return `Ход ${g.turn}, очередь ${who}. Осталось движений: ${g.actionsLeft()} из 3.`;
  });
  protected readonly lost = computed(() => {
    const g = this.view(), start = this.fresh();
    const count = (gm: Game, side: Side) => KINDS.map((k) => gm.pieces.filter((p) => p.side === side && p.kind === k).length);
    return (['red', 'blue'] as Side[]).map((side) => {
      const before = count(start, side), now = count(g, side);
      return { side, items: KINDS.map((k, i) => ({ k, n: before[i] - now[i] })).filter((x) => x.n > 0) };
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
    this.staged.set(null);
    this.log.set([]);
    this.thinking.set(false);
    this.bump();
  }
  protected newField(): void { this.restart(newSeed()); }
  protected setSparks(n: number): void { this.sparks.set(n); this.restart(); }
  protected setMode(vs: boolean): void { this.vsComputer.set(vs); this.restart(); }
  protected start(): void { this.phase.set('play'); this.selected.set(null); this.bump(); }

  private setupCells(side: Side): Cell[] {
    const rows = side === 'red' ? [ROWS - 3, ROWS - 2, ROWS - 1] : [0, 1, 2];
    return rows.flatMap((r) => this.cols.map((c) => ({ r, c })));
  }

  protected terrainAt(r: number, c: number): Terrain { return this.field()[r][c]; }
  protected isReach(r: number, c: number): boolean { return this.reach().some((x) => x.r === r && x.c === c); }
  protected isTarget(id: number): boolean { return this.targets().some((t) => t.id === id); }
  protected used(id: number): boolean { return this.view().used.has(id); }
  protected cellName(r: number, c: number): string { return cellName({ r, c }); }
  protected piecePos(p: Piece): Cell { const st = this.staged(); return st && st.id === p.id ? st.to : p; }
  protected canAct(p: Piece): boolean {
    const g = this.view();
    if (this.phase() === 'setup') return p.side === 'red' || !this.vsComputer();
    return !g.winner && !this.thinking() && p.side === g.side && !g.used.has(p.id) && (!this.vsComputer() || p.side === 'red');
  }
  protected label(p: Piece): string {
    return `${p.side === 'red' ? 'Алая' : 'Лазурная'} фишка «${STATS[p.kind].name}» на ${cellName(p)}`;
  }

  protected clickPiece(p: Piece, ev: Event): void {
    ev.stopPropagation();
    if (this.isTarget(p.id)) return this.act({ id: this.selected()!, to: this.staged()?.to, target: p.id });
    if (this.phase() === 'setup') {
      const s = this.sel();
      if (s && s.side === p.side && s.id !== p.id) { [s.r, s.c, p.r, p.c] = [p.r, p.c, s.r, s.c]; this.selected.set(null); this.bump(); return; }
    }
    if (this.staged()) return;
    this.selected.set(this.canAct(p) && this.selected() !== p.id ? p.id : null);
  }

  protected clickCell(r: number, c: number): void {
    const p = this.sel();
    if (!p || !this.isReach(r, c)) { if (!this.staged()) this.selected.set(null); return; }
    if (this.phase() === 'setup') { p.r = r; p.c = c; this.selected.set(null); this.bump(); return; }
    const g = this.view();
    if (Game.movesThenActs(p.kind) && g.targets(p, { r, c }).length) { this.staged.set({ id: p.id, to: { r, c } }); return; }
    this.act({ id: p.id, to: { r, c } });
  }

  /** Finish a staged move without striking. */
  protected settle(): void { const st = this.staged(); if (st) this.act({ id: st.id, to: st.to }); }
  protected cancel(): void { this.staged.set(null); this.selected.set(null); }

  protected endTurn(): void {
    const g = this.view();
    if (g.winner || this.thinking()) return;
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
    this.staged.set(null);
    this.selected.set(null);
    this.bump();
    if (g.side !== side) this.afterHuman();
  }

  private afterHuman(): void {
    const g = this.view();
    if (!this.vsComputer() || g.winner || g.side !== 'blue') return;
    this.thinking.set(true);
    this.timers.push(setTimeout(() => {
      const plan = chooseTurn(g);
      const step = (i: number) => {
        if (i >= plan.length || g.winner || g.side !== 'blue') {
          if (!g.winner && g.side === 'blue') g.endTurn();
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
