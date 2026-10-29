import { Component, ElementRef, OnDestroy, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WikiData } from '../../core/wiki-data';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EXTRA, Features, HeightField, Settlement, buildSettlement, settlementOf, windmill } from './settlements';
import { D_UNITS, SUN_DIR, W_UNITS, makeForests, makeRoutes, makeSky, makeTarns, makeWater } from './world';

interface Label { el: HTMLElement; pos: THREE.Vector3; type: Settlement; rank: number; w: number }
interface Meta { hmin: number; hmax: number; hw: number; hh: number }

/** How far away (scene units) each kind of label is still shown, its declutter rank and lift above ground. */
const LABEL: Partial<Record<Settlement, { far: number; rank: number; lift: number }>> = {
  land: { far: 42, rank: 0, lift: .5 }, water: { far: 30, rank: 1, lift: .06 }, capital: { far: 26, rank: 1, lift: .22 },
  city: { far: 16, rank: 2, lift: .15 }, stronghold: { far: 16, rank: 2, lift: .16 }, port: { far: 14, rank: 3, lift: .12 },
  dam: { far: 12, rank: 3, lift: .13 }, nature: { far: 12, rank: 4, lift: .08 },
};
const DEFAULT_LABEL = { far: 9, rank: 5, lift: .1 };
/** Bump when map3d/ assets are re-exported, so browsers don't keep the old model. */
const ASSETS = 'v=8';
/** Ground kept clear of trees around each settlement type. */
const CLEARING: Partial<Record<Settlement, number>> = {
  capital: .36, city: .23, stronghold: .18, port: .17, town: .12, village: .09, steppe: .2, castle: .08, fort: .07, monastery: .07, cathedral: .1, palace: .08,
  dam: .12, mothermills: .3, cemetery: .14,
};

/** Even-odd point-in-polygon test. */
function inside(pts: [number, number][], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

@Component({
  selector: 'app-map3d-page',
  imports: [RouterLink],
  templateUrl: './map3d-page.html',
  styleUrl: './map3d-page.css',
})
export class Map3dPage implements OnDestroy {
  private readonly data = inject(WikiData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private readonly labelLayer = viewChild.required<ElementRef<HTMLDivElement>>('labelLayer');

  protected readonly labels = signal(true);
  protected readonly lands = signal(true);
  protected readonly forests = signal(true);
  protected readonly roads = signal(true);
  protected readonly painted = signal(false);
  protected readonly spin = signal(false);
  protected readonly progress = signal(0);
  protected readonly failed = signal(false);

  private renderer?: THREE.WebGLRenderer;
  private controls?: MapControls;
  private camera?: THREE.PerspectiveCamera;
  private terrainMat?: THREE.MeshStandardMaterial;
  private textures: { relief?: THREE.Texture; painted?: THREE.Texture } = {};
  private forestGroup?: THREE.Group;
  private routeGroup?: THREE.Group;
  private frame = 0;
  private items: Label[] = [];
  private flight: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
  private resizeObs?: ResizeObserver;

  constructor() {
    afterNextRender(() => this.init());
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
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xbcd0de, 34, 95);
    scene.add(makeSky());
    const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 600);
    this.camera = camera;
    scene.add(new THREE.HemisphereLight(0xd6e6f2, 0x6a5c3c, 1.15));

    // The sun's shadow box follows the view and is snapped to whole shadow texels in light space,
    // so shadows stay crisp up close and do not crawl or shimmer while the camera moves.
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
    const SHADOW = Math.min(innerWidth, innerHeight) < 700 ? 2048 : 4096;
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW, SHADOW);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.015;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    scene.add(sun, sun.target);
    const lightBasis = new THREE.Matrix4().lookAt(SUN_DIR, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const lightInv = lightBasis.clone().invert();
    let shadowHalf = 0;
    const tmp = new THREE.Vector3();
    const fitShadow = (target: THREE.Vector3, dist: number) => {
      const half = Math.min(18, Math.max(1.2, 1.25 ** Math.ceil(Math.log(Math.max(dist, .1) * 0.8) / Math.log(1.25))));
      const sc = sun.shadow.camera;
      if (half !== shadowHalf) {
        shadowHalf = half;
        sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
        sc.updateProjectionMatrix();
      }
      const texel = (2 * half) / SHADOW;
      tmp.copy(target).applyMatrix4(lightInv);
      tmp.x = Math.round(tmp.x / texel) * texel;
      tmp.y = Math.round(tmp.y / texel) * texel;
      tmp.applyMatrix4(lightBasis);
      sun.target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(SUN_DIR, 40);
    };

    const controls = new MapControls(camera, canvas);   // left button pans, right button rotates
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.5;
    controls.maxDistance = 48;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.zoomToCursor = true;
    controls.autoRotateSpeed = 0.5;
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.addEventListener('start', () => (this.flight = null));
    this.controls = controls;
    // #/map3d?view=north opens straight at one of the named views
    const start = this.route.snapshot.queryParamMap.get('view');
    this.setView(start && this.VIEWS[start] ? start : 'overview', true);

    const resize = () => {
      const w = stage.clientWidth, h = stage.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    this.resizeObs = new ResizeObserver(resize);
    this.resizeObs.observe(stage);
    resize();

    let water: THREE.Mesh | undefined;
    this.load(scene, renderer).then((w) => (water = w)).catch(() => this.failed.set(true));

    const clock = new THREE.Clock();
    const v = new THREE.Vector3();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (water) (water.material as THREE.ShaderMaterial).uniforms['uTime'].value = clock.getElapsedTime();
      if (this.flight) {
        const f = this.flight;
        f.t = Math.min(1, f.t + 0.016);
        const k = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2;
        camera.position.lerpVectors(f.from, f.to, k);
        controls.target.lerpVectors(f.tFrom, f.tTo, k);
        if (f.t >= 1) this.flight = null;
      }
      // keep the orbit point over the map and never below the ground plane
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -W_UNITS / 2, W_UNITS / 2);
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -D_UNITS / 2, D_UNITS / 2);
      controls.target.y = Math.max(0, controls.target.y);
      controls.update();
      fitShadow(controls.target, camera.position.distanceTo(controls.target));
      renderer.render(scene, camera);
      this.placeLabels(camera, stage.clientWidth, stage.clientHeight, v);
    };
    loop();
  }

  /** Terrain, water, settlements, forests and labels; resolves with the water mesh. */
  private async load(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Promise<THREE.Mesh> {
    const draco = new DRACOLoader().setDecoderPath('map3d/draco/');
    const gltfP = new GLTFLoader().setDRACOLoader(draco).loadAsync('map3d/polari.glb?' + ASSETS, (e) => {
      if (e.total) this.progress.set(Math.min(70, Math.round((e.loaded / e.total) * 70)));
    });
    const [gltf, meta, places, heights, trees, seabed, features] = await Promise.all([
      gltfP,
      fetch('map3d/meta.json?' + ASSETS).then((r) => r.json() as Promise<Meta>),
      fetch('map3d/places.json?' + ASSETS).then((r) => r.json() as Promise<Record<string, [number, number, number]>>),
      fetch('map3d/heights.bin?' + ASSETS).then((r) => r.arrayBuffer()),
      fetch('map3d/trees.bin?' + ASSETS).then((r) => r.arrayBuffer()),
      new THREE.TextureLoader().loadAsync('map3d/seabed.png?' + ASSETS),
      fetch('map3d/features.json?' + ASSETS).then((r) => r.json() as Promise<Features>),
    ]);
    this.progress.set(80);

    let terrain: THREE.Mesh | undefined;
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) terrain = o as THREE.Mesh; });
    if (!terrain) throw new Error('no terrain');
    const mat = terrain.material as THREE.MeshStandardMaterial;
    if (mat.map) { mat.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); mat.map.colorSpace = THREE.SRGBColorSpace; }
    // matte ground: a glossy roughness map makes rivers glare white at grazing angles
    mat.roughnessMap = null;
    mat.metalnessMap = null;
    mat.roughness = 0.95;
    mat.metalness = 0;
    mat.needsUpdate = true;
    this.terrainMat = mat;
    this.textures.relief = mat.map ?? undefined;
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    scene.add(gltf.scene);

    seabed.flipY = false;
    seabed.colorSpace = THREE.NoColorSpace;
    seabed.minFilter = THREE.LinearFilter;
    seabed.generateMipmaps = false;
    seabed.needsUpdate = true;
    const water = makeWater(seabed);
    const fog = scene.fog as THREE.Fog, wu = (water.material as THREE.ShaderMaterial).uniforms;
    wu['fogColor'].value.copy(fog.color); wu['fogNear'].value = fog.near; wu['fogFar'].value = fog.far;
    scene.add(water);

    const hf = new HeightField(new Uint16Array(heights), meta.hw, meta.hh, meta.hmin, meta.hmax, W_UNITS, D_UNITS);
    hf.wet = (x, z) => features.tarns.some((t) => inside(t.pts, x, z));
    const cleared = this.addPlaces(scene, places, hf, features);
    scene.add(makeTarns(features.tarns));
    this.routeGroup = makeRoutes(features.roads, hf);
    this.routeGroup.visible = this.roads();
    scene.add(this.routeGroup);
    // a windmill on every hillock of the Мельницы
    const mills = mergeGeometries(features.mills.map(([mx, mz], i) =>
      windmill(1.6).rotateY(i * 2.1).translate(mx, hf.at(mx, mz) - .002, mz)))!;
    const millMesh = new THREE.Mesh(mills, new THREE.MeshLambertMaterial({ vertexColors: true }));
    millMesh.castShadow = millMesh.receiveShadow = true;
    scene.add(millMesh);
    for (const [mx, mz] of features.mills) cleared.push([mx, mz, .025]);
    this.progress.set(90);
    this.forestGroup = makeForests(trees, (x, z) => cleared.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < r * r));
    this.forestGroup.visible = this.forests();
    scene.add(this.forestGroup);
    this.progress.set(100);
    return water;
  }

  /** Buildings and labels for every mapped place; returns circles where trees must not grow. */
  private addPlaces(scene: THREE.Scene, places: Record<string, [number, number, number]>, hf: HeightField, f: Features): [number, number, number][] {
    const layer = this.labelLayer().nativeElement;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const kinds = this.data.extra().map.places;
    const cleared: [number, number, number][] = [];
    for (const [key, [x, z]] of Object.entries(places)) {
      const type = settlementOf(key, kinds[key]?.kind ?? 'site');
      const angle = key === f.dam.key ? f.dam.angle : f.bridges[key];
      const geo = buildSettlement(type, key, x, z, hf, z / D_UNITS + 0.5, { angle, pit: f.pits[key] });
      if (geo) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, 0, z);
        m.castShadow = true;
        m.receiveShadow = true;
        scene.add(m);
      }
      const clear = CLEARING[type];
      if (clear) cleared.push([x, z, clear]);

      const el = document.createElement('a');
      const extra = EXTRA[key], link = extra ? extra.link : this.data.get(key) ? key : undefined;
      el.textContent = extra?.title ?? this.data.title(key);
      el.className = 't-' + type;
      el.draggable = false;
      if (link) {
        el.href = '#/' + link;
        el.addEventListener('click', (e) => { e.preventDefault(); this.router.navigateByUrl('/' + link); });
      }
      layer.appendChild(el);
      const cfg = LABEL[type] ?? DEFAULT_LABEL;
      this.items.push({ el, type, rank: cfg.rank, w: 0, pos: new THREE.Vector3(x, Math.max(hf.at(x, z), 0) + cfg.lift, z) });
    }
    this.items.sort((a, b) => a.rank - b.rank);
    return cleared;
  }

  /** Project labels to the screen; higher-ranked labels claim their box first so none overlap. */
  private placeLabels(camera: THREE.Camera, w: number, h: number, v: THREE.Vector3): void {
    const taken: number[][] = [];
    for (const l of this.items) {
      v.copy(l.pos).project(camera);
      const cfg = LABEL[l.type] ?? DEFAULT_LABEL;
      const dist = camera.position.distanceTo(l.pos);
      let hide = v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05 || dist > cfg.far || (l.type === 'land' && dist < 2.5);
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h;
      if (!hide) {
        if (!l.w) l.w = l.el.offsetWidth || 60;
        const box = [sx - l.w / 2 - 3, sy - 21, sx + l.w / 2 + 3, sy + 1];
        hide = taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        if (!hide) taken.push(box);
      }
      l.el.classList.toggle('hidden', hide);
      if (!hide) l.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }
  }

  private readonly VIEWS: Record<string, [number[], number[]]> = {
    overview: [[0, 15.5, 17.5], [0, 0, 0.6]],
    north: [[6.5, 3.6, -0.2], [5.5, 0.5, -7.4]],
    lake: [[-8.5, 3.0, -0.4], [-3.6, 0, -3.9]],
    capital: [[3.2, 1.3, 0.4], [2.0, 0.05, -1.6]],
    south: [[1.5, 3.4, 15.5], [-1.5, 0.6, 8.8]],
    beyond: [[9.0, 3.2, -4.6], [10.2, 0.3, -9.2]],
    steppe: [[-3.0, 1.5, 4.7], [-3.84, 0.05, 2.65]],
    coast: [[2.6, 1.3, 3.3], [1.4, 0.02, 2.0]],
    // close-ups for deep links
    erroubek: [[-0.55, 0.55, -0.75], [-1.03, 0.05, -1.18]],
    mills: [[-5.7, 1.3, 0.5], [-7.0, 0.1, -0.7]],
    soft: [[8.9, 2.2, -7.0], [8.9, 0.1, -9.4]],
    gift: [[-3.7, 0.75, -4.4], [-4.17, 0.02, -5.06]],
    winter: [[4.0, 0.95, -7.45], [4.62, 0.25, -8.2]],
  };

  private setView(name: string, now = false): void {
    const [pos, tgt] = this.VIEWS[name];
    const to = new THREE.Vector3(...pos), tTo = new THREE.Vector3(...tgt);
    if (now || !this.camera || !this.controls) {
      this.camera?.position.copy(to);
      this.controls?.target.copy(tTo);
      return;
    }
    this.flight = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo, t: 0 };
  }

  protected fly(name: string): void { this.spin.set(false); if (this.controls) this.controls.autoRotate = false; this.setView(name); }
  protected toggleSpin(): void { this.spin.set(!this.spin()); if (this.controls) this.controls.autoRotate = this.spin(); }
  protected toggleForests(): void { this.forests.set(!this.forests()); if (this.forestGroup) this.forestGroup.visible = this.forests(); }
  protected toggleRoads(): void { this.roads.set(!this.roads()); if (this.routeGroup) this.routeGroup.visible = this.roads(); }

  /** Swap the synthesised relief colours for the original painted map draped over the terrain. */
  protected togglePainted(): void {
    const on = !this.painted();
    this.painted.set(on);
    const mat = this.terrainMat;
    if (!mat) return;
    if (on && !this.textures.painted) {
      new THREE.TextureLoader().load('img/map-polari.jpg', (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.flipY = false;
        t.anisotropy = this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
        this.textures.painted = t;
        if (this.painted()) { mat.map = t; mat.needsUpdate = true; }
      });
      return;
    }
    mat.map = (on ? this.textures.painted : this.textures.relief) ?? null;
    mat.needsUpdate = true;
  }
}
