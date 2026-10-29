import { Component, inject, input } from '@angular/core';
import { ALL_BOOKS, Spoilers } from '../core/spoilers';
import { WikiData } from '../core/wiki-data';

/** Header control: which book the reader has finished. */
@Component({
  selector: 'app-spoiler-select',
  template: `
    <label
      [class.on]="spoilers.active()"
      title="Скрывать события книг, которые вы ещё не прочитали"
    >
      <span class="lbl">Прочитано до</span>
      <select
        class="field"
        [class.expanded]="expanded()"
        [value]="spoilers.level()"
        (change)="spoilers.setLevel(+$any($event.target).value)"
        aria-label="Прочитано до книги"
      >
        <option [value]="all">весь цикл</option>
        @for (b of data.books(); track b.slug) {
          <option [value]="b.order">до «{{ b.title }}»</option>
        }
      </select>
    </label>
  `,
  styles: `
    label {
      display: flex;
      align-items: center;
      gap: 8px;
      font: var(--fs-ui)/1 var(--sans);
      color: var(--ink-3);
    }
    select {
      max-width: 220px;
      min-width: 0;
    }
    select.expanded {
      max-width: 100%;
    }
    label.on select {
      border-color: var(--wax);
      color: var(--wax);
    }
    @media (max-width: 760px) {
      .lbl {
        display: none;
      }
      select {
        max-width: 118px;
      }
    }
  `,
})
export class SpoilerSelect {
  readonly expanded = input(false);
  protected readonly spoilers = inject(Spoilers);
  protected readonly data = inject(WikiData);
  protected readonly all = ALL_BOOKS;
}
