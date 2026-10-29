import { Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MapPlace } from '../../core/models';
import { Spoilers } from '../../core/spoilers';
import { WikiData } from '../../core/wiki-data';
import { Stop, byDate, chapterStops, keyStops } from './timeline';

const W0 = 3200, H0 = 2410;

interface View { z: number; x: number; y: number; base: number; }

@Component({
  selector: 'app-map-page',
  imports: [RouterLink],
  templateUrl: './map-page.html',
  styleUrl: './map-page.css',
  host: { '(window:resize)': 'fit()' },
})
export class MapPage implements OnDestroy {
  /** ?p=<place key> opens the map centred on that place. */
  readonly p = input<string>();
  protected readonly data = inject(WikiData);
  private readonly spoilers = inject(Spoilers);
  private readonly router = inject(Router);

  protected readonly places = computed(() => this.data.extra().map.places);
  protected readonly placeList = computed(() => Object.entries(this.places()).map(([k, p]) => ({ k, p, title: this.data.title(k), linked: !!this.data.get(k) })));

  protected readonly showLands = signal(true);
  protected readonly showCities = signal(true);
  protected readonly onlyKey = signal(false);
  protected readonly journeySlug = signal('');

  /** Timeline stops the reader may see, sorted by in-world date. */
  protected readonly stops = computed<Stop[]>(() => {
    const ex = this.data.extra();
    const visibleBook = (slug: string) => this.spoilers.bookVisible(this.data.get(slug)?.order ?? 999);
    const key = keyStops(ex.map.events).filter((e) => this.spoilers.eventVisible(e));
    const chapters = this.onlyKey() ? [] : chapterStops(ex.chapters, (s) => this.data.title(s), (s) => this.data.get(s)?.order ?? 0).filter((s) => !s.book || visibleBook(s.book));
    return [...key, ...chapters].filter((s) => this.places()[s.p]).sort(byDate);
  });
  protected readonly cur = signal(0);
  protected readonly stop = computed(() => this.stops()[Math.min(this.cur(), this.stops().length - 1)]);
  /** Stops around the current one, for the vertical list beside the map. */
  protected readonly nearby = computed(() => {
    const s = this.stops(), c = this.cur();
    const from = Math.max(0, Math.min(c - 4, s.length - 14));
    return s.slice(from, from + 14).map((x, k) => ({ s: x, i: from + k }));
  });
  protected readonly trail = computed(() => this.stops().slice(Math.max(0, this.cur() - 4), this.cur()));
  protected readonly ticks = computed(() => {
    const s = this.stops();
    const marks = ['1774-03', '1774-07', '1774-11', '1775-03', '1775-07', '1775-11', '1776'];
    return marks.map((m) => ({ m, i: s.findIndex((x) => x.d >= m) })).filter((t) => t.i > 0)
      .map((t) => ({ i: t.i, left: (t.i / Math.max(s.length - 1, 1)) * 100, label: tickLabel(t.m) }));
  });

  /** Narrators with at least three mapped chapters among the books the reader has read. */
  protected readonly narrators = computed(() => {
    const count = new Map<string, number>();
    for (const b of this.data.books()) {
      if (!this.spoilers.bookVisible(b.order)) continue;
      for (const c of this.data.extra().chapters[b.slug] ?? []) if (c.pov && c.key && this.places()[c.key]) count.set(c.pov, (count.get(c.pov) ?? 0) + 1);
    }
    return [...count.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
  });
  protected readonly journey = computed(() => {
    const slug = this.journeySlug();
    if (!slug) return [];
    const pts: { key: string; items: { book: string; c: import('../../core/models').Chapter }[] }[] = [];
    for (const b of this.data.books()) {
      if (!this.spoilers.bookVisible(b.order)) continue;
      for (const c of this.data.extra().chapters[b.slug] ?? []) {
        if (c.pov !== slug || !c.key || !this.places()[c.key]) continue;
        const last = pts[pts.length - 1];
        if (last && last.key === c.key) last.items.push({ book: b.slug, c });
        else pts.push({ key: c.key, items: [{ book: b.slug, c }] });
      }
    }
    return pts;
  });
  protected readonly step = signal(0);

  protected readonly popup = signal<string>('');
  protected readonly popupEvents = computed(() => this.stops().map((s, i) => ({ s, i })).filter(({ s }) => s.p === this.popup() && s.key).slice(0, 8));
  protected readonly playing = signal(false);
  protected readonly view = signal<View>({ z: 1, x: 0, y: 0, base: 0.2 });

  private readonly viewEl = viewChild.required<ElementRef<HTMLDivElement>>('view');
  private timer: ReturnType<typeof setInterval> | null = null;
  private drag: [number, number] | null = null;
  private moved = false;
  private pending = '';

  constructor() {
    effect(() => { const p = this.p(); if (p) untracked(() => (this.pending = p)); });
    effect(() => {
      // Start the timeline at the opening of the first book.
      const s = this.stops();
      untracked(() => this.cur.set(Math.max(0, s.findIndex((x) => x.d >= '1774-03-21'))));
    });
  }

  ngOnDestroy(): void { this.stopPlay(); }

  /* ---------- view ---------- */
  protected imageLoaded(): void { this.fit(); }

  fit(): void {
    const el = this.viewEl().nativeElement;
    if (!el.clientWidth) return;
    const base = Math.min(el.clientWidth / W0, el.clientHeight / H0);
    let v: View = { z: 1, base, x: (el.clientWidth - W0 * base) / 2, y: (el.clientHeight - H0 * base) / 2 };
    if (el.clientWidth < 640) v = zoomAt(v, el.clientHeight / (H0 * base), el.clientWidth / 2, el.clientHeight / 2);
    this.view.set(v);
    if (this.pending && this.places()[this.pending]) { const k = this.pending; this.pending = ''; this.centre(this.places()[k], 3); this.popup.set(k); }
  }

  protected px(p: MapPlace): number { const v = this.view(); return v.x + (p.x / 100) * W0 * v.z * v.base; }
  protected py(p: MapPlace): number { const v = this.view(); return v.y + (p.y / 100) * H0 * v.z * v.base; }
  protected imgTransform(): string { const v = this.view(); return `translate(${v.x}px, ${v.y}px) scale(${v.z * v.base})`; }
  protected labelsOn(): boolean { const v = this.view(); return v.z * v.base * W0 > 2600; }

  protected zoom(f: number, cx?: number, cy?: number): void {
    const el = this.viewEl().nativeElement;
    this.view.set(zoomAt(this.view(), f, cx ?? el.clientWidth / 2, cy ?? el.clientHeight / 2));
  }

  private centre(p: MapPlace, minZ = 0): void {
    const el = this.viewEl().nativeElement;
    const v = { ...this.view() };
    if (minZ && v.z < minZ) v.z = minZ;
    v.x = el.clientWidth / 2 - (p.x / 100) * W0 * v.z * v.base;
    v.y = el.clientHeight / 2 - (p.y / 100) * H0 * v.z * v.base;
    this.view.set(v);
  }

  protected wheel(ev: WheelEvent): void {
    ev.preventDefault();
    const r = this.viewEl().nativeElement.getBoundingClientRect();
    this.zoom(ev.deltaY < 0 ? 1.2 : 1 / 1.2, ev.clientX - r.left, ev.clientY - r.top);
  }
  protected down(ev: PointerEvent): void {
    if ((ev.target as HTMLElement).closest('.pop')) return;
    const v = this.view(); this.drag = [ev.clientX - v.x, ev.clientY - v.y]; this.moved = false;
  }
  protected move(ev: PointerEvent): void {
    if (!this.drag) return;
    const v = this.view(), nx = ev.clientX - this.drag[0], ny = ev.clientY - this.drag[1];
    if (Math.abs(nx - v.x) + Math.abs(ny - v.y) > 3) this.moved = true;
    if (this.moved) this.view.set({ ...v, x: nx, y: ny });
  }
  protected up(): void { this.drag = null; }

  /* ---------- interactions ---------- */
  protected openPlace(k: string): void { if (!this.moved) this.popup.set(this.popup() === k ? '' : k); }
  protected placeTitle(k: string): string { return this.data.title(k); }
  protected summary(k: string): string { return this.data.get(k)?.summary ?? ''; }
  protected linked(k: string): boolean { return !!this.data.get(k); }
  protected goPlace(k: string): void { this.router.navigateByUrl('/' + k); }

  protected show(i: number, recentre = true): void {
    const n = this.stops().length;
    if (!n) return;
    this.cur.set(Math.max(0, Math.min(n - 1, i)));
    this.popup.set('');
    const p = this.places()[this.stop().p];
    if (recentre && p && this.view().z > 1.2) {
      const el = this.viewEl().nativeElement, x = this.px(p), y = this.py(p);
      if (x < 40 || y < 40 || x > el.clientWidth - 40 || y > el.clientHeight - 40) this.centre(p);
    }
  }
  protected togglePlay(): void {
    if (this.timer) return this.stopPlay();
    if (this.cur() >= this.stops().length - 1) this.show(0);
    this.playing.set(true);
    this.timer = setInterval(() => { if (this.cur() >= this.stops().length - 1) this.stopPlay(); else this.show(this.cur() + 1); }, 2600);
  }
  private stopPlay(): void { if (this.timer) clearInterval(this.timer); this.timer = null; this.playing.set(false); }

  protected setJourney(slug: string): void { this.stopPlay(); this.journeySlug.set(slug); this.step.set(0); }
  protected showStep(i: number): void {
    const j = this.journey();
    if (!j[i]) return;
    this.step.set(i);
    const p = this.places()[j[i].key];
    if (this.view().z > 1.2) this.centre(p);
  }
  protected journeyPoints(): string { return this.journey().map((j) => `${this.px(this.places()[j.key])},${this.py(this.places()[j.key])}`).join(' '); }
  protected bookTitle(slug: string): string { return this.data.title(slug); }
}

function zoomAt(v: View, f: number, cx: number, cy: number): View {
  const z = Math.min(Math.max(v.z * f, 1), 12);
  return { ...v, z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) };
}

function tickLabel(m: string): string {
  const months = ['', 'янв.', 'фев.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сен.', 'окт.', 'нояб.', 'дек.'];
  return m.length > 4 ? `${months[+m.slice(5)]} ${m.slice(0, 4)}` : `${m} г.`;
}
