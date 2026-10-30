// Runs after `ng build`: writes a static copy of index.html for every article and section
// (<slug>.html, served by Cloudflare at /<slug>) with its own title, description and link-preview tags,
// plus the article text in <noscript> for crawlers that do not run scripts; then sitemap.xml and robots.txt.
// index.html changes here, so the build regenerates the service worker manifest (ngsw.json) afterwards.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://polari.wwworm.com';
const NAME = 'Полари Вики';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'web', 'browser');

const shell = readFileSync(join(OUT, 'index.html'), 'utf8');
const { articles, images } = JSON.parse(readFileSync(join(OUT, 'data', 'index.json'), 'utf8'));
const about = shell.match(/<meta\s+name="description"\s+content="([^"]*)"/)[1];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TYPES = {
  book: ['Книги', 'Романы и интерлюдии цикла в порядке чтения.'],
  character: ['Персонажи', 'Люди Полари — от императоров до наёмников.'],
  house: ['Дома и фракции', 'Великие Дома, ордена и фракции.'],
  place: ['Места', 'Земли, города, замки и реки Полари.'],
  event: ['События', 'Войны, сражения, заговоры и поворотные моменты.'],
  concept: ['Понятия и мир', 'Религия, Священные Предметы, обычаи и устройство мира.'],
};
// sections of the app with fixed addresses (the titles match app.routes.ts)
const SECTIONS = [
  ['all', 'Все статьи', 'Алфавитный указатель всех статей вики.'],
  ['map', 'Карта', 'Карта Полари и шкала времени: где и когда происходили главные события цикла.'],
  ['map3d', '3D-карта', 'Трёхмерная карта материка: горы, реки, леса, города, железные дороги и тракты.'],
  ['gallery', 'Галерея', 'Иллюстрации к циклу «Полари».'],
  ['families', 'Родословные', 'Родословные древа Великих Домов Полари.'],
  ['relations', 'Связи персонажей', 'Схема связей персонажей цикла «Полари».'],
  ['stratemy-igra', 'Сыграть в стратемы', 'Стратемы — настольная игра из мира Полари, против компьютера.'],
  ['chronology', 'Хронология', 'Хронология событий цикла «Полари».'],
  ...Object.entries(TYPES).map(([t, [many, text]]) => [`c/${t}`, many, text]),
];

function page({ path, title, description, image, type = 'website', body = '' }) {
  const url = SITE + '/' + path;
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:site_name" content="${NAME}" />`,
    `<meta property="og:locale" content="ru_RU" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(title.replace(` · ${NAME}`, ''))}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    image ? `<meta property="og:image" content="${esc(SITE + '/' + image)}" />` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
  ].filter(Boolean).join('\n    ');
  return shell
    .replace(/<title>[^<]*<\/title>/, '')
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, '')
    .replace(/<link rel="canonical"[^>]*>/, '')
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('</app-root>', body ? `</app-root>\n    <noscript>${body}</noscript>` : '</app-root>');
}

function write(path, html) {
  const file = join(OUT, path + '.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

for (const a of articles) {
  const { html, infobox } = JSON.parse(readFileSync(join(OUT, 'data', 'a', a.slug + '.json'), 'utf8'));
  const description = a.summary || TYPES[a.type][1];
  const facts = infobox.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  const body = `<article><h1>${esc(a.title)}</h1><p>${esc(description)}</p>${facts ? `<dl>${facts}</dl>` : ''}${html}</article>`;
  write(a.slug, page({ path: a.slug, title: `${a.title} · ${NAME}`, description, image: images[a.image]?.src, type: 'article', body }));
}
for (const [path, title, description] of SECTIONS) write(path, page({ path, title: `${title} · ${NAME}`, description }));
// the home page keeps index.html; it only gains the preview tags
writeFileSync(join(OUT, 'index.html'), page({ path: '', title: NAME, description: about, image: images.find((i) => /map/.test(i.src))?.src }));

const urls = ['', ...SECTIONS.map(([p]) => p), ...articles.map((a) => a.slug)];
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}/${u}</loc></url>`).join('\n')}
</urlset>
`);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /search/

Sitemap: ${SITE}/sitemap.xml
`);
console.log(`pages: ${articles.length} articles, ${SECTIONS.length} sections, sitemap with ${urls.length} addresses`);
