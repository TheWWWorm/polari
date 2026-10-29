import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Theme } from '../core/theme';
import { SearchBox } from './search-box';
import { SpoilerSelect } from './spoiler-select';
import { LightboxView } from '../shared/lightbox-view';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SearchBox, SpoilerSelect, LightboxView],
  host: { '(document:keydown.escape)': 'closeNavigation()' },
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly theme = inject(Theme);
  protected readonly navOpen = signal(false);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');

  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.element.nativeElement.querySelector<HTMLElement>('main')?.focus();
  }

  protected closeNavigation(): void {
    if (!this.navOpen()) return;
    this.navOpen.set(false);
    this.menuButton()?.nativeElement.focus();
  }

  protected readonly nav = [
    {
      title: 'Энциклопедия',
      links: [
        ['/', 'Заглавная'],
        ['/c/book', 'Книги'],
        ['/c/character', 'Персонажи'],
        ['/c/house', 'Великие Дома'],
        ['/c/place', 'Места'],
        ['/c/event', 'События'],
        ['/c/concept', 'Понятия и мир'],
      ],
    },
    {
      title: 'Исследовать',
      links: [
        ['/map', 'Карта и время'],
        ['/map3d', '3D-карта'],
        ['/families', 'Родословные'],
        ['/relations', 'Связи персонажей'],
        ['/gallery', 'Иллюстрации'],
      ],
    },
    {
      title: 'Справочники',
      links: [
        ['/all', 'Все статьи'],
        ['/chronology', 'Хронология'],
        ['/glossarij', 'Глоссарий'],
        ['/tsitaty', 'Цитаты'],
        ['/random', 'Случайная статья'],
      ],
    },
  ];
  protected navIcon(path: string): string {
    if (path.includes('book'))
      return 'M12 5C8 2 3 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Zm0 0v16';
    if (path.includes('character'))
      return 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 8 0 0 1 16 0v3';
    if (path.includes('house')) return 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z';
    if (path.includes('map') || path.includes('place'))
      return 'M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 1 1 14 0Zm-5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z';
    if (path.includes('famil'))
      return 'M12 3v7M4 14v-4h16v4M12 10v4M1 14h6v7H1Zm8 0h6v7H9Zm8 0h6v7h-6Z';
    if (path.includes('event') || path.includes('khron') || path.includes('chronology'))
      return 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 3';
    if (path === '/') return 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z';
    return 'M4 4h16v16H4ZM8 8h8M8 12h8M8 16h5';
  }

  constructor() {
    inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.navOpen.set(false);
    });
  }
}
