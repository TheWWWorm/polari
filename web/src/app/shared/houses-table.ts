import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Spoilers } from '../core/spoilers';
import { WikiData } from '../core/wiki-data';

@Component({
  selector: 'app-houses-table',
  imports: [RouterLink],
  template: `
    <div
      class="table-wrap"
      tabindex="0"
      aria-label="Сравнение Великих Домов, доступна горизонтальная прокрутка"
    >
      <table class="table">
        <thead>
          <tr>
            <th>Дом</th>
            <th>Земля и столица</th>
            <th>Правитель в 1774</th>
            <th>Правитель в конце цикла</th>
            <th>Род</th>
            <th>Герб и цвета</th>
            <th>Предметы</th>
            <th>Палата</th>
          </tr>
        </thead>
        <tbody>
          @for (h of data.extra().houses; track h.slug) {
            <tr>
              <td>
                <b>
                  @if (data.get(h.slug)) {
                    <a [routerLink]="'/' + h.slug">{{ data.title(h.slug) }}</a>
                  } @else {
                    {{ h.slug }}
                  }</b
                ><span class="sub" [innerHTML]="h.notes"></span>
              </td>
              <td>
                <span [innerHTML]="h.land"></span><span class="sub" [innerHTML]="h.capital"></span>
              </td>
              <td [innerHTML]="h.ruler_start"></td>
              <td
                [innerHTML]="h.ruler_end"
                [class.spoil-blur]="spoilers.active() && spoilers.level() < 18"
                (click)="$any($event.currentTarget).classList.remove('spoil-blur')"
              ></td>
              <td [innerHTML]="h.pramater"></td>
              <td>
                <span [innerHTML]="h.sigil"></span><span class="sub" [innerHTML]="h.colors"></span>
              </td>
              <td [innerHTML]="h.predmety"></td>
              <td [innerHTML]="h.palata"></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    td {
      min-width: 8.5em;
    }
  `,
})
export class HousesTable {
  protected readonly data = inject(WikiData);
  protected readonly spoilers = inject(Spoilers);
}
