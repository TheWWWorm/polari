import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { byTitle } from '../../core/format';
import { TYPE_LABELS } from '../../core/models';
import { Spoilers } from '../../core/spoilers';
import { WikiData } from '../../core/wiki-data';
import { ChapterTable } from '../../shared/chapter-table';
import { FamilyTree } from '../../shared/family-tree';
import { Figure } from '../../shared/figure';
import { HousesTable } from '../../shared/houses-table';
import { MiniMap } from '../../shared/mini-map';
import { applySpoilers } from './spoiler-dom';

@Component({
  selector: 'app-article-page',
  imports: [RouterLink, Figure, ChapterTable, FamilyTree, HousesTable, MiniMap],
  host: { '(window:resize)': 'updateCompact()' },
  templateUrl: './article.html',
  styleUrl: './article.css',
})
export class ArticlePage {
  protected readonly compact = signal(matchMedia('(max-width: 700px)').matches);
  protected updateCompact(): void {
    this.compact.set(matchMedia('(max-width: 700px)').matches);
  }
  readonly slug = input.required<string>();
  readonly anchor = input<string>();

  protected readonly data = inject(WikiData);
  protected readonly spoilers = inject(Spoilers);
  private readonly router = inject(Router);
  private readonly titleSvc = inject(Title);
  protected readonly types = TYPE_LABELS;

  protected readonly meta = computed(() => this.data.get(this.slug()));
  protected readonly body = resource({
    params: () => this.meta()?.slug,
    loader: ({ params }) => this.data.body(params),
  });
  protected readonly lead = computed(() => this.meta()?.image ?? null);
  protected readonly bookChips = computed(() =>
    (this.meta()?.books ?? [])
      .filter((b) => b !== this.slug() && this.data.get(b))
      .map((b) => this.data.get(b)!),
  );
  protected readonly backlinks = computed(() =>
    (this.meta()?.backlinks ?? [])
      .map((s) => this.data.get(s)!)
      .filter(Boolean)
      .sort(byTitle),
  );
  protected readonly families = computed(() =>
    this.data.extra().families.filter((f) => f.house === this.slug()),
  );
  protected readonly onMap = computed(() => !!this.data.extra().map.places[this.slug()]);
  /** The place itself plus its neighbours that have articles, so the crop shows where it lies. */
  protected readonly mapKeys = computed(() => {
    const places = this.data.extra().map.places,
      me = places[this.slug()];
    if (!me) return [];
    const near = Object.entries(places).filter(
      ([k, p]) =>
        k !== this.slug() &&
        p.kind !== 'land' &&
        this.data.get(k) &&
        Math.hypot(p.x - me.x, (p.y - me.y) * 0.75) < 9,
    );
    return [this.slug(), ...near.map(([k]) => k)];
  });
  protected readonly hasRelations = computed(() =>
    this.data.extra().relations.some((r) => r.a === this.slug() || r.b === this.slug()),
  );
  protected readonly toc = computed(() => {
    const t = [...(this.body.value()?.toc ?? [])];
    if (this.data.extra().chapters[this.slug()]?.length) t.push(['h-glavy', 'Главы']);
    if (this.families().length) t.push(['h-rod', 'Родословное древо']);
    return t;
  });

  private readonly content = viewChild<ElementRef<HTMLElement>>('content');

  constructor() {
    effect(() => {
      const m = this.meta();
      this.titleSvc.setTitle(m ? `${m.title} · Полари Вики` : 'Статья не найдена · Полари Вики');
    });
    // The body HTML is produced by build.py from our own markdown, so it is inserted as-is and then
    // post-processed: sections about unread books are folded, general sections are blurred.
    effect(() => {
      const el = this.content()?.nativeElement;
      const b = this.body.value();
      const m = this.meta();
      const level = this.spoilers.level();
      if (!el || !b || !m) return;
      el.innerHTML = b.html;
      if (this.spoilers.partly(m)) applySpoilers(el, level, (o) => this.spoilers.bookTitle(o));
      const a = this.anchor();
      if (a) queueMicrotask(() => document.getElementById(a)?.scrollIntoView());
    });
  }

  protected tocLink(anchor: string): string {
    return `/${this.slug()}/${anchor}`;
  }

  protected blurInfo(key: string): boolean {
    return (
      this.spoilers.partly(this.meta()) &&
      /статус|титул|супруг|дет|смерт|гибел|судьб|итог|правител|прозвищ|дальн|исход|послед|владел|преемн/i.test(
        key,
      )
    );
  }

  protected unblur(ev: Event): void {
    (ev.currentTarget as HTMLElement).classList.remove('spoil-blur');
  }

  protected interceptLinks(ev: MouseEvent): void {
    const a = (ev.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (href?.startsWith('#/') && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      this.router.navigateByUrl(href.slice(1));
    }
    const blur = (ev.target as HTMLElement).closest('.spoil-blur');
    if (blur && !a) blur.classList.remove('spoil-blur');
  }
}
