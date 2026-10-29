import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Relation } from '../../core/models';
import { norm } from '../../core/search';
import { Spoilers } from '../../core/spoilers';
import { WikiData } from '../../core/wiki-data';
import { layoutGraph, GraphNode } from './graph-layout';

export const REL_COLORS: Record<string, string> = {
  'родня': '#9a7a32', 'супруги': '#b0477a', 'любовь': '#d1495b', 'союз': '#2f7d5b', 'служба': '#3a6f9c', 'вражда': '#7d2235', 'наставник': '#6f55a8',
};

@Component({
  selector: 'app-relations-page',
  imports: [RouterLink],
  templateUrl: './relations.html',
  styleUrl: './relations.css',
})
export class RelationsPage {
  readonly id = input<string>();
  protected readonly data = inject(WikiData);
  private readonly spoilers = inject(Spoilers);
  protected readonly colors = Object.entries(REL_COLORS);
  protected readonly hiddenTypes = signal<Set<string>>(new Set());
  protected readonly selected = signal<string>('');
  protected readonly view = signal<[number, number, number, number]>([0, 0, 1000, 800]);

  /** Edges the reader may see: known by the chosen book, between characters not hidden as spoilers. */
  protected readonly edges = computed<Relation[]>(() =>
    this.data.extra().relations.filter((r) =>
      this.spoilers.bookVisible(r.o) && !this.spoilers.hidden(this.data.get(r.a)) && !this.spoilers.hidden(this.data.get(r.b))),
  );
  protected readonly nodes = computed<GraphNode[]>(() => layoutGraph(this.edges()));
  protected readonly byId = computed(() => new Map(this.nodes().map((n) => [n.id, n])));
  protected readonly neighbours = computed(() => {
    const s = this.selected();
    const set = new Set<string>(s ? [s] : []);
    for (const r of this.edges()) { if (r.a === s) set.add(r.b); if (r.b === s) set.add(r.a); }
    return set;
  });
  protected readonly details = computed(() => {
    const s = this.selected();
    if (!s) return [];
    const mine = this.edges().filter((r) => r.a === s || r.b === s);
    return this.colors.map(([t, c]) => ({ t, c, items: mine.filter((r) => r.t === t) })).filter((g) => g.items.length);
  });

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');
  private drag: [number, number, number, number] | null = null;
  private moved = false;

  constructor() {
    effect(() => {
      const ns = this.nodes();
      if (!ns.length) return;
      const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y);
      const minX = Math.min(...xs) - 80, minY = Math.min(...ys) - 50;
      this.view.set([minX, minY, Math.max(...xs) + 80 - minX, Math.max(...ys) + 50 - minY]);
    });
    effect(() => { const id = this.id(); if (id) this.selected.set(id); });
  }

  protected viewBox(): string { return this.view().join(' '); }
  protected name(id: string): string { return this.data.title(id); }
  protected color(t: string): string { return REL_COLORS[t] ?? '#888'; }
  protected radius(n: GraphNode): number { return 5 + Math.sqrt(n.degree) * 2.3; }
  protected toggleType(t: string): void {
    this.hiddenTypes.update((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  }
  protected pick(id: string): void { if (!this.moved) this.selected.set(this.selected() === id ? '' : id); }
  protected find(q: string): void {
    const v = norm(q);
    if (!v) { this.selected.set(''); return; }
    const n = this.nodes().find((x) => norm(this.name(x.id)).includes(v));
    if (n) this.selected.set(n.id);
  }

  protected down(ev: PointerEvent): void { const v = this.view(); this.drag = [ev.clientX, ev.clientY, v[0], v[1]]; this.moved = false; }
  protected move(ev: PointerEvent): void {
    if (!this.drag) return;
    const el = this.svg()!.nativeElement;
    const v = this.view(), s = v[2] / el.clientWidth;
    const dx = ev.clientX - this.drag[0], dy = ev.clientY - this.drag[1];
    if (Math.abs(dx) + Math.abs(dy) > 4) this.moved = true;
    this.view.set([this.drag[2] - dx * s, this.drag[3] - dy * s, v[2], v[3]]);
  }
  protected up(): void { this.drag = null; setTimeout(() => (this.moved = false)); }
  protected wheel(ev: WheelEvent): void {
    ev.preventDefault();
    const el = this.svg()!.nativeElement, r = el.getBoundingClientRect(), v = this.view();
    const f = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
    const px = v[0] + ((ev.clientX - r.left) / r.width) * v[2], py = v[1] + ((ev.clientY - r.top) / r.height) * v[3];
    this.view.set([px - (px - v[0]) * f, py - (py - v[1]) * f, v[2] * f, v[3] * f]);
  }
}
