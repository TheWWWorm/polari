export type ArticleType = 'book' | 'character' | 'house' | 'place' | 'event' | 'concept';

/** Light article record from data/index.json (enough for lists, cards and search). */
export interface ArticleMeta {
  slug: string;
  type: ArticleType;
  title: string;
  ru: string;
  aliases: string[];
  summary: string;
  books: string[];
  order: number;
  group: string;
  words: number;
  text: string;
  backlinks: string[];
  /** Reading order of the first and last book the entity appears in (spoiler filter). */
  first: number;
  last: number;
  image: number | null;
  /** Free-form date from the infobox («2 декабря 1775 г.») and its sortable start, when the article has one. */
  when?: string;
  iso?: string;
}

/** Heavy part of an article, loaded on demand from data/a/<slug>.json. */
export interface ArticleBody {
  html: string;
  toc: [string, string][];
  infobox: [string, string][];
  links: string[];
  gallery: number[];
}

export interface WikiImage {
  src: string;
  caption: string;
  credit: string;
  slugs: string[];
}

export interface Chapter {
  n: string;
  h: string;
  pov: string;
  date: string;
  iso: string;
  place: string;
  key: string;
  sum: string;
}

export interface FamilyPerson {
  id: string;
  name: string;
  slug: string;
  spouses: string[];
  parents: string[];
  note: string;
}

export interface Family {
  house: string;
  title: string;
  note: string;
  people: FamilyPerson[];
}

export interface HouseRow {
  slug: string;
  land: string;
  capital: string;
  ruler_start: string;
  ruler_end: string;
  pramater: string;
  sigil: string;
  colors: string;
  predmety: string;
  palata: string;
  notes: string;
}

export interface Relation {
  a: string;
  b: string;
  /** relation type: родня, супруги, любовь, союз, служба, вражда, наставник */
  t: string;
  /** label read as "a is <l> of b" */
  l: string;
  /** reading order of the book where it becomes known */
  o: number;
}

export interface MapPlace {
  x: number;
  y: number;
  kind: 'city' | 'land' | 'site';
  title?: string;
}

export interface MapEvent {
  d: string;
  label: string;
  p: string;
  t: string;
  s?: string[];
}

export interface WikiExtra {
  chapters: Record<string, Chapter[]>;
  families: Family[];
  houses: HouseRow[];
  relations: Relation[];
  map: { places: Record<string, MapPlace>; events: MapEvent[] };
}

export interface WikiIndex {
  articles: ArticleMeta[];
  images: WikiImage[];
  data: WikiExtra;
}

export const TYPE_LABELS: Record<ArticleType, { one: string; many: string; about: string }> = {
  book: { one: 'Книга', many: 'Книги', about: 'Романы и интерлюдии цикла в порядке чтения.' },
  character: { one: 'Персонаж', many: 'Персонажи', about: 'Люди Полари — от императоров до наёмников.' },
  house: { one: 'Дом', many: 'Дома и фракции', about: 'Великие Дома, ордена и фракции.' },
  place: { one: 'Место', many: 'Места', about: 'Земли, города, замки и реки Полари.' },
  event: { one: 'Событие', many: 'События', about: 'Войны, сражения, заговоры и поворотные моменты.' },
  concept: { one: 'Понятие', many: 'Понятия и мир', about: 'Религия, Священные Предметы, обычаи и устройство мира.' },
};
