import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { byTitle, plural } from '../../core/format';
import { ArticleMeta } from '../../core/models';
import { Spoilers } from '../../core/spoilers';
import { WikiData } from '../../core/wiki-data';

export interface Group {
  name: string;
  items: ArticleMeta[];
}

const MONTHS = [
  '',
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const MONTHS_NOM = [
  '',
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

/** Strip the parenthetical tail of an infobox date: «2 декабря 1775 г. (День Сошествия)» → «2 декабря 1775 г.». */
function shortWhen(w = ''): string {
  return w
    .replace(/\s*\(.*$/, '')
    .replace(/;.*$/, '')
    .trim();
}

/* ---------------- characters: a portrait roster ---------------- */
@Component({
  selector: 'app-roster',
  imports: [RouterLink],
  template: `
    <div class="groups">
      @for (g of groups(); track g.name) {
        <section class="band">
          <h2>
            {{ g.name }} <small>{{ g.items.length }}</small>
          </h2>
          <ul>
            @for (a of g.items; track a.slug) {
              <li>
                <a [routerLink]="'/' + a.slug">
                  @if (img(a); as src) {
                    <img class="portrait" [src]="src" alt="" loading="lazy" />
                  }
                  <span class="copy"
                    ><b>{{ a.title }}</b
                    ><span class="role">{{
                      spoilers.hidden(a)
                        ? 'Появляется в поздних книгах'
                        : spoilers.partly(a)
                          ? 'Часть сведений скрыта: выбрана не последняя книга'
                          : role(a)
                    }}</span></span
                  ></a
                >
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: `
    .groups {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px 38px;
      margin-top: 24px;
    }
    .band {
      min-width: 0;
    }
    h2 {
      font-size: 1.6rem;
      border-bottom: 1px solid var(--rule);
      padding-bottom: 14px;
      margin: 0;
    }
    h2 small {
      font: var(--fs-small) var(--sans);
      color: var(--ink-3);
      margin-left: 10px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    a {
      display: flex;
      align-items: start;
      gap: 16px;
      padding: 18px 0;
      border-bottom: 1px solid var(--rule);
    }
    .portrait {
      width: 64px;
      height: 82px;
      object-fit: cover;
      object-position: top;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .copy {
      min-width: 0;
    }
    b {
      display: block;
      font: normal 1.35rem/1.3 var(--serif);
    }
    .role {
      display: block;
      font: 0.875rem/1.5 var(--sans);
      color: var(--ink-2);
      margin-top: 6px;
    }
    a:hover {
      text-decoration: none;
      background: var(--sheet-2);
    }
    @media (max-width: 700px) {
      .groups {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class Roster {
  readonly groups = input.required<Group[]>();
  protected readonly spoilers = inject(Spoilers);
  private readonly data = inject(WikiData);
  protected img(a: ArticleMeta): string {
    return this.data.imageSrc(a);
  }
  /** First clause of the summary — «кто это» in a few words. */
  protected role(a: ArticleMeta): string {
    return a.summary.split(/[;.]/)[0];
  }
}

/* ---------------- places: an atlas by region ---------------- */
@Component({
  selector: 'app-atlas',
  imports: [RouterLink],
  template: `
    @for (g of groups(); track g.name) {
      <section class="region" [class.nomap]="!onMap(g).length">
        <div class="text">
          <h2>{{ g.name }}</h2>
          <dl>
            @for (a of g.items; track a.slug) {
              <dt>
                <a [routerLink]="'/' + a.slug">{{ a.title }}</a>
              </dt>
              <dd [class.spoil-soft]="spoilers.partly(a)">
                {{ spoilers.hidden(a) ? 'Появляется в поздних книгах.' : a.summary }}
              </dd>
            }
          </dl>
        </div>
        @if (onMap(g).length) {
          <a class="ui" routerLink="/map" [queryParams]="{ p: onMap(g)[0] }">Показать на карте</a>
        }
      </section>
    }
  `,
  styles: `
    .region {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
      align-items: start;
      padding: 30px 0;
      border-bottom: 1px solid var(--rule);
    }
    .region:nth-child(even) .map {
      order: -1;
    }
    .region.nomap {
      grid-template-columns: minmax(0, 1fr);
    }
    h2 {
      margin: 0 0 10px;
      font-size: var(--fs-h2);
    }
    dl {
      margin: 0;
    }
    dt {
      margin-top: 12px;
      font: 500 1.1rem/1.3 var(--serif);
    }
    dd {
      margin: 2px 0 0;
      font: 0.92rem/1.5 var(--sans);
      color: var(--ink-2);
      max-width: 60ch;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .map {
      position: sticky;
      top: 80px;
      border: 1px solid var(--rule);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    }
    .spoil-soft {
      filter: blur(3px);
    }
    @media (max-width: 860px) {
      .region {
        grid-template-columns: minmax(0, 1fr);
      }
      .region .map,
      .region:nth-child(even) .map {
        order: -1;
        position: static;
      }
    }
  `,
})
export class Atlas {
  readonly groups = input.required<Group[]>();
  protected readonly spoilers = inject(Spoilers);
  private readonly data = inject(WikiData);
  protected onMap(g: Group): string[] {
    const p = this.data.extra().map.places;
    return g.items.map((a) => a.slug).filter((s) => p[s]);
  }
}

/* ---------------- events: a chronicle ---------------- */
@Component({
  selector: 'app-chronicle',
  imports: [RouterLink],
  template: `
    <ol class="spine">
      @for (y of years(); track y.label) {
        <li class="year">
          <span>{{ y.label }}</span>
        </li>
        @for (a of y.items; track a.slug) {
          <li class="ev">
            <time>{{ dateLabel(a) }}</time>
            <div>
              <a [routerLink]="'/' + a.slug">{{ a.title }}</a>
              <p [class.spoil-soft]="spoilers.partly(a)">
                {{ spoilers.hidden(a) ? 'Событие из поздних книг.' : a.summary }}
              </p>
              <span class="tag">{{ a.group }}</span>
            </div>
          </li>
        }
      }
    </ol>
  `,
  styles: `
    .spine {
      position: relative;
      margin: 26px 0 0;
      padding: 0;
      list-style: none;
    }
    .spine::before {
      content: '';
      position: absolute;
      left: 152px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: linear-gradient(var(--azure), var(--wax));
      opacity: 0.5;
    }
    .year {
      position: relative;
      margin: 30px 0 8px;
    }
    .year span {
      display: inline-block;
      min-width: 140px;
      font: 500 2.1rem/1 var(--caps);
      color: var(--azure);
    }
    .ev {
      position: relative;
      display: grid;
      grid-template-columns: 140px minmax(0, 1fr);
      gap: 28px;
      padding: 10px 0 14px;
    }
    .ev::before {
      content: '';
      position: absolute;
      left: 147px;
      top: 17px;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      background: var(--sheet);
      border: 2px solid var(--wax);
    }
    time {
      padding-top: 3px;
      text-align: right;
      font: italic 0.95rem/1.3 var(--serif);
      color: var(--ink-3);
    }
    .ev a {
      font: 500 1.2rem/1.3 var(--serif);
    }
    .ev p {
      margin: 3px 0 4px;
      max-width: 64ch;
      font: 0.95rem/1.5 var(--sans);
      color: var(--ink-2);
    }
    .tag {
      font: var(--fs-small) var(--sans);
      color: var(--ink-3);
    }
    .spoil-soft {
      filter: blur(3px);
    }
    @media (max-width: 640px) {
      .spine::before {
        left: 6px;
      }
      .ev {
        grid-template-columns: minmax(0, 1fr);
        gap: 2px;
        padding-left: 26px;
      }
      .ev::before {
        left: 1px;
      }
      time {
        text-align: left;
      }
      .year span {
        padding-left: 26px;
      }
    }
  `,
})
export class Chronicle {
  readonly items = input.required<ArticleMeta[]>();
  protected readonly spoilers = inject(Spoilers);
  protected readonly years = computed(() => {
    const sorted = [...this.items()].sort(
      (a, b) => (a.iso || '9999').localeCompare(b.iso || '9999') || byTitle(a, b),
    );
    const out: { label: string; items: ArticleMeta[] }[] = [];
    for (const a of sorted) {
      const y = a.iso
        ? +a.iso.slice(0, 4) < 1700
          ? a.iso === '0000'
            ? 'Сошествие'
            : 'Древность'
          : a.iso.slice(0, 4)
        : 'Без даты';
      const last = out[out.length - 1];
      if (last?.label === y) last.items.push(a);
      else out.push({ label: y, items: [a] });
    }
    return out;
  });
  protected dateLabel(a: ArticleMeta): string {
    const iso = a.iso ?? '';
    if (iso.length >= 7 && +iso.slice(0, 4) >= 1700) {
      const m = +iso.slice(5, 7),
        d = +iso.slice(8, 10);
      return d ? `${d} ${MONTHS[m]}` : MONTHS_NOM[m];
    }
    return shortWhen(a.when) || '—';
  }
}

/* ---------------- concepts: an alphabetical dictionary ---------------- */
@Component({
  selector: 'app-lexicon',
  imports: [RouterLink],
  template: `
    <div class="cols">
      @for (l of letters(); track l.letter) {
        <section>
          <h2>{{ l.letter }}</h2>
          @for (a of l.items; track a.slug) {
            <p class="entry">
              @if (img(a); as src) {
                <img [src]="src" alt="" loading="lazy" />
              }
              <a [routerLink]="'/' + a.slug">{{ a.title }}</a> <span class="g">{{ a.group }}</span>
              <span class="def" [class.spoil-soft]="spoilers.partly(a)">{{ a.summary }}</span>
            </p>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .cols {
      columns: 2 380px;
      column-gap: 48px;
      margin-top: 18px;
    }
    section {
      break-inside: avoid-column;
    }
    h2 {
      margin: 22px 0 6px;
      font: 500 2.4rem/1 var(--caps);
      color: var(--wax);
    }
    .entry {
      break-inside: avoid;
      margin: 0 0 14px;
      padding-left: 14px;
      border-left: 2px solid var(--rule);
    }
    .entry::after {
      content: '';
      display: block;
      clear: both;
    }
    img {
      float: right;
      width: 52px;
      height: 52px;
      margin: 2px 0 4px 10px;
      object-fit: contain;
      background: var(--engraving-bg);
      border-radius: 3px;
    }
    a {
      font: 500 1.12rem/1.3 var(--caps);
    }
    .g {
      margin-left: 8px;
      font: var(--fs-small) var(--sans);
      color: var(--ink-3);
    }
    .def {
      display: block;
      margin-top: 2px;
      font: 0.93rem/1.5 var(--serif);
      color: var(--ink-2);
    }
    .spoil-soft {
      filter: blur(3px);
    }
  `,
})
export class Lexicon {
  readonly items = input.required<ArticleMeta[]>();
  protected readonly spoilers = inject(Spoilers);
  private readonly data = inject(WikiData);
  protected readonly letters = computed(() => {
    const out: { letter: string; items: ArticleMeta[] }[] = [];
    for (const a of [...this.items()].sort(byTitle)) {
      const l = a.title.replace(/^[«"]/, '')[0].toUpperCase();
      const last = out[out.length - 1];
      if (last?.letter === l) last.items.push(a);
      else out.push({ letter: l, items: [a] });
    }
    return out;
  });
  protected img(a: ArticleMeta): string {
    return this.data.imageSrc(a);
  }
}

/* ---------------- books: a shelf in reading order ---------------- */
@Component({
  selector: 'app-shelf',
  imports: [RouterLink],
  template: `
    <ol class="shelf">
      @for (b of books(); track b.a.slug) {
        <li [class.novel]="b.novel" [class.with-art]="b.img">
          @if (b.img) {
            <a class="cover" [routerLink]="'/' + b.a.slug" [attr.aria-label]="b.a.title"
              ><img [src]="b.img" alt="" loading="lazy"
            /></a>
          }
          <div class="txt">
            <span class="kind">{{ b.a.group }}</span>
            <a class="t" [routerLink]="'/' + b.a.slug">{{ b.a.title }}</a>
            @if (b.span) {
              <span class="span"
                >{{ b.span }} · {{ b.n }} {{ plural(b.n, 'глава', 'главы', 'глав') }}</span
              >
            }
            <p>
              {{
                spoilers.hidden(b.a)
                  ? 'Появляется в поздних книгах.'
                  : spoilers.partly(b.a)
                    ? 'Сведения о сюжете скрыты с учётом выбранной книги.'
                    : b.a.summary
              }}
            </p>
          </div>
        </li>
      }
    </ol>
  `,
  styles: `
    .shelf {
      margin: 24px 0 0;
      padding: 0;
      list-style: none;
      counter-reset: b;
    }
    li {
      counter-increment: b;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 18px;
      align-items: start;
      padding: 12px 0 12px 46px;
      position: relative;
      border-top: 1px solid var(--rule);
    }
    li::before {
      content: counter(b);
      position: absolute;
      left: 0;
      top: 14px;
      width: 32px;
      text-align: right;
      font: 500 1.3rem/1 var(--caps);
      color: var(--ink-3);
    }
    li.novel {
      grid-template-columns: minmax(0, 1fr);
      gap: 26px;
      padding-top: 22px;
      padding-bottom: 22px;
    }
    li.novel::before {
      font-size: 2rem;
      color: var(--azure);
      top: 24px;
    }
    li.with-art,
    li.novel.with-art {
      grid-template-columns: 90px minmax(0, 1fr);
    }
    .cover {
      display: block;
      aspect-ratio: 2 / 3;
      overflow: hidden;
      background: var(--sheet-2);
      box-shadow: 2px 4px 14px rgba(0, 0, 0, 0.28);
      border-radius: 1px 3px 3px 1px;
    }
    .cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .kind {
      display: block;
      font: var(--fs-small) var(--sans);
      color: var(--ink-3);
    }
    .t {
      font: 500 1.15rem/1.25 var(--serif);
    }
    .novel .t {
      font-size: 1.7rem;
    }
    .span {
      display: block;
      margin-top: 2px;
      font: italic 0.92rem var(--serif);
      color: var(--wax);
    }
    p {
      margin: 6px 0 0;
      max-width: 64ch;
      font: 0.93rem/1.5 var(--sans);
      color: var(--ink-2);
    }
    li:not(.novel) p {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    @media (max-width: 560px) {
      li.with-art,
      li.novel.with-art {
        grid-template-columns: 62px minmax(0, 1fr);
        gap: 14px;
      }
      li.novel {
        grid-template-columns: minmax(0, 1fr);
        gap: 14px;
      }
      li {
        grid-template-columns: minmax(0, 1fr);
        padding-left: 34px;
      }
      .novel .t {
        font-size: 1.3rem;
      }
    }
  `,
})
export class Shelf {
  protected readonly spoilers = inject(Spoilers);
  readonly items = input.required<ArticleMeta[]>();
  private readonly data = inject(WikiData);
  protected readonly plural = plural;
  protected readonly books = computed(() =>
    [...this.items()]
      .sort((a, b) => a.order - b.order)
      .map((a) => {
        const ch = (this.data.extra().chapters[a.slug] ?? [])
          .map((c) => c.iso)
          .filter(Boolean)
          .sort();
        const fmt = (iso: string) =>
          `${MONTHS_NOM[+iso.slice(5, 7)] ?? ''} ${iso.slice(0, 4)}`.trim();
        const span = ch.length
          ? fmt(ch[0]) === fmt(ch[ch.length - 1])
            ? fmt(ch[0])
            : `${fmt(ch[0])} — ${fmt(ch[ch.length - 1])}`
          : '';
        return {
          a,
          img: this.data.imageSrc(a),
          novel: /Роман/.test(a.group),
          span,
          n: (this.data.extra().chapters[a.slug] ?? []).length,
        };
      }),
  );
}
