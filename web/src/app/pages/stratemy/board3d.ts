import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, output, viewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLS, Cell, Kind, ROWS, Side, Terrain, cellName, roadLinks } from './engine';
import { GLYPH } from './glyphs';

/** One piece as the board shows it. */
export interface BoardPiece { id: number; kind: Kind; side: Side; r: number; c: number; sel: boolean; target: boolean; can: boolean }

const BASE = 0.18;
/** Top of the painted board, where the tokens stand. */
const FLOOR = BASE + 0.004;
/** Dye of each army; the other side of a token carries the other army's colour. */
const DYE: Record<Side, string> = { red: '#a3262a', blue: '#2d6fb0' };
const BONE = 0xece0c4;
const other = (s: Side): Side => (s === 'red' ? 'blue' : 'red');

/** Hex radius; flat side up, odd columns half a cell lower, as in the engine. */
const S = 0.6, SQ = Math.sqrt(3);
const x = (c: number) => (c - (COLS - 1) / 2) * 1.5 * S;
const z = (r: number, c: number) => (r + (c & 1) * 0.5 - (ROWS - 0.5) / 2) * SQ * S;
const hexPrism = (radius: number, h: number) => new THREE.CylinderGeometry(radius, radius, h, 6, 1, false, Math.PI / 6).translate(0, h / 2, 0);
/** The painted board's extent, and its texture resolution per unit. */
const BX = 6.7, BZ = 10.9, PX = 120;

/**
 * The board as the books describe it: a wooden field «со схематичными изображениями полей, лесов
 * и рек», cells laid out in a web of silver thread, rivers in blue enamel, roads in dotted lines;
 * and bone tokens dyed in the two armies' colours, their signs carved in, the spark's a gilded
 * lightning bolt. It only draws; every click goes back to the page, which owns the game.
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
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = this.scene;
    scene.background = new THREE.Color(0x2b2118);
    scene.fog = new THREE.Fog(0x2b2118, 36, 70);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    scene.add(new THREE.HemisphereLight(0xf3e6cf, 0x3a2a1a, 0.8));
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

  /** Make the board: a wooden body cut to the field's outline, a raised rim, and the painted face. */
  private buildField(f: Terrain[][]): void {
    if (f === this.fieldNow) return;
    this.fieldNow = f;
    for (const o of [...this.terrain.children]) {
      this.terrain.remove(o);
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        m.geometry.dispose();
        for (const mat of [m.material].flat()) { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); }
      });
    }
    const on = (r: number, c: number) => f[r]?.[c] != null && f[r][c] !== 'edge';
    const body: THREE.BufferGeometry[] = [], rim: THREE.BufferGeometry[] = [];
    // invisible flat cells, only there to be clicked
    const tiles = new THREE.InstancedMesh(hexPrism(S, 0.01), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), ROWS * COLS);
    const m = new THREE.Matrix4();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!on(r, c)) { tiles.setMatrixAt(r * COLS + c, m.makeScale(0, 0, 0)); continue; }
      tiles.setMatrixAt(r * COLS + c, m.makeTranslation(x(c), FLOOR, z(r, c)));
      body.push(hexPrism(S * 1.01, BASE).translate(x(c), 0, z(r, c)));
      rim.push(hexPrism(S * 1.24, BASE - 0.03).translate(x(c), 0, z(r, c)));
    }
    tiles.instanceMatrix.needsUpdate = true;
    this.tiles = tiles;
    const wood = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, map: grain() });
    const rimMesh = new THREE.Mesh(mergeGeometries(rim), wood(0x5e3c22));
    const bodyMesh = new THREE.Mesh(mergeGeometries(body), wood(0x8a6238));
    // the board stands on a wider plinth that follows its outline
    bodyMesh.position.y = 0.03;
    for (const o of [rimMesh, bodyMesh]) { o.castShadow = o.receiveShadow = true; o.raycast = () => {}; }
    const [map, gloss] = paintBoard(f);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BX * 2, BZ * 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map, roughnessMap: gloss, metalnessMap: gloss, metalness: 1, roughness: 1, alphaTest: 0.5 }));
    face.position.y = FLOOR + 0.03 - 0.002;
    face.receiveShadow = true;
    face.raycast = () => {};
    tiles.position.y = 0.03;
    this.terrain.add(rimMesh, bodyMesh, face, tiles);
    // letters under each column and numbers beside each row, burnt into the table
    for (let c = 0; c < COLS; c++) {
      const r = [...Array(ROWS).keys()].reverse().find((r) => on(r, c))!;
      this.terrain.add(label(cellName({ r: ROWS - 1, c }).replace(/\d+/, ''), x(c), z(r, c) + 1.15));
    }
    for (let r = 0; r < ROWS; r++) {
      const c = [...Array(COLS).keys()].find((c) => on(r, c))!;
      this.terrain.add(label(String(ROWS - r), x(c) - 1.15, z(r, c)));
    }
  }

  private syncPieces(list: BoardPiece[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let tok = this.tokens.get(p.id);
      if (!tok) {
        tok = new Token(p, this.cap.bind(this));
        tok.place(p, FLOOR + 0.03, true);
        this.tokens.set(p.id, tok);
        this.scene.add(tok.mesh);
      }
      tok.update(p, FLOOR + 0.03);
    }
    for (const [id, tok] of this.tokens) if (!seen.has(id)) { tok.fall(() => this.scene.remove(tok.mesh)); this.tokens.delete(id); }
  }

  private syncReach(cells: Cell[]): void {
    const m = new THREE.Matrix4();
    cells.forEach((c, i) => this.dots.setMatrixAt(i, m.makeTranslation(x(c.c), FLOOR + 0.05, z(c.r, c.c))));
    this.dots.count = cells.length;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  /** A token's face: bone dyed in the army's colour, the sign carved through to the bone. */
  private cap(side: Side, kind: Kind): THREE.MeshStandardMaterial {
    const key = side + kind;
    let mat = this.caps.get(key);
    if (!mat) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const g = cv.getContext('2d')!;
      g.fillStyle = DYE[side];
      g.fillRect(0, 0, 256, 256);
      // the dye soaks unevenly into bone
      const rnd = seeded(key.length * 31 + kind.charCodeAt(0));
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,240,220'}, ${rnd() * 0.06})`;
        g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 5, 1 + rnd() * 2);
      }
      g.translate(128, 128); g.scale(7.4, 7.4); g.translate(-12, -12);
      const path = new Path2D(GLYPH[kind]);
      g.lineCap = g.lineJoin = 'round';
      const cut = (dx: number, dy: number, style: string) => {
        g.save(); g.translate(dx, dy);
        if (kind === 'iskra') { g.fillStyle = style; g.fill(path); }
        else { g.lineWidth = 2.1; g.strokeStyle = style; g.stroke(path); }
        g.restore();
      };
      // a carved groove: shadow on one wall, then the bone (or gilding) inside
      cut(0.25, 0.3, 'rgba(30, 10, 5, .55)');
      cut(0, 0, kind === 'iskra' ? '#e6b94c' : '#efe4c8');
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 });
      this.caps.set(key, mat);
    }
    return mat;
  }
}

/**
 * A token and its motion. Tokens are bone discs dyed on both sides, one face in each army's
 * colour: a bribed sword is simply turned over («её оборот имел цвет угля»).
 */
class Token {
  readonly mesh = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly face: THREE.Mesh;
  private readonly back: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly aim: THREE.Mesh;
  private readonly to = new THREE.Vector3();
  private readonly tall = 0.14;
  private dying: { t: number; done: () => void } | null = null;
  private flip: { t: number; to: Side } | null = null;
  private shown: Side;
  state: BoardPiece;
  get r() { return this.state.r; }
  get c() { return this.state.c; }

  constructor(p: BoardPiece, private readonly capOf: (s: Side, k: Kind) => THREE.MeshStandardMaterial) {
    this.state = p;
    this.shown = p.side;
    const tall = this.tall;
    // a bevelled bone disc turned on a lathe, centred on its middle so it can be turned over
    const R = 0.37, b = 0.035;
    const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(R - b, 0), new THREE.Vector2(R, b), new THREE.Vector2(R, tall - b),
      new THREE.Vector2(R - b, tall), new THREE.Vector2(0, tall)];
    const disc = new THREE.Mesh(new THREE.LatheGeometry(prof, 48).translate(0, -tall / 2, 0), new THREE.MeshStandardMaterial({ color: BONE, roughness: 0.45 }));
    disc.castShadow = disc.receiveShadow = true;
    this.face = new THREE.Mesh(new THREE.CircleGeometry(R - b, 48).rotateX(-Math.PI / 2), capOf(p.side, p.kind));
    this.face.position.y = tall / 2 + 0.002;
    this.back = new THREE.Mesh(new THREE.CircleGeometry(R - b, 48).rotateX(Math.PI / 2), capOf(other(p.side), p.kind));
    this.back.position.y = -tall / 2 - 0.002;
    this.face.raycast = this.back.raycast = () => {};
    this.spin.position.y = tall / 2;
    this.spin.add(disc, this.face, this.back);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.5, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe7a6, transparent: true, depthWrite: false }));
    this.aim = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    this.ring.position.y = this.aim.position.y = 0.01;
    this.ring.raycast = this.aim.raycast = () => {};
    this.mesh.add(this.spin, this.ring, this.aim);
    this.mesh.userData['id'] = p.id;
  }

  place(p: BoardPiece, g: number, now = false): void {
    this.to.set(x(p.c), g + (p.sel ? 0.12 : 0), z(p.r, p.c));
    if (now) this.mesh.position.copy(this.to);
  }

  update(p: BoardPiece, g: number): void {
    if (p.side !== this.shown && !this.flip) this.flip = { t: 0, to: p.side };
    this.state = p;
    this.place(p, g);
    this.ring.visible = p.sel;
    this.aim.visible = p.target;
  }

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
      if (f.t >= 1) {
        // lying reversed now: swap the faces back so the new colour is the face again
        this.flip = null;
        this.shown = f.to;
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
    // a token is lifted and set down again, not dragged across the board
    pos.y += (this.to.y + Math.min(far, 1) * 0.5 - pos.y) * k;
    (this.aim.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 6) * 0.35;
  }
}

/**
 * The painted face of the board, and its gloss map (green: roughness, blue: metalness):
 * lacquered fields, woods and hills drawn as map signs, rivers in glossy enamel, roads dotted,
 * the castle drawn in ink, and the cells parted by threads of silver.
 */
function paintBoard(f: Terrain[][]): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const W = Math.round(BX * 2 * PX), H = Math.round(BZ * 2 * PX);
  const cv = document.createElement('canvas'), gv = document.createElement('canvas');
  cv.width = gv.width = W; cv.height = gv.height = H;
  const g = cv.getContext('2d')!, k = gv.getContext('2d')!;
  const at = (r: number, c: number) => [(x(c) + BX) * PX, (z(r, c) + BZ) * PX] as const;
  const hex = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rad: number) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; ctx[i ? 'lineTo' : 'moveTo'](cx + rad * Math.cos(a), cy + rad * Math.sin(a)); }
    ctx.closePath();
  };
  const rnd = seeded(f.flat().map((t, i) => (t === 'forest' || t === 'hill' ? i : 0)).reduce((a, b) => a + b, 11));
  const R = S * PX, INK = '#5a3f22';
  const FILL: Record<Terrain, string> = { plain: '#c4a066', road: '#c4a066', forest: '#8e9455', hill: '#bf955c', stream: '#2f6699', ruins: '#b49c74', edge: '' };
  const on = (r: number, c: number) => f[r][c] !== 'edge';
  // grounds, with lacquer that pools a little darker towards the cell edges
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!on(r, c)) continue;
    const [cx, cy] = at(r, c), t = f[r][c];
    hex(g, cx, cy, R * 1.01);
    const grad = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    grad.addColorStop(0, FILL[t]);
    grad.addColorStop(1, shade(FILL[t], t === 'stream' ? -0.12 : -0.07));
    g.fillStyle = grad;
    g.fill();
    hex(k, cx, cy, R * 1.01);
    k.fillStyle = t === 'stream' ? 'rgb(0, 50, 0)' : 'rgb(0, 150, 0)';
    k.fill();
  }
  g.lineCap = g.lineJoin = 'round';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const [cx, cy] = at(r, c), t = f[r][c];
    if (t === 'forest') {
      // three little spruces, the map sign for a wood
      const spots = [[-0.32, 0.18], [0.3, 0.2], [0, -0.22]];
      for (const [dx, dy] of spots) {
        const px = cx + (dx + (rnd() - 0.5) * 0.12) * R, py = cy + (dy + (rnd() - 0.5) * 0.1) * R, s = R * (0.24 + rnd() * 0.05);
        g.fillStyle = '#3f5c2c';
        g.beginPath(); g.moveTo(px, py - s); g.lineTo(px + s * 0.62, py + s * 0.55); g.lineTo(px - s * 0.62, py + s * 0.55); g.closePath(); g.fill();
        g.strokeStyle = '#3f5c2c'; g.lineWidth = R * 0.05;
        g.beginPath(); g.moveTo(px, py + s * 0.5); g.lineTo(px, py + s * 0.85); g.stroke();
      }
    } else if (t === 'hill') {
      // a hill drawn with hachures, as on old maps
      g.strokeStyle = INK; g.lineWidth = R * 0.06;
      g.beginPath(); g.arc(cx, cy + R * 0.35, R * 0.55, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      g.lineWidth = R * 0.035;
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (1.12 + i * 0.095), x0 = cx + Math.cos(a) * R * 0.55, y0 = cy + R * 0.35 + Math.sin(a) * R * 0.55;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * R * 0.18, y0 + Math.sin(a) * R * 0.18 + R * 0.1); g.stroke();
      }
    } else if (t === 'stream') {
      g.strokeStyle = 'rgba(225, 240, 250, .55)'; g.lineWidth = R * 0.05;
      for (const dy of [-0.25, 0.05, 0.35]) {
        g.beginPath();
        for (let i = 0; i <= 12; i++) { const px = cx - R * 0.55 + (i / 12) * R * 1.1, py = cy + dy * R + Math.sin(i * 1.3) * R * 0.05; g[i ? 'lineTo' : 'moveTo'](px, py); }
        g.stroke();
      }
    } else if (t === 'ruins') {
      // the home castle in ink, its walls broken
      g.strokeStyle = INK; g.fillStyle = 'rgba(90, 63, 34, .18)'; g.lineWidth = R * 0.06;
      const w = R * 0.7, h = R * 0.5, l = cx - w / 2, b = cy + h / 2;
      g.beginPath();
      g.moveTo(l, b); g.lineTo(l, b - h); g.lineTo(l + w * 0.15, b - h); g.lineTo(l + w * 0.15, b - h * 0.85); g.lineTo(l + w * 0.3, b - h * 0.85);
      g.lineTo(l + w * 0.3, b - h); g.lineTo(l + w * 0.45, b - h); g.lineTo(l + w * 0.55, b - h * 0.6); g.lineTo(l + w * 0.7, b - h * 0.75);
      g.lineTo(l + w, b - h * 0.45); g.lineTo(l + w, b);
      g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(cx - R * 0.1, b); g.lineTo(cx - R * 0.1, b - h * 0.4); g.arc(cx, b - h * 0.4, R * 0.1, Math.PI, 0); g.lineTo(cx + R * 0.1, b); g.stroke();
    }
  }
  // roads: dotted tracks between the centres of neighbouring road cells
  g.strokeStyle = '#6b4a28'; g.lineWidth = R * 0.11; g.setLineDash([R * 0.13, R * 0.14]);
  for (const [a, b] of roadLinks(f)) {
    const [ax, ay] = at(a.r, a.c), [bx, by] = at(b.r, b.c);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  g.setLineDash([]);
  // the silver web of cells
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!on(r, c)) continue;
    const [cx, cy] = at(r, c);
    hex(g, cx, cy, R); g.strokeStyle = '#c9ccd1'; g.lineWidth = R * 0.05; g.stroke();
    hex(k, cx, cy, R); k.strokeStyle = 'rgb(0, 70, 255)'; k.lineWidth = R * 0.05; k.stroke();
  }
  const map = new THREE.CanvasTexture(cv), gloss = new THREE.CanvasTexture(gv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = gloss.anisotropy = 8;
  return [map, gloss];
}

function shade(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + by))));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

/** A wood grain texture for the board's body and rim. */
function grain(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  const rnd = seeded(5);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(60, 35, 15, ${0.05 + rnd() * 0.12})`; g.lineWidth = 1 + rnd() * 2;
    const y = rnd() * 256;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(90, y + (rnd() - 0.5) * 14, 170, y + (rnd() - 0.5) * 14, 256, y); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
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
