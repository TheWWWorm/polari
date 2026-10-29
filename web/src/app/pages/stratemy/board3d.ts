import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, output, viewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLS, Cell, Kind, ROWS, Side, Terrain, cellName, roadLinks } from './engine';
import { GLYPH } from './glyphs';

/** One piece as the board shows it. */
export interface BoardPiece { id: number; kind: Kind; side: Side; r: number; c: number; spent: boolean; sel: boolean; target: boolean; can: boolean }

const BASE = 0.18;
const TOP: Record<Terrain, number> = { plain: 0.2, road: 0.2, forest: 0.22, hill: 0.2, stream: 0.08, ruins: 0.24, edge: 0 };
const SOIL: Record<Terrain, number> = { plain: 0x9fae62, road: 0x9fae62, forest: 0x6f8a46, hill: 0xb3a86a, stream: 0x6d6450, ruins: 0xa49d8c, edge: 0 };
const LACQUER: Record<Side, number> = { red: 0xa8302a, blue: 0x2c64a0 };
const other = (s: Side): Side => (s === 'red' ? 'blue' : 'red');

/** Hex radius; flat side up, odd columns half a cell lower, as in the engine. */
const S = 0.6, SQ = Math.sqrt(3);
const x = (c: number) => (c - (COLS - 1) / 2) * 1.5 * S;
const z = (r: number, c: number) => (r + (c & 1) * 0.5 - (ROWS - 0.5) / 2) * SQ * S;
/** Height of the ground a piece stands on. */
const ground = (t: Terrain) => BASE + (t === 'stream' ? 0.12 : t === 'hill' ? 0.44 : TOP[t]);
const hexPrism = (radius: number, h: number) => new THREE.CylinderGeometry(radius, radius, h, 6, 1, false, Math.PI / 6).translate(0, h / 2, 0);

/**
 * The field as a carved wooden diorama: hexagonal cells, raised hills, a sunken river, groves,
 * a road and a broken castle, with lacquered two-sided tokens that glide from cell to cell.
 * It only draws; every click goes back to the page, which owns the game.
 */
@Component({
  selector: 'app-stratemy-board3d',
  template: `<div class="stage" #stage><canvas #canvas></canvas></div>`,
  styles: `
    :host { display: block; }
    .stage { position: relative; aspect-ratio: 1 / 1; max-height: 86vh; min-height: 380px; width: 100%; border-radius: var(--radius-m); overflow: hidden; touch-action: none; background: #2b2118; }
    canvas { display: block; width: 100%; height: 100%; cursor: grab; }
    canvas.point { cursor: pointer; }
    canvas.aim { cursor: crosshair; }
  `,
})
export class StratemyBoard3d implements OnDestroy {
  readonly field = input.required<Terrain[][]>();
  readonly pieces = input.required<BoardPiece[]>();
  readonly reach = input<Cell[]>([]);
  readonly cellClick = output<Cell>();
  readonly pieceClick = output<number>();
  readonly pieceHover = output<number | null>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private renderer?: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private resizeObs?: ResizeObserver;
  private frame = 0;
  private scene = new THREE.Scene();
  private terrain = new THREE.Group();
  private tiles?: THREE.InstancedMesh;
  private dots: THREE.InstancedMesh;
  private tokens = new Map<number, Token>();
  private caps = new Map<string, THREE.MeshStandardMaterial>();
  private hovered: number | null = null;
  private fieldNow: Terrain[][] = [];

  constructor() {
    this.dots = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.03, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe7a6, transparent: true, opacity: 0.9 }),
      ROWS * COLS,
    );
    this.dots.count = 0;
    afterNextRender(() => this.init());
    effect(() => { const f = this.field(); if (this.renderer) this.buildField(f); });
    effect(() => { const p = this.pieces(); if (this.renderer) this.syncPieces(p); });
    effect(() => { const r = this.reach(); if (this.renderer) this.syncReach(r); });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObs?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
  }

  private init(): void {
    const canvas = this.canvas().nativeElement, stage = this.stage().nativeElement;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = this.scene;
    scene.background = new THREE.Color(0x2b2118);
    scene.fog = new THREE.Fog(0x2b2118, 36, 70);
    scene.add(new THREE.HemisphereLight(0xf3e6cf, 0x3a2a1a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(-8, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    scene.add(sun);

    scene.add(makeTable(), this.terrain, this.dots);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    camera.position.set(0, 25.5, 19.5);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0, 1.6);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 7;
    controls.maxDistance = 42;
    controls.maxPolarAngle = Math.PI * 0.44;
    controls.screenSpacePanning = false;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls = controls;

    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    this.resizeObs = new ResizeObserver(resize);
    this.resizeObs.observe(stage);
    resize();

    this.buildField(this.field());
    this.syncPieces(this.pieces());
    this.syncReach(this.reach());

    // a press that barely moves is a click; anything longer turns the board
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const pick = (ev: PointerEvent) => {
      const rc = canvas.getBoundingClientRect();
      ndc.set(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const bodies = [...this.tokens.values()].map((t) => t.mesh);
      const hit = ray.intersectObjects(bodies, true)[0];
      if (hit) {
        let o: THREE.Object3D | null = hit.object;
        while (o && o.userData['id'] == null) o = o.parent;
        if (o) return { piece: o.userData['id'] as number };
      }
      const cell = this.tiles && ray.intersectObject(this.tiles)[0];
      if (cell?.instanceId != null) return { cell: { r: Math.floor(cell.instanceId / COLS), c: cell.instanceId % COLS } };
      return {};
    };
    canvas.addEventListener('pointerdown', (ev) => (down = { x: ev.clientX, y: ev.clientY }));
    canvas.addEventListener('pointerup', (ev) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
      down = null;
      const h = pick(ev);
      if (h.piece != null) this.pieceClick.emit(h.piece);
      else if (h.cell) this.cellClick.emit(h.cell);
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (ev.buttons) return;
      const h = pick(ev), id = h.piece ?? null;
      if (id !== this.hovered) { this.hovered = id; this.pieceHover.emit(id); }
      const t = id != null ? this.tokens.get(id) : undefined;
      const reachable = h.cell && this.reach().some((c) => c.r === h.cell!.r && c.c === h.cell!.c);
      canvas.classList.toggle('aim', !!t?.state.target);
      canvas.classList.toggle('point', !t?.state.target && (!!t?.state.can || !!reachable));
    });
    canvas.addEventListener('pointerleave', () => { if (this.hovered != null) { this.hovered = null; this.pieceHover.emit(null); } });

    const clock = new THREE.Clock();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      for (const tok of this.tokens.values()) tok.step(dt, t);
      (this.dots.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(t * 4) * 0.2;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
  }

  /** Lay the frame, the cells and their groves, hills, water, roads and ruins. */
  private buildField(f: Terrain[][]): void {
    if (f === this.fieldNow) return;
    this.fieldNow = f;
    for (const o of [...this.terrain.children]) {
      this.terrain.remove(o);
      o.traverse((m) => { if (m instanceof THREE.Mesh) m.geometry.dispose(); });
    }
    const on = (r: number, c: number) => f[r]?.[c] != null && f[r][c] !== 'edge';
    const rnd = seeded(f.flat().map((t, i) => (t === 'forest' ? i : 0)).reduce((a, b) => a + b, 7));
    const tiles = new THREE.InstancedMesh(hexPrism(S * 0.96, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), ROWS * COLS);
    tiles.receiveShadow = true;
    tiles.castShadow = true;
    const m = new THREE.Matrix4(), col = new THREE.Color();
    const parts: Record<string, THREE.BufferGeometry[]> = { frame: [], leaf: [], trunk: [], mound: [], stone: [], water: [], road: [] };
    const add = (k: string, g: THREE.BufferGeometry, px: number, py: number, pz: number, ry = 0) =>
      parts[k].push(g.rotateY(ry).translate(px, py, pz));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = f[r][c], i = r * COLS + c;
      if (t === 'edge') { tiles.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      const cx = x(c), cz = z(r, c), h = TOP[t], top = BASE + h;
      add('frame', hexPrism(S * 1.22, BASE), cx, 0, cz);
      m.makeScale(1, h, 1).setPosition(cx, BASE, cz);
      tiles.setMatrixAt(i, m);
      col.setHex(SOIL[t]).offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.05);
      tiles.setColorAt(i, col);
      if (t === 'forest') {
        for (let k = 0; k < 4; k++) {
          const px = cx + (rnd() - 0.5) * 0.55, pz = cz + (rnd() - 0.5) * 0.55, s = 0.7 + rnd() * 0.5;
          add('trunk', new THREE.CylinderGeometry(0.03, 0.04, 0.12 * s, 5), px, top + 0.06 * s, pz);
          add('leaf', new THREE.ConeGeometry(0.14 * s, 0.42 * s, 7), px, top + 0.3 * s, pz, rnd() * 3);
        }
      } else if (t === 'hill') {
        add('mound', new THREE.SphereGeometry(S * 0.88, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.46, 1), cx, top, cz);
      } else if (t === 'stream') {
        add('water', hexPrism(S, 0.1), cx, top, cz);
      } else if (t === 'road') {
        add('road', new THREE.CylinderGeometry(0.16, 0.16, 0.016, 16), cx, top + 0.008, cz);
      } else if (t === 'ruins') {
        const walls: [number, number, number, number][] = [[-0.3, 0, 0.07, 0.62], [0.3, 0.08, 0.07, 0.48], [0, -0.33, 0.6, 0.07]];
        for (const [dx, dz, w, d] of walls) {
          const hh = 0.12 + rnd() * 0.2;
          add('stone', new THREE.BoxGeometry(w, hh, d), cx + dx, top + hh / 2, cz + dz);
        }
        add('stone', new THREE.BoxGeometry(0.15, 0.42, 0.15), cx - 0.28, top + 0.21, cz - 0.3);
      }
    }
    for (const [a, n] of roadLinks(f)) {
      const ax = x(a.c), az = z(a.r, a.c), dx = x(n.c) - ax, dz = z(n.r, n.c) - az;
      add('road', new THREE.BoxGeometry(0.32, 0.012, Math.hypot(dx, dz)), ax + dx / 2, BASE + TOP.road + 0.006, az + dz / 2, Math.atan2(dx, dz));
    }
    tiles.instanceMatrix.needsUpdate = true;
    this.tiles = tiles;
    this.terrain.add(tiles);
    const mats: Record<string, THREE.Material> = {
      frame: new THREE.MeshStandardMaterial({ color: 0x7a5434, roughness: 0.6 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x3f6a33, roughness: 0.8, flatShading: true }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1 }),
      mound: new THREE.MeshStandardMaterial({ color: 0xb3a86a, roughness: 0.95 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x8e887c, roughness: 1, flatShading: true }),
      water: new THREE.MeshStandardMaterial({ color: 0x4d8fb8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 }),
      road: new THREE.MeshStandardMaterial({ color: 0xc9ad74, roughness: 1 }),
    };
    for (const [k, gs] of Object.entries(parts)) {
      if (!gs.length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(gs), mats[k]);
      mesh.castShadow = k !== 'water' && k !== 'road';
      mesh.receiveShadow = true;
      mesh.raycast = () => {};   // clicks go to the cell underneath
      this.terrain.add(mesh);
    }
    // letters under each column and numbers beside each row, burnt into the table
    for (let c = 0; c < COLS; c++) {
      const r = [...Array(ROWS).keys()].reverse().find((r) => on(r, c))!;
      this.terrain.add(label(cellName({ r: ROWS - 1, c }).replace(/\d+/, ''), x(c), z(r, c) + 1.05));
    }
    for (let r = 0; r < ROWS; r++) {
      const c = [...Array(COLS).keys()].find((c) => on(r, c))!;
      this.terrain.add(label(String(ROWS - r), x(c) - 1.05, z(r, c)));
    }
    for (const tok of this.tokens.values()) tok.ground = ground(f[tok.r][tok.c]);
  }

  private syncPieces(list: BoardPiece[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let tok = this.tokens.get(p.id);
      if (!tok) {
        tok = new Token(p, this.cap.bind(this));
        tok.place(p, ground(this.fieldNow[p.r]?.[p.c] ?? 'plain'), true);
        this.tokens.set(p.id, tok);
        this.scene.add(tok.mesh);
      }
      tok.update(p, ground(this.fieldNow[p.r][p.c]));
    }
    for (const [id, tok] of this.tokens) if (!seen.has(id)) { tok.fall(() => this.scene.remove(tok.mesh)); this.tokens.delete(id); }
  }

  private syncReach(cells: Cell[]): void {
    const m = new THREE.Matrix4();
    cells.forEach((c, i) => this.dots.setMatrixAt(i, m.makeTranslation(x(c.c), ground(this.fieldNow[c.r][c.c]) + 0.02, z(c.r, c.c))));
    this.dots.count = cells.length;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  /** The lacquered face of a token, with its pictogram painted on. */
  private cap(side: Side, kind: Kind): THREE.MeshStandardMaterial {
    const key = side + kind;
    let mat = this.caps.get(key);
    if (!mat) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#' + LACQUER[side].toString(16).padStart(6, '0');
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(255, 231, 166, .55)';
      g.lineWidth = 6;
      g.beginPath(); g.arc(128, 128, 116, 0, Math.PI * 2); g.stroke();
      g.translate(128, 128); g.scale(7, 7); g.translate(-12, -12);
      const path = new Path2D(GLYPH[kind]);
      g.lineCap = g.lineJoin = 'round';
      if (kind === 'iskra') { g.fillStyle = '#ffd46a'; g.fill(path); g.lineWidth = 0.7; g.strokeStyle = '#fff6e4'; g.stroke(path); }
      else { g.lineWidth = 2.3; g.strokeStyle = '#fff6e4'; g.stroke(path); }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 });
      this.caps.set(key, mat);
    }
    return mat;
  }
}

/**
 * A token and its motion. Tokens are two-sided, each face in one army's colour:
 * a bribed sword is simply turned over.
 */
class Token {
  readonly mesh = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly body: THREE.MeshStandardMaterial;
  private readonly face: THREE.Mesh;
  private readonly back: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly aim: THREE.Mesh;
  private readonly to = new THREE.Vector3();
  private readonly tall: number;
  private dying: { t: number; done: () => void } | null = null;
  private flip: { t: number; to: Side } | null = null;
  private shown: Side;
  state: BoardPiece;
  ground = 0;
  get r() { return this.state.r; }
  get c() { return this.state.c; }

  constructor(p: BoardPiece, private readonly capOf: (s: Side, k: Kind) => THREE.MeshStandardMaterial) {
    this.state = p;
    this.shown = p.side;
    const tall = (this.tall = p.kind === 'iskra' ? 0.34 : 0.22);
    // a bevelled disc turned on a lathe, centred on its middle so it can be turned over
    const R = 0.38, b = 0.04;
    const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(R - b, 0), new THREE.Vector2(R, b), new THREE.Vector2(R, tall - b),
      new THREE.Vector2(R - b, tall), new THREE.Vector2(0, tall)];
    this.body = new THREE.MeshStandardMaterial({ color: LACQUER[p.side], roughness: 0.4 });
    const disc = new THREE.Mesh(new THREE.LatheGeometry(prof, 40).translate(0, -tall / 2, 0), this.body);
    disc.castShadow = disc.receiveShadow = true;
    this.face = new THREE.Mesh(new THREE.CircleGeometry(R - b, 40).rotateX(-Math.PI / 2), capOf(p.side, p.kind));
    this.face.position.y = tall / 2 + 0.002;
    this.back = new THREE.Mesh(new THREE.CircleGeometry(R - b, 40).rotateX(Math.PI / 2), capOf(other(p.side), p.kind));
    this.back.position.y = -tall / 2 - 0.002;
    this.face.raycast = this.back.raycast = () => {};
    this.spin.position.y = tall / 2;
    this.spin.add(disc, this.face, this.back);
    if (p.kind === 'iskra') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.005, 0.018, 8, 48).rotateX(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xd9a93c, metalness: 0.8, roughness: 0.3 }));
      this.spin.add(band);
    }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.52, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe7a6, transparent: true, depthWrite: false }));
    this.aim = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    this.ring.position.y = this.aim.position.y = 0.01;
    this.ring.raycast = this.aim.raycast = () => {};
    this.mesh.add(this.spin, this.ring, this.aim);
    this.mesh.userData['id'] = p.id;
  }

  place(p: BoardPiece, g: number, now = false): void {
    this.ground = g;
    this.to.set(x(p.c), g + (p.sel ? 0.18 : 0), z(p.r, p.c));
    if (now) this.mesh.position.copy(this.to);
  }

  update(p: BoardPiece, g: number): void {
    if (p.side !== this.shown && !this.flip) this.flip = { t: 0, to: p.side };
    this.state = p;
    this.place(p, g);
    this.ring.visible = p.sel;
    this.aim.visible = p.target;
    this.tint();
  }

  private tint(): void { this.body.color.setHex(LACQUER[this.shown]).multiplyScalar(this.state.spent ? 0.55 : 1); }

  fall(done: () => void): void { this.dying = { t: 0, done }; }

  step(dt: number, t: number): void {
    const pos = this.mesh.position;
    if (this.dying) {
      const d = this.dying;
      d.t += dt;
      pos.y += dt * 2.2;
      this.mesh.rotation.z += dt * 5;
      this.mesh.scale.setScalar(Math.max(0, 1 - d.t * 1.6));
      if (d.t > 0.62) { this.dying = null; d.done(); }
      return;
    }
    if (this.flip) {
      const f = this.flip;
      f.t = Math.min(1, f.t + dt * 1.6);
      this.spin.rotation.z = Math.PI * f.t;
      this.spin.position.y = this.tall / 2 + Math.sin(Math.PI * f.t) * 0.6;
      if (f.t >= 0.5 && this.shown !== f.to) { this.shown = f.to; this.tint(); }
      if (f.t >= 1) {
        // lying reversed now: swap the faces back so the new colour is the face again
        this.flip = null;
        this.spin.rotation.z = 0;
        this.spin.position.y = this.tall / 2;
        this.face.material = this.capOf(this.shown, this.state.kind);
        this.back.material = this.capOf(other(this.shown), this.state.kind);
      }
    }
    const k = 1 - Math.exp(-dt * 10);
    const far = Math.hypot(this.to.x - pos.x, this.to.z - pos.z);
    pos.x += (this.to.x - pos.x) * k;
    pos.z += (this.to.z - pos.z) * k;
    // hop while gliding to a new cell
    pos.y += (this.to.y + Math.min(far, 1) * 0.5 - pos.y) * k;
    (this.aim.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 6) * 0.35;
  }
}

/** A coordinate burnt into the table beside the board. */
function label(text: string, px: number, pz: number): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#e8d2a2'; g.font = '600 36px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }));
  m.position.set(px, 0.01, pz);
  m.raycast = () => {};
  return m;
}

/** The dark table under the board. */
function makeTable(): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#4a3421'; g.fillRect(0, 0, 512, 512);
  const rnd = seeded(3);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '30,18,8' : '110,80,50'}, ${0.08 + rnd() * 0.12})`;
    g.lineWidth = 1 + rnd() * 3;
    const y = rnd() * 512;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(170, y + (rnd() - 0.5) * 30, 340, y + (rnd() - 0.5) * 30, 512, y + (rnd() - 0.5) * 20);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
  table.receiveShadow = true;
  table.raycast = () => {};
  return table;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
