// Pure three.js scene for the Ganesha AI Studio universe. No React here —
// Universe3D.tsx owns the DOM overlay and passes data in / receives picks out.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type NodeKind = 'core' | 'brand' | 'agent';
export interface SceneNode {
  id: string; // agent id, brand id or 'core'
  kind: NodeKind;
  label: string;
  sub?: string;
  color: string;
  team?: string;
  status?: 'idle' | 'working' | 'approval' | 'error';
}
export interface SceneLink {
  id: string;
  from: string; // node id
  to: string;
  status: 'running' | 'approval_required' | 'failed' | 'pending' | 'completed';
}
export interface SceneInput {
  nodes: SceneNode[];
  links: SceneLink[];
}
export interface SceneCallbacks {
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

const STATUS_COLOR = { working: '#38bdf8', approval: '#fbbf24', error: '#f87171' } as const;
const LINK_COLOR = { running: '#38bdf8', approval_required: '#fbbf24', failed: '#f87171', pending: '#6b74a8', completed: '#34d399' } as const;

interface Body {
  node: SceneNode;
  mesh: THREE.Mesh;
  halo?: THREE.Mesh;
  orbit: { center: () => THREE.Vector3; radius: number; speed: number; phase: number; tilt: number };
  pos: THREE.Vector3;
  size: number;
  labelEl: HTMLDivElement;
}

export class UniverseScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private bodies = new Map<string, Body>();
  private linkObjs: { line: THREE.Line; pulse: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; link: SceneLink; t: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();
  private raf = 0;
  private hovered: string | null = null;
  private selected: string | null = null;
  private flyTo: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
  private downAt: { x: number; y: number } | null = null;
  private disposed = false;
  private readonly reduced: boolean;
  private readonly mobile: boolean;

  constructor(
    private container: HTMLElement,
    private labelLayer: HTMLElement,
    private cb: SceneCallbacks,
  ) {
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.mobile = container.clientWidth < 700;

    // Transparent canvas: the cosmic background (Milky Way, stars, meteors) shows through.
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.mobile, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1.5 : 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = !this.mobile;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog('#070b1f', 38, 80);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, this.mobile ? 26 : 17, this.mobile ? 34 : 27);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 55;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.autoRotate = !this.reduced;
    this.controls.autoRotateSpeed = 0.35;

    this.buildEnvironment();
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loop();
  }

  /* ---------- static environment ---------- */
  private buildEnvironment() {
    this.scene.add(new THREE.HemisphereLight('#c7d2ff', '#2a1850', 1.5));
    const sun = new THREE.DirectionalLight('#e0e7ff', 2.0);
    sun.position.set(12, 22, 10);
    sun.castShadow = !this.mobile;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    this.scene.add(sun);

    // Ground disc that catches soft shadows
    const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3.2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Orbit guide rings
    for (const [r, o] of [
      [3.4, 0.35],
      [10, 0.28],
      [15.5, 0.18],
    ] as const) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.015, r + 0.015, 160),
        new THREE.MeshBasicMaterial({ color: '#8b9cff', transparent: true, opacity: o, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(ring);
    }

    // Floating dust for depth
    const n = this.mobile ? 160 : 380;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 6 + Math.random() * 26;
      const a = Math.random() * Math.PI * 2;
      pts.set([Math.cos(a) * r, -2 + Math.random() * 12, Math.sin(a) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#c4b5fd', size: 0.08, transparent: true, opacity: 0.7 })));
  }

  /* ---------- data → bodies ---------- */
  setData(input: SceneInput) {
    // Remove previous bodies and links
    for (const b of this.bodies.values()) {
      this.scene.remove(b.mesh);
      if (b.halo) this.scene.remove(b.halo);
      b.labelEl.remove();
    }
    this.bodies.clear();
    for (const l of this.linkObjs) {
      this.scene.remove(l.line);
      this.scene.remove(l.pulse);
    }
    this.linkObjs = [];

    const origin = () => new THREE.Vector3(0, 0, 0);
    const brands = input.nodes.filter((n) => n.kind === 'brand');
    const brandIndex = new Map(brands.map((b, i) => [b.id, i]));

    const addBody = (node: SceneNode, size: number, orbit: Body['orbit'], emissive = 0.08) => {
      const geo = node.kind === 'core' ? new THREE.IcosahedronGeometry(size, 3) : new THREE.SphereGeometry(size, node.kind === 'agent' ? 20 : 40, node.kind === 'agent' ? 16 : 28);
      const color = new THREE.Color(node.status && node.status !== 'idle' ? STATUS_COLOR[node.status] : node.color);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: node.kind === 'core' ? 0.25 : 0.55,
        metalness: node.kind === 'core' ? 0.35 : 0.08,
        emissive: color,
        emissiveIntensity: emissive,
        flatShading: node.kind === 'core',
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !this.mobile;
      mesh.userData.id = node.id;
      this.scene.add(mesh);

      let halo: THREE.Mesh | undefined;
      if (node.kind !== 'agent' || (node.status && node.status !== 'idle')) {
        halo = new THREE.Mesh(
          new THREE.SphereGeometry(size * (node.kind === 'agent' ? 1.9 : 1.45), 24, 16),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: node.kind === 'agent' ? 0.22 : 0.1, depthWrite: false }),
        );
        this.scene.add(halo);
      }

      const labelEl = document.createElement('div');
      labelEl.className = `u-label u-label-${node.kind}${node.status && node.status !== 'idle' ? ` u-label-${node.status}` : ''}`;
      labelEl.textContent = node.label;
      this.labelLayer.appendChild(labelEl);

      this.bodies.set(node.id, { node, mesh, halo, orbit, pos: new THREE.Vector3(), size, labelEl });
    };

    for (const node of input.nodes) {
      if (node.kind === 'core') {
        addBody(node, 1.5, { center: origin, radius: 0, speed: 0, phase: 0, tilt: 0 }, 0.18);
      } else if (node.kind === 'brand') {
        const i = brandIndex.get(node.id)!;
        addBody(node, 1.25, { center: origin, radius: 10, speed: 0.035, phase: (i / brands.length) * Math.PI * 2 + 0.4, tilt: 0 }, 0.1);
      }
    }
    const byTeam = new Map<string, SceneNode[]>();
    for (const n of input.nodes.filter((x) => x.kind === 'agent')) {
      const k = n.team ?? 'ops';
      byTeam.set(k, [...(byTeam.get(k) ?? []), n]);
    }
    for (const [team, members] of byTeam) {
      members.forEach((node, i) => {
        const phase = (i / members.length) * Math.PI * 2;
        if (team === 'master') {
          addBody(node, 0.42, { center: origin, radius: 3.4, speed: 0.16, phase, tilt: 0.12 });
        } else if (team === 'ops') {
          addBody(node, 0.42, { center: origin, radius: 15.5, speed: 0.018, phase: phase + 0.25, tilt: 0.05 });
        } else {
          const centerBody = () => this.bodies.get(team)?.pos ?? origin();
          addBody(node, 0.3, { center: centerBody, radius: 2.5, speed: 0.22, phase, tilt: 0.35 });
        }
      });
    }

    // Pipelines: arcs from the orchestrator core to the brand world (or an agent)
    for (const link of input.links) {
      if (!this.bodies.has(link.from) || !this.bodies.has(link.to)) continue;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
      const color = LINK_COLOR[link.status];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: link.status === 'completed' ? 0.25 : 0.7 }),
      );
      const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color }));
      pulse.visible = link.status === 'running' || link.status === 'approval_required';
      this.scene.add(line, pulse);
      this.linkObjs.push({ line, pulse, curve, link, t: Math.random() });
    }
  }

  /* ---------- loop ---------- */
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    const motion = this.reduced ? 0 : 1;

    // Positions: core + brands first (agents orbit them)
    const order = [...this.bodies.values()].sort((a, b) => rank(a.node.kind) - rank(b.node.kind));
    for (const b of order) {
      const o = b.orbit;
      const a = o.phase + time * o.speed * motion;
      const c = o.center();
      b.pos.set(c.x + Math.cos(a) * o.radius, c.y + Math.sin(a * 2) * o.tilt + (b.node.kind === 'brand' ? 0.6 : 0), c.z + Math.sin(a) * o.radius);
      const hover = this.hovered === b.node.id || this.selected === b.node.id;
      const s = hover ? 1.25 : 1;
      b.mesh.position.copy(b.pos);
      b.mesh.scale.lerp(new THREE.Vector3(s, s, s), 0.2);
      if (b.node.kind === 'core') {
        b.mesh.rotation.y += dt * 0.3 * motion;
        b.mesh.rotation.x += dt * 0.12 * motion;
      } else b.mesh.rotation.y += dt * 0.4 * motion;
      if (b.halo) {
        b.halo.position.copy(b.pos);
        const pulse = b.node.status === 'working' || b.node.kind === 'core' ? 1 + Math.sin(time * 3) * 0.08 * motion : 1;
        b.halo.scale.setScalar(pulse);
      }
    }

    for (const l of this.linkObjs) {
      const a = this.bodies.get(l.link.from)!.pos;
      const z = this.bodies.get(l.link.to)!.pos;
      const mid = a.clone().add(z).multiplyScalar(0.5);
      mid.y += 3 + a.distanceTo(z) * 0.12;
      l.curve.v0.copy(a);
      l.curve.v1.copy(mid);
      l.curve.v2.copy(z);
      (l.line.geometry as THREE.BufferGeometry).setFromPoints(l.curve.getPoints(40));
      if (l.pulse.visible) {
        l.t = l.link.status === 'approval_required' ? 0.97 : (l.t + dt * 0.35 * Math.max(motion, 0.0001)) % 1;
        l.pulse.position.copy(l.curve.getPoint(this.reduced ? 0.6 : l.t));
        if (l.link.status === 'approval_required') l.pulse.scale.setScalar(1 + Math.sin(time * 4) * 0.25 * motion);
      }
    }

    if (this.flyTo) {
      this.flyTo.t = Math.min(1, this.flyTo.t + dt * 1.6);
      const e = easeInOut(this.flyTo.t);
      this.camera.position.lerpVectors(this.flyTo.from, this.flyTo.to, e);
      this.controls.target.lerpVectors(this.flyTo.tFrom, this.flyTo.tTo, e);
      if (this.flyTo.t >= 1) this.flyTo = null;
    } else if (this.selected) {
      // Keep following a moving selection
      const b = this.bodies.get(this.selected);
      if (b) this.controls.target.lerp(b.pos, 0.08);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  };

  private updateLabels() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    const camPos = this.camera.position;
    for (const b of this.bodies.values()) {
      v.copy(b.pos);
      v.y += b.size + (b.node.kind === 'agent' ? 0.35 : b.node.kind === 'brand' ? 1.1 : 0.45);
      v.project(this.camera);
      const visible = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
      const dist = camPos.distanceTo(b.pos);
      // Agent names appear when zoomed in, or when the agent is busy / hovered / selected.
      const busy = b.node.status && b.node.status !== 'idle';
      const show =
        visible &&
        (b.node.kind !== 'agent' || dist < (this.mobile ? 14 : 20) || busy || this.hovered === b.node.id || this.selected === b.node.id);
      b.labelEl.style.display = show ? 'block' : 'none';
      if (!show) continue;
      b.labelEl.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      b.labelEl.style.opacity = String(Math.max(0.35, Math.min(1, 1.6 - dist / 40)));
      b.labelEl.classList.toggle('is-active', this.hovered === b.node.id || this.selected === b.node.id);
    }
  }

  /* ---------- picking ---------- */
  private pick(ev: PointerEvent): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.bodies.values()].map((b) => b.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return (hit?.object.userData.id as string | undefined) ?? null;
  }
  private onPointerMove = (ev: PointerEvent) => {
    const id = this.pick(ev);
    if (id !== this.hovered) {
      this.hovered = id;
      this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
      this.cb.onHover(id);
    }
  };
  private onPointerDown = (ev: PointerEvent) => {
    this.downAt = { x: ev.clientX, y: ev.clientY };
    this.controls.autoRotate = false;
  };
  private onPointerUp = (ev: PointerEvent) => {
    if (!this.downAt) return;
    const moved = Math.hypot(ev.clientX - this.downAt.x, ev.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 6) return; // it was a drag
    this.select(this.pick(ev));
  };
  private onPointerLeave = () => {
    this.hovered = null;
    this.cb.onHover(null);
  };
  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else {
      this.clock.getDelta();
      this.loop();
    }
  };

  /** Shift the rendered centre so the selection isn't hidden behind the details panel. */
  private applyViewOffset() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!this.selected || !w || !h) {
      this.camera.clearViewOffset();
      return;
    }
    if (w < 860) this.camera.setViewOffset(w, h, 0, Math.round(h * 0.26), w, h);
    else this.camera.setViewOffset(w, h, Math.round(Math.min(380, w * 0.4) / 2), 0, w, h);
  }

  select(id: string | null) {
    this.selected = id;
    this.applyViewOffset();
    this.cb.onSelect(id);
    const b = id ? this.bodies.get(id) : null;
    const target = b ? b.pos.clone() : new THREE.Vector3();
    const dist = !b ? (this.mobile ? 40 : 32) : b.node.kind === 'agent' ? (this.mobile ? 9 : 7) : b.node.kind === 'brand' ? (this.mobile ? 15 : 11) : this.mobile ? 22 : 14;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!b) dir.set(0, 0.55, 0.83).normalize();
    this.flyTo = {
      from: this.camera.position.clone(),
      to: target.clone().add(dir.multiplyScalar(dist)),
      tFrom: this.controls.target.clone(),
      tTo: target,
      t: this.reduced ? 1 : 0,
    };
  }

  resetView() {
    this.select(null);
    this.controls.autoRotate = !this.reduced;
  }

  resize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.applyViewOffset();
    this.camera.updateProjectionMatrix();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const b of this.bodies.values()) b.labelEl.remove();
    this.renderer.dispose();
    el.remove();
  }
}

const rank = (k: NodeKind) => (k === 'core' ? 0 : k === 'brand' ? 1 : 2);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
