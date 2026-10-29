import { Component, computed, inject, input, linkedSignal, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArticleMeta } from '../../core/models';
import { byTitle } from '../../core/format';
import { norm } from '../../core/search';
import { Spoilers } from '../../core/spoilers';
import { WikiData } from '../../core/wiki-data';
import { SpoilerSelect } from '../../layout/spoiler-select';

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const SHORT_MONTHS = [
  'Янв',
  'Фев',
  'Мар',
  'Апр',
  'Май',
  'Июн',
  'Июл',
  'Авг',
  'Сен',
  'Окт',
  'Ноя',
  'Дек',
];
function bucket(a: ArticleMeta): string {
  return !a.iso ? 'Без даты' : +a.iso.slice(0, 4) < 1700 ? 'Древность' : a.iso.slice(0, 4);
}

@Component({
  selector: 'app-chronicle',
  imports: [RouterLink, SpoilerSelect],
  templateUrl: './chronicle.html',
  styleUrl: './chronicle.css',
})
export class Chronicle {
  readonly items = input.required<ArticleMeta[]>();
  protected readonly data = inject(WikiData);
  protected readonly spoilers = inject(Spoilers);
  protected readonly query = signal('');
  protected readonly months = SHORT_MONTHS;
  protected readonly available = computed(() =>
    this.items()
      .filter(
        (a) => !this.spoilers.hidden(a) && (!a.iso || this.spoilers.eventVisible({ d: a.iso })),
      )
      .sort((a, b) => (a.iso || '9999').localeCompare(b.iso || '9999') || byTitle(a, b)),
  );
  protected readonly years = computed(() => [...new Set(this.available().map(bucket))]);
  // the chronology reads from its beginning: the earliest period, the whole year
  protected readonly year = linkedSignal(() => this.years()[0] ?? '');
  protected readonly month = linkedSignal<string, string>({ source: this.year, computation: () => '' });
  protected readonly visible = computed(() => {
    const q = norm(this.query());
    return this.available().filter(
      (a) =>
        bucket(a) === this.year() &&
        (!this.month() || a.iso?.slice(5, 7) === this.month()) &&
        (!q || norm(a.title + ' ' + a.group).includes(q)),
    );
  });
  protected readonly selectedSlug = linkedSignal(() => this.visible()[0]?.slug ?? '');
  protected readonly selected = computed(() =>
    this.visible().find((a) => a.slug === this.selectedSlug()),
  );
  protected readonly info = resource({
    params: () => this.selected()?.slug,
    loader: ({ params }) => this.data.body(params),
  });
  protected readonly facts = computed(() =>
    this.info.hasValue() && !this.spoilers.partly(this.selected())
      ? this.info
          .value()
          .infobox.filter(([k]) => !/дат|врем|тип/i.test(k))
          .slice(0, 4)
      : [],
  );
  protected readonly related = computed(() => {
    const s = this.selected();
    if (!s) return [];
    return this.available()
      .filter((a) => a.slug !== s.slug && a.books.some((b) => s.books.includes(b)))
      .sort(
        (a, b) =>
          Math.abs(
            Number((a.iso || '0000').replaceAll('-', '').padEnd(8, '0')) -
              Number((s.iso || '0000').replaceAll('-', '').padEnd(8, '0')),
          ) -
          Math.abs(
            Number((b.iso || '0000').replaceAll('-', '').padEnd(8, '0')) -
              Number((s.iso || '0000').replaceAll('-', '').padEnd(8, '0')),
          ),
      )
      .slice(0, 3);
  });
  protected readonly monthTitle = computed(() =>
    this.month() ? MONTHS[+this.month() - 1] : 'События',
  );
  protected monthValue(index: number): string {
    return String(index + 1).padStart(2, '0');
  }
  protected hasMonth(index: number): boolean {
    return this.available().some(
      (a) => bucket(a) === this.year() && a.iso?.slice(5, 7) === this.monthValue(index),
    );
  }
  protected chooseYear(year: string): void {
    this.year.set(year);
  }
  protected summary(a: ArticleMeta): string {
    return this.spoilers.partly(a) ? 'Часть сведений скрыта с учётом выбранной книги.' : a.summary;
  }
  protected when(a: ArticleMeta): string {
    return (a.when || a.iso || 'Дата не указана').replace(/\s*\(.*$/, '').trim();
  }
  protected dateParts(a: ArticleMeta): { day: string; month: string } {
    if (!a.iso || a.iso.length < 7 || +a.iso.slice(0, 4) < 1700)
      return { day: '', month: this.when(a) };
    const d = +a.iso.slice(8, 10);
    return { day: d ? String(d) : '', month: MONTHS[+a.iso.slice(5, 7) - 1] ?? '' };
  }
  protected moveMonth(step: number): void {
    const y = Number(this.year());
    if (!Number.isFinite(y)) return;
    let m = (this.month() ? +this.month() : step > 0 ? 0 : 13) + step;
    let nextY = y;
    if (m < 1) {
      nextY--;
      m = 12;
    } else if (m > 12) {
      nextY++;
      m = 1;
    }
    if (!this.years().includes(String(nextY))) return;
    this.year.set(String(nextY));
    this.month.set(String(m).padStart(2, '0'));
  }
  protected canMove(step: number): boolean {
    const y = Number(this.year());
    if (!Number.isFinite(y)) return false;
    const m = this.month() ? +this.month() : step > 0 ? 0 : 13;
    return (m + step >= 1 && m + step <= 12) || this.years().includes(String(y + step));
  }
}
