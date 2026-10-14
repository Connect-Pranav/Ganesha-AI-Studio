// Cosmic environment behind the whole studio: layered starfield with twinkle and parallax, a soft
// Milky Way band and nebulae (CSS), occasional meteors, rare distant lightning inside storm clouds,
// and two small orbiting planets. Decorative only (aria-hidden), never covers controls.
//
// Performance: one 2D canvas, frame-capped (30 fps Balanced, 60 fps Full), paused when the tab is
// hidden, static single frame in Minimal or when the OS asks for reduced motion. No audio.
// Accessibility: lightning is a single soft local glow (≤ 1 per ~20 s), far below the WCAG 2.3.1
// three-flashes-per-second limit, and it is disabled in Minimal / reduced-motion modes.
import { useEffect, useRef } from 'react';

export type CosmicFx = 'full' | 'balanced' | 'minimal';
export const FX_KEY = 'gas.cosmicFx';
export const FX_EVENT = 'ganesha:cosmic-fx';

export function readFx(): CosmicFx {
  try {
    const v = localStorage.getItem(FX_KEY);
    return v === 'full' || v === 'minimal' || v === 'balanced' ? v : 'balanced';
  } catch {
    return 'balanced';
  }
}
export function writeFx(v: CosmicFx) {
  try {
    localStorage.setItem(FX_KEY, v);
  } catch {
    /* storage blocked: setting lasts for this page view */
  }
  window.dispatchEvent(new CustomEvent(FX_EVENT, { detail: v }));
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  ph: number;
  layer: number;
  hue: number;
}
interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  len: number;
}
interface Bolt {
  pts: [number, number][];
  t: number;
  cx: number;
  cy: number;
}

/** Tunables per mode — exported for tests. */
export const FX_PROFILE = {
  full: { stars: 520, fps: 60, meteorGap: [3500, 9000], lightningGap: [16000, 30000], parallax: 18, twinkle: true },
  balanced: { stars: 320, fps: 30, meteorGap: [7000, 16000], lightningGap: [24000, 45000], parallax: 10, twinkle: true },
  minimal: { stars: 180, fps: 0, meteorGap: null, lightningGap: null, parallax: 0, twinkle: false },
} as const;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function CosmicBackground({ fx }: { fx: CosmicFx }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const mode: CosmicFx = reduced ? 'minimal' : fx;
    const prof = FX_PROFILE[mode];
    root.current!.dataset.mode = mode;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    const meteors: Meteor[] = [];
    let bolt: Bolt | null = null;
    let raf = 0;
    let last = 0;
    let nextMeteor = performance.now() + (prof.meteorGap ? rand(1500, prof.meteorGap[0]) : Infinity);
    let nextBolt = performance.now() + (prof.lightningGap ? rand(8000, prof.lightningGap[0]) : Infinity);
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;

    const build = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(prof.stars * Math.min(1.4, (w * h) / (1440 * 900)));
      stars = Array.from({ length: n }, () => {
        const layer = Math.random() < 0.6 ? 0 : Math.random() < 0.75 ? 1 : 2;
        // Bias some stars toward the diagonal galactic band for a Milky Way feel.
        let x = Math.random() * w;
        let y = Math.random() * h;
        if (Math.random() < 0.35) {
          const t = Math.random();
          x = t * w;
          y = h * 0.85 - t * h * 0.7 + rand(-h * 0.12, h * 0.12);
        }
        return { x, y, r: layer === 2 ? rand(1.1, 1.8) : layer === 1 ? rand(0.7, 1.2) : rand(0.3, 0.8), a: rand(0.35, 1), tw: rand(0.4, 1.6), ph: rand(0, Math.PI * 2), layer, hue: Math.random() < 0.15 ? rand(190, 280) : 230 };
      });
    };

    const spawnMeteor = () => {
      const fromLeft = Math.random() < 0.5;
      const speed = rand(0.6, 1.2);
      const ang = fromLeft ? rand(0.35, 0.65) : Math.PI - rand(0.35, 0.65);
      meteors.push({ x: fromLeft ? rand(-50, w * 0.6) : rand(w * 0.4, w + 50), y: rand(-40, h * 0.35), vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 0, max: rand(700, 1300), len: rand(90, 180) });
    };

    const spawnBolt = () => {
      // Distant storm regions sit at fixed places (matching the CSS storm clouds).
      const regions = [
        [0.82, 0.18],
        [0.14, 0.78],
      ];
      const ri = Math.floor(Math.random() * regions.length);
      const [rx, ry] = regions[ri];
      const cx = rx * w;
      const cy = ry * h;
      const pts: [number, number][] = [[cx + rand(-30, 30), cy - 40]];
      for (let i = 0; i < 6; i++) {
        const [lx, ly] = pts[pts.length - 1];
        pts.push([lx + rand(-14, 14), ly + rand(10, 18)]);
      }
      bolt = { pts, t: 0, cx, cy };
      const el = root.current?.querySelector<HTMLElement>(ri === 0 ? '.cz-storm-a' : '.cz-storm-b');
      if (el) {
        el.classList.remove('cz-flash');
        void el.offsetWidth;
        el.classList.add('cz-flash');
      }
    };

    const draw = (now: number, dt: number) => {
      ctx.clearRect(0, 0, w, h);
      px += (tx - px) * 0.05;
      py += (ty - py) * 0.05;
      for (const s of stars) {
        const depth = (s.layer + 1) / 3;
        const ox = px * prof.parallax * depth;
        const oy = py * prof.parallax * depth;
        const a = prof.twinkle ? s.a * (0.65 + 0.35 * Math.sin(now * 0.001 * s.tw + s.ph)) : s.a;
        ctx.globalAlpha = a;
        ctx.fillStyle = `hsl(${s.hue} 90% ${s.layer === 2 ? 92 : 85}%)`;
        ctx.beginPath();
        ctx.arc(s.x + ox, s.y + oy, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.layer === 2) {
          ctx.globalAlpha = a * 0.18;
          ctx.beginPath();
          ctx.arc(s.x + ox, s.y + oy, s.r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Meteors: short-lived streaks with fading trails.
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const k = m.life / m.max;
        if (k >= 1) {
          meteors.splice(i, 1);
          continue;
        }
        const alpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
        const sp = Math.hypot(m.vx, m.vy);
        const tx2 = m.x - (m.vx / sp) * m.len;
        const ty2 = m.y - (m.vy / sp) * m.len;
        const g = ctx.createLinearGradient(m.x, m.y, tx2, ty2);
        g.addColorStop(0, `rgba(235,240,255,${0.9 * alpha})`);
        g.addColorStop(0.3, `rgba(165,180,252,${0.45 * alpha})`);
        g.addColorStop(1, 'rgba(165,180,252,0)');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tx2, ty2);
        ctx.stroke();
      }
      // Lightning: one faint jagged bolt inside a distant cloud, ~220 ms, soft fade.
      if (bolt) {
        bolt.t += dt;
        const k = bolt.t / 220;
        if (k >= 1) bolt = null;
        else {
          ctx.globalAlpha = (1 - k) * 0.55;
          ctx.strokeStyle = 'rgba(219,234,254,1)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const minDt = 1000 / prof.fps;
      if (now - last < minDt) return;
      const dt = Math.min(64, last ? now - last : 16);
      last = now;
      if (prof.meteorGap && now >= nextMeteor) {
        spawnMeteor();
        nextMeteor = now + rand(prof.meteorGap[0], prof.meteorGap[1]);
      }
      if (prof.lightningGap && now >= nextBolt) {
        spawnBolt();
        nextBolt = now + rand(prof.lightningGap[0], prof.lightningGap[1]);
      }
      draw(now, dt);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (prof.fps > 0 && !document.hidden) raf = requestAnimationFrame(frame);
      else draw(performance.now(), 16);
    };
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    let resizeT = 0;
    const onResize = () => {
      clearTimeout(resizeT);
      resizeT = window.setTimeout(() => (build(), start()), 150);
    };
    let moveRaf = 0;
    const onMove = (e: PointerEvent) => {
      if (!prof.parallax || moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        tx = e.clientX / w - 0.5;
        ty = e.clientY / h - 0.5;
        root.current?.style.setProperty('--px', tx.toFixed(3));
        root.current?.style.setProperty('--py', ty.toFixed(3));
      });
    };

    build();
    start();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(moveRaf);
      clearTimeout(resizeT);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
    };
  }, [fx]);

  return (
    <div ref={root} className="cz-root" data-fx={fx} aria-hidden="true">
      <div className="cz-deep" />
      <div className="cz-milkyway" />
      <div className="cz-nebula cz-n1" />
      <div className="cz-nebula cz-n2" />
      <div className="cz-nebula cz-n3" />
      <div className="cz-storm cz-storm-a" />
      <div className="cz-storm cz-storm-b" />
      <canvas ref={canvas} className="cz-canvas" />
      <div className="cz-planet cz-p1">
        <span className="cz-orbit" />
      </div>
      <div className="cz-planet cz-p2" />
      <div className="cz-vignette" />
    </div>
  );
}
