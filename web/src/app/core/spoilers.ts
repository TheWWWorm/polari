import { Injectable, computed, inject, signal } from '@angular/core';
import { ArticleMeta, MapEvent } from './models';
import { WikiData } from './wiki-data';

const KEY = 'polari.read-up-to';
export const ALL_BOOKS = 99;

/** Pre-cycle events that the reader only learns about in later books. */
const EVENT_REVEALED_IN: Record<string, number> = { '0036-05-02': 15, '1750-01-01': 15, '1756-08-01': 16, '1772-01-01': 19 };

/**
 * "Прочитано до книги N": hides content from books after N.
 * ALL_BOOKS means the reader wants everything shown.
 */
@Injectable({ providedIn: 'root' })
export class Spoilers {
  private readonly data = inject(WikiData);
  private readonly revealed = signal<Set<string>>(new Set());
  readonly level = signal<number>(readStored());
  /** The reader has picked a level at least once (otherwise we ask on first visit). */
  readonly chosen = signal<boolean>(hasStored());
  readonly active = computed(() => this.level() < ALL_BOOKS);

  setLevel(n: number): void {
    this.level.set(n);
    this.chosen.set(true);
    try { localStorage.setItem(KEY, String(n)); } catch { /* private mode */ }
  }

  reveal(slug: string): void {
    this.revealed.update((s) => new Set(s).add(slug));
  }

  /** The whole article belongs to an unread book. */
  hidden(a: ArticleMeta | undefined): boolean {
    return !!a && this.active() && a.first > this.level() && !this.revealed().has(a.slug);
  }

  /** The article mentions events from an unread book somewhere. */
  partly(a: ArticleMeta | undefined): boolean {
    return !!a && this.active() && a.last > this.level();
  }

  bookTitle(order: number): string {
    return this.data.books().find((b) => b.order === order)?.title ?? String(order);
  }

  /** Latest in-world date the reader has reached (max chapter date of read books). */
  readonly cutoff = computed(() => {
    if (!this.active()) return '9999';
    let max = '0000';
    const chapters = this.data.extra().chapters;
    for (const b of this.data.books()) {
      if (b.order > this.level()) continue;
      for (const c of chapters[b.slug] ?? []) if (c.iso && c.iso > max) max = c.iso;
    }
    return max;
  });

  eventVisible(ev: { d: string }): boolean {
    if (!this.active()) return true;
    if (ev.d < '1774') return (EVENT_REVEALED_IN[ev.d] ?? 1) <= this.level();
    return ev.d <= this.cutoff();
  }

  bookVisible(order: number): boolean {
    return !this.active() || order <= this.level();
  }
}

function readStored(): number {
  try { return Number(localStorage.getItem(KEY)) || ALL_BOOKS; } catch { return ALL_BOOKS; }
}

function hasStored(): boolean {
  try { return localStorage.getItem(KEY) !== null; } catch { return true; }
}

export type { MapEvent };
