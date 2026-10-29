import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * What stands at each mapped place, taken from the articles' «Тип» field and the map legend.
 * Natural features get no model, only a label in their own style.
 */
export type Settlement =
  | 'capital' | 'city' | 'port' | 'stronghold' | 'castle' | 'town' | 'village' | 'steppe'
  | 'monastery' | 'cathedral' | 'palace' | 'bridge' | 'gift' | 'fort' | 'dam' | 'mothermills' | 'cemetery'
  | 'nature' | 'water' | 'land';

/** Map glyphs with no pin in data/map.json: their label and the article that describes them. */
export const EXTRA: Record<string, { title: string; link?: string }> = {
  flethill: { title: 'Флэтхилл' },
  'dar-10': { title: 'Дар № 10', link: 'svyashchennye-predmety' },
  'materi-melnitsy': { title: 'Матери Мельницы', link: 'melnitsy' },
  'kladbishcha-gigantov': { title: 'Кладбища Ржавых Гигантов', link: 'melnitsy' },
  'morskaya-tryasina': { title: 'Морская трясина', link: 'darkvoter' },
  'khram-kriboly': { title: 'храм Криболы', link: 'darkvoter' },
  'myagkie-polya': { title: 'Мягкие Поля', link: 'ekspedicija' },
  'zamshevyj-les': { title: 'Замшевый лес', link: 'ekspedicija' },
  'les-tenej': { title: 'Лес Теней', link: 'ekspedicija' },
};

/** Relief features from map3d/features.json. */
export interface Features {
  bridges: Record<string, number>;
  dam: { key: string; angle: number };
  pits: Record<string, number>;
  mills: [number, number][];
  tarns: { kind: string; y: number; pts: [number, number][] }[];
  roads: { kind: 'rail' | 'road'; name: string; pts: [number, number][] }[];
}

export const SETTLEMENT: Record<string, Settlement> = {
  faunterra: 'capital',
  // walls only where the books mention them: Первая Зима, Клык Медведя, Сердце Света («крепкие стены»), Дойл, Лид, Майн
  aleridan: 'city', melorandzh: 'city', labelin: 'city', 'nen-kler': 'city', fejris: 'city', smolden: 'town', blekmor: 'town',
  'pervaya-zima': 'stronghold', 'klyk-medvedya': 'stronghold', 'serdtse-sveta': 'stronghold', dojl: 'stronghold', lid: 'stronghold', majn: 'stronghold',
  stagfort: 'castle', 'ostrov-faradeya-rajli': 'fort', 'slavnyj-dozor': 'fort', 'lvinye-vrata': 'fort',
  uejmar: 'port', belomorye: 'port', fliss: 'port', lajem: 'port', marengo: 'port', soltaun: 'port', uindli: 'port', grejs: 'port',
  ruajld: 'port', bejvind: 'port', mejpl: 'port', kolmin: 'port', syurlion: 'port', orkada: 'port', minnis: 'port', ofert: 'port',
  'mes-si': 'port', korden: 'port', lejksiti: 'port', leongard: 'port',
  'rej-roj': 'steppe',
  piksi: 'village', spot: 'village', dolina: 'village', birbis: 'village', 'livnevyj-les': 'village', laksett: 'village',
  'mon-ulyany': 'monastery', 'mon-mareka': 'monastery', 'lovushka-vetra': 'monastery',
  'sobor-agaty': 'cathedral', 'sobor-vodnyh': 'cathedral', 'grot-kosuli': 'monastery',
  'dvorets-tishiny': 'palace',
  'yulianin-most': 'bridge', 'yanmejskij-most': 'bridge', 'bek-most': 'bridge',
  'dar-17': 'gift', 'dar-18': 'gift', erroubek: 'dam', 'materi-melnitsy': 'mothermills', 'kladbishcha-gigantov': 'cemetery',
  flethill: 'town', 'khram-kriboly': 'monastery', 'dar-10': 'nature', 'morskaya-tryasina': 'nature', 'myagkie-polya': 'nature', 'zamshevyj-les': 'nature', 'les-tenej': 'nature',
  'dymnaya-dal': 'water', 'more-ldov': 'water', bliznyashki: 'water', reka: 'water', 'topi': 'nature',
  'bezdonnaya-propast': 'nature', granenye: 'nature', 'lisij-dol': 'nature', 'govoryashchie-martyshki': 'nature', oazis: 'nature',
  sinskie: 'nature', 'tysyacha-oskolkov': 'nature', 'roshcha-brabusov': 'nature', 'pastushi-luga': 'nature',
};

export function settlementOf(key: string, kind: string): Settlement {
  return SETTLEMENT[key] ?? (kind === 'land' ? 'land' : kind === 'city' ? 'town' : 'nature');
}

/** Terrain height lookup from heights.bin (uint16 grid over the whole map). */
export class HeightField {
  /** Set by the page: true where a lake above sea level covers the ground. */
  wet: (x: number, z: number) => boolean = () => false;
  constructor(private readonly d: Uint16Array, private readonly w: number, private readonly h: number,
              private readonly min: number, private readonly max: number,
              private readonly W: number, private readonly D: number) {}
  at(x: number, z: number): number {
    const u = (x / this.W + 0.5) * (this.w - 1), v = (z / this.D + 0.5) * (this.h - 1);
    const x0 = Math.max(0, Math.min(this.w - 2, Math.floor(u))), y0 = Math.max(0, Math.min(this.h - 2, Math.floor(v)));
    const fx = Math.min(1, Math.max(0, u - x0)), fy = Math.min(1, Math.max(0, v - y0));
    const g = (xx: number, yy: number) => this.d[yy * this.w + xx];
    const val = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
    return this.min + (val / 65535) * (this.max - this.min);
  }
  /** Direction (unit x/z) toward the nearest open water within `r`, or null. */
  seaward(x: number, z: number, r = 0.35): [number, number] | null {
    let best: [number, number] | null = null, bestH = Infinity;
    for (let a = 0; a < 16; a++) {
      const dx = Math.cos((a / 16) * Math.PI * 2), dz = Math.sin((a / 16) * Math.PI * 2);
      const hh = this.at(x + dx * r, z + dz * r);
      if (hh < bestH) { bestH = hh; best = [dx, dz]; }
    }
    return bestH < 0 ? best : null;
  }
}

/* ------------------------------------------------------------- parts ---- */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = ng.attributes['position'].count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  ng.deleteAttribute('uv');
  return ng;
}

/** Scale every vertex colour, e.g. to turn grey stone black. */
function darken(g: THREE.BufferGeometry, k: number): void {
  const c = g.attributes['color'] as THREE.BufferAttribute;
  for (let i = 0; i < c.array.length; i++) (c.array as Float32Array)[i] *= k;
  c.needsUpdate = true;
}

/** Gable-roofed house: walls box + triangular prism roof. */
function house(w: number, d: number, h: number, wall: number, roof: number): THREE.BufferGeometry {
  const body = paint(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), wall);
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2 - .0012, 0), new THREE.Vector2(w / 2 + .0012, 0), new THREE.Vector2(0, h * .75)]);
  const r = paint(new THREE.ExtrudeGeometry(shape, { depth: d + .002, bevelEnabled: false }).translate(0, h, -d / 2 - .001), roof);
  return mergeGeometries([body, r])!;
}

const WALLS = [0xe6dcc6, 0xd9ccb0, 0xcfc4ad, 0xb9a98c, 0xe9e2d2];
const ROOFS_N = [0x5b4b45, 0x6e5a4c, 0x4f4a48];            // slate and shingle in the north
const ROOFS = [0x9a3e2c, 0xa5502f, 0x8c3a2a, 0x7a4b34];    // tile elsewhere
const ROOFS_S = [0xc0683e, 0xb5562f, 0xd18a52];            // bright tile in the south
const STONE = 0xa49a88;

function church(s: number, tall = 1): THREE.BufferGeometry {
  return mergeGeometries([
    house(.016 * s, .03 * s, .018 * s, 0xded5c2, 0x6a5a52),
    paint(new THREE.BoxGeometry(.011 * s, .05 * s * tall, .011 * s).translate(0, .025 * s * tall, -.018 * s), 0xded5c2),
    paint(new THREE.ConeGeometry(.009 * s, .03 * s * tall, 4).rotateY(Math.PI / 4).translate(0, .065 * s * tall, -.018 * s), 0x55606a),
  ])!;
}

function tower(r: number, h: number, roof: number): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(r, r * 1.08, h, 8).translate(0, h / 2, 0), STONE),
    paint(new THREE.ConeGeometry(r * 1.35, h * .45, 8).translate(0, h + h * .22, 0), roof),
  ])!;
}

function wallRing(radius: number, h: number, towers: number, roof: number, gap = -1): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const segs = towers;
  for (let i = 0; i < segs; i++) {
    if (i === gap) continue;
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius, x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    const len = Math.hypot(x1 - x0, z1 - z0);
    out.push(paint(new THREE.BoxGeometry(len, h, h * .35).rotateY(-Math.atan2(z1 - z0, x1 - x0)).translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2), STONE));
    out.push(tower(h * .32, h * 1.5, roof).translate(x0, 0, z0));
  }
  return out;
}

/**
 * Build the model for one place. Houses are scattered on land only (checked against the height field)
 * and each piece sits on the ground under it, so towns follow hills and shores.
 */
/** A post mill: a whitewashed tower with four sails, about as tall as a tree. */
export function windmill(s = 1, sail = 0x6b5236, wall = 0xd8cdb6): THREE.BufferGeometry {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(.004 * s, .0062 * s, .022 * s, 6).translate(0, .011 * s, 0), wall),
    paint(new THREE.ConeGeometry(.0052 * s, .006 * s, 6).translate(0, .025 * s, 0), 0x6e5a4c),
    paint(new THREE.BoxGeometry(.0012 * s, .032 * s, .0015 * s).rotateZ(.5).translate(0, .021 * s, .0062 * s), sail),
    paint(new THREE.BoxGeometry(.0012 * s, .032 * s, .0015 * s).rotateZ(.5 + Math.PI / 2).translate(0, .021 * s, .0062 * s), sail),
  ])!;
}

export function buildSettlement(type: Settlement, key: string, x: number, z: number, hf: HeightField, lat: number,
                                opt: { angle?: number; pit?: number } = {}): THREE.BufferGeometry | null {
  if (type === 'nature' || type === 'water' || type === 'land') return null;
  let seed = 7;
  for (const c of key) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const r = rng(seed);
  const roofs = lat < 0.3 ? ROOFS_N : lat > 0.62 ? ROOFS_S : ROOFS;
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const parts: THREE.BufferGeometry[] = [];
  const K = 1.7;                                  // buildings read at the same scale as the trees
  const put = (g: THREE.BufferGeometry, dx: number, dz: number, rot = 0) => {
    dx *= K; dz *= K;
    g.scale(K, K, K);
    const y = hf.at(x + dx, z + dz);
    if (y < 0.004 || hf.wet(x + dx, z + dz)) return false;      // never build in the water
    parts.push(g.rotateY(rot).translate(dx, y - .002, dz));
    return true;
  };
  const houses = (n: number, radius: number, size: number, inner = 0) => {
    let placed = 0;
    for (let i = 0; i < n * 3 && placed < n; i++) {
      const a = r() * Math.PI * 2, d = inner + Math.sqrt(r()) * (radius - inner);
      const w = (.008 + r() * .006) * size, dd = (.01 + r() * .008) * size, h = (.007 + r() * .005) * size;
      if (put(house(w, dd, h, pick(WALLS), pick(roofs)), Math.cos(a) * d, Math.sin(a) * d, a + (r() - .5) * .6)) placed++;
    }
  };

  switch (type) {
    case 'capital': {
      // Фаунтерра has no city walls; the sprawl surrounds the palace of Pen and Sword,
      // which has its own wall, and the Престольная Цитадель stands apart
      houses(120, .22, 1.1, .055);
      put(mergeGeometries(wallRing(.05, .014, 8, 0xc9a04a))!, 0, 0);
      put(mergeGeometries([...wallRing(.03, .02, 5, pick(roofs)), tower(.012, .075, pick(roofs))])!, -.12, -.09);
      // the palace: a long block with corner towers and gilded domes
      put(mergeGeometries([
        paint(new THREE.BoxGeometry(.07, .03, .04).translate(0, .015, 0), 0xe8e2d4),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => tower(.008, .045, 0xc9a04a).translate(sx * .035, 0, sz * .02)),
        paint(new THREE.SphereGeometry(.014, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, .03, 0), 0xd3ad55),
      ])!, 0, 0);
      put(church(1.4, 1.3), .09, -.05); put(church(1.2), -.1, .04);
      break;
    }
    case 'city': {
      // open cities: the books give walls only to fortresses (Лабелин famously has none)
      houses(55, .13, 1, .02);
      put(church(1.3, 1.2), .02, -.02); put(tower(.012, .07, pick(roofs)), -.03, .03);
      break;
    }
    case 'stronghold': {
      // a castle on the high point with the town below it
      houses(22, .09, .95, .05);
      const keep = mergeGeometries([
        ...wallRing(.04, .022, 6, pick(roofs)),
        tower(.014, .085, pick(roofs)),
        paint(new THREE.BoxGeometry(.03, .04, .022).translate(.012, .02, .01), STONE),
      ])!;
      // the castle of Первая Зима is black: «чёрный замок — зрачок»
      if (key === 'pervaya-zima') darken(keep, .28);
      put(keep, 0, 0);
      put(church(1), .06, .05);
      break;
    }
    case 'castle':
    case 'fort': {
      put(mergeGeometries([...wallRing(.028, .016, type === 'fort' ? 4 : 5, pick(roofs)), tower(.01, .055, pick(roofs))])!, 0, 0);
      if (type === 'castle') houses(5, .05, .8);
      break;
    }
    case 'port': {
      houses(26, .08, .95, .015);
      put(church(1.1), 0, 0);
      const dir = hf.seaward(x, z);
      if (dir) {
        // piers stretch out over the water toward the open sea
        for (let i = -1; i <= 1; i++) {
          const px = (dir[0] * .07 - dir[1] * i * .03) * K, pz = (dir[1] * .07 + dir[0] * i * .03) * K;
          parts.push(paint(new THREE.BoxGeometry(.06 * K, .004, .008 * K), 0x6d5640)
            .rotateY(-Math.atan2(dir[1], dir[0])).translate(px, .006, pz));
          // a moored boat with a mast at the end of each pier
          const bx = (dir[0] * .11 - dir[1] * i * .03) * K, bz = (dir[1] * .11 + dir[0] * i * .03) * K;
          parts.push(paint(new THREE.BoxGeometry(.016 * K, .005 * K, .006 * K).rotateY(-Math.atan2(dir[1], dir[0])).translate(bx, .006, bz), 0x5a3d26));
          parts.push(paint(new THREE.CylinderGeometry(.0008, .0008, .02 * K, 4).translate(bx, .006 + .01 * K, bz), 0x3b2a1c));
        }
      }
      break;
    }
    case 'town': houses(16, .06, .9, .015); put(church(1), 0, 0); break;
    case 'village': houses(7, .045, .8); put(windmill(), .04, .02, r() * 3); break;
    case 'steppe': {
      // a shavan camp: rings of felt yurts around a chieftain's great tent
      for (let ring = 1; ring <= 3; ring++) {
        const n = ring * 9;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ring, d = ring * .035;
          put(mergeGeometries([
            paint(new THREE.CylinderGeometry(.007, .007, .006, 8).translate(0, .003, 0), pick([0xe9e1cf, 0xd8ccb2, 0xc2ae8a])),
            paint(new THREE.ConeGeometry(.0075, .006, 8).translate(0, .009, 0), pick([0xb3a07c, 0x8c7458, 0xd4c7aa])),
          ])!, Math.cos(a) * d, Math.sin(a) * d);
        }
      }
      put(mergeGeometries([
        paint(new THREE.CylinderGeometry(.018, .018, .012, 12).translate(0, .006, 0), 0xf1e8d2),
        paint(new THREE.ConeGeometry(.02, .016, 12).translate(0, .02, 0), 0x9b2f26),
      ])!, 0, 0);
      break;
    }
    case 'monastery': {
      put(mergeGeometries([
        church(1.2, 1.2),
        paint(new THREE.BoxGeometry(.05, .01, .006).translate(0, .005, .03), 0xd2c8b2),
        paint(new THREE.BoxGeometry(.006, .01, .05).translate(.025, .005, .005), 0xd2c8b2),
        paint(new THREE.BoxGeometry(.006, .01, .05).translate(-.025, .005, .005), 0xd2c8b2),
      ])!, 0, 0);
      break;
    }
    case 'cathedral': put(church(2.1, 1.5), 0, 0); houses(6, .05, .8); break;
    case 'palace': {
      put(mergeGeometries([
        paint(new THREE.BoxGeometry(.06, .022, .03).translate(0, .011, 0), 0xf0ece2),
        paint(new THREE.BoxGeometry(.02, .03, .045).translate(-.03, .015, .005), 0xf0ece2),
        paint(new THREE.BoxGeometry(.02, .03, .045).translate(.03, .015, .005), 0xf0ece2),
        paint(new THREE.ConeGeometry(.04, .012, 4).rotateY(Math.PI / 4).scale(1, 1, .5).translate(0, .028, 0), 0x4c5a6a),
      ])!, 0, 0);
      break;
    }
    case 'bridge':
    case 'dam': {
      // both span the river: the angle is the direction across the current
      const a = opt.angle ?? 0, cx = Math.cos(a), cz = Math.sin(a), half = type === 'dam' ? .09 : .085;
      const bank = Math.max(hf.at(x + cx * half, z + cz * half), hf.at(x - cx * half, z - cz * half), 0.01);
      const bed = Math.max(Math.min(hf.at(x, z), bank - .01), 0);
      const across = (g: THREE.BufferGeometry) => g.rotateY(-a);
      if (type === 'bridge') {
        const deck = bank + .008;
        parts.push(across(mergeGeometries([
          paint(new THREE.BoxGeometry(half * 2, .006, .016).translate(0, deck, 0), STONE),
          ...[-.5, 0, .5].map((t) => paint(new THREE.BoxGeometry(.008, deck - bed + .01, .014).translate(t * half, (deck + bed) / 2 - .005, 0), 0x8f8676)),
          paint(new THREE.BoxGeometry(half * 2, .004, .0015).translate(0, deck + .005, .0072), 0x7d7466),
          paint(new THREE.BoxGeometry(half * 2, .004, .0015).translate(0, deck + .005, -.0072), 0x7d7466),
        ])!));
      } else {
        // Эрроубэк: a giant stone dam across the Бэк with the red-brick spark works on its crest,
        // walled bastions at both ends and the water roaring out of tunnels at its foot
        const top = bank + .02, brick = 0xa5583a;
        parts.push(across(mergeGeometries([
          paint(new THREE.BoxGeometry(half * 2.2, top - bed + .01, .03).translate(0, (top + bed) / 2 - .005, 0), 0x9c9484),
          paint(new THREE.BoxGeometry(.05, .03, .024).translate(0, top + .015, 0), brick),
          paint(new THREE.ConeGeometry(.03, .016, 4).rotateY(Math.PI / 4).scale(1, 1, .5).translate(0, top + .038, 0), 0x5b4b45),
          tower(.006, .05, 0x5b4b45).translate(.018, top, -.006), tower(.006, .05, 0x5b4b45).translate(-.018, top, -.006),
          ...[-1, 1].map((sx) => paint(new THREE.CylinderGeometry(.022, .026, .028, 7).translate(sx * half * 1.15, bank + .014, 0), STONE)),
          ...[-1, 1].map((sx) => tower(.007, .045, 0x5b4b45).translate(sx * half * 1.15, bank + .028, 0)),
          ...[-.4, 0, .4].map((t) => paint(new THREE.BoxGeometry(.012, .006, .03).translate(t * half, bed + .003, .028), 0xe8f1f4)),
        ])!));
      }
      break;
    }
    case 'gift': {
      // the bed of a Gift is a giant sinkhole (carved into the relief); the Seventeenth is a place of
      // pilgrimage with a chapel, prayer posts and the knights' monument on its rim
      if (key === 'dar-17') {
        const rim = (opt.pit ?? .26) * 1.12 / K;
        put(church(1.1), rim * .7, rim * .7, -Math.PI / 4);
        put(paint(new THREE.BoxGeometry(.006, .02, .006).translate(0, .01, 0), 0xb9b3a6), rim * .95, -rim * .1);
        for (let i = 0; i < 7; i++) {
          const a = .3 + (i / 7) * 1.4;
          put(paint(new THREE.CylinderGeometry(.0009, .0009, .012, 4).translate(0, .006, 0), 0x6b5236), Math.cos(a) * rim, Math.sin(a) * rim);
        }
      }
      break;
    }
    case 'mothermills': {
      // Дженна (angular tower with a stone crown), Арина (slender, green sails), Милана (a colonnade under a spire)
      const sails = (len: number, hex: number, y: number, zf: number) => [0, 1].map((i) =>
        paint(new THREE.BoxGeometry(.003, len, .003).rotateZ(.35 + (i * Math.PI) / 2).translate(0, y, zf), hex));
      put(mergeGeometries([
        paint(new THREE.BoxGeometry(.022, .07, .022).translate(0, .035, 0), 0x8f8a80),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => paint(new THREE.BoxGeometry(.006, .012, .006).translate(sx * .009, .076, sz * .009), 0x8f8a80))),
        ...sails(.1, 0x4a3a2a, .062, .014),
      ])!, .11, .08, .4);
      put(mergeGeometries([
        paint(new THREE.CylinderGeometry(.008, .014, .085, 10).translate(0, .0425, 0), 0xcfc6b0),
        paint(new THREE.ConeGeometry(.011, .02, 10).translate(0, .095, 0), 0x3f6b3a),
        ...sails(.1, 0x3d7a3a, .078, .012),
      ])!, -.11, -.07, -.3);
      put(mergeGeometries([
        ...Array.from({ length: 10 }, (_, i) => paint(new THREE.CylinderGeometry(.0018, .0018, .05, 5)
          .translate(Math.cos((i / 10) * Math.PI * 2) * .014, .025, Math.sin((i / 10) * Math.PI * 2) * .014), 0xe9e2d2)),
        paint(new THREE.CylinderGeometry(.017, .017, .006, 12).translate(0, .053, 0), 0x8a5a3a),
        paint(new THREE.ConeGeometry(.007, .04, 8).translate(0, .076, 0), 0x8a5a3a),
        paint(new THREE.OctahedronGeometry(.005).translate(0, .1, 0), 0xe8c860),
        ...sails(.1, 0xc9ccd2, .06, .02),
      ])!, 0, 0, 0);
      break;
    }
    case 'cemetery': {
      // the cemeteries of the Rusty Giants: tens of thousands of iron-and-granite warriors, the lords cast whole in iron
      for (let i = 0; i < 260; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * .07, big = r() < .06;
        const hgt = big ? .022 + r() * .012 : .004 + r() * .005;
        put(paint(new THREE.BoxGeometry(hgt * .32, hgt, hgt * .32).translate(0, hgt / 2, 0), big || r() < .4 ? pick([0x7a4a2a, 0x6b3d22, 0x8a5530]) : 0x8a8580),
          Math.cos(a) * d, Math.sin(a) * d, r() * 3);
      }
      break;
    }
  }
  return parts.length ? mergeGeometries(parts) : null;
}
