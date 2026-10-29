// Voyage route: steps drawn as stations on a gently curved route. The travelled part of the
// route draws itself in and a star marker glides along it to the current station, turning with
// the curve. No animation library: requestAnimationFrame + SVG getPointAtLength. Off (jumps to the
// end state) for Minimal effects and reduced motion.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type StationState = 'done' | 'current' | 'blocked' | 'todo';
export interface Station { key: string; label: string; sub?: string; state: StationState; title?: string }

const H = 76; // drawing height in px
const PAD_X = 22;
const ease = (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2); // power3-ish in-out

function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.querySelector('.app')?.getAttribute('data-fx') === 'minimal') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Points along the width with a soft wave, then a smooth path through them. */
function geometry(width: number, n: number) {
  const usable = Math.max(1, width - PAD_X * 2);
  const pts = Array.from({ length: n }, (_, i) => {
    const x = PAD_X + (n === 1 ? usable / 2 : (usable * i) / (n - 1));
    const y = H / 2 + 8 + Math.sin(i * 1.3 + 0.6) * 9;
    return { x, y };
  });
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const cx = (b.x - a.x) * 0.45;
    d += ` C${a.x + cx},${a.y} ${b.x - cx},${b.y} ${b.x},${b.y}`;
  }
  return { pts, d };
}

export function VoyageRoute({ stations, label }: { stations: Station[]; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<SVGPathElement>(null);
  const done = useRef<SVGPathElement>(null);
  const boat = useRef<SVGGElement>(null);
  const star = useRef<SVGPathElement>(null);
  const progress = useRef(0); // length travelled so far, kept between re-renders
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const n = stations.length;
  const allDone = n > 0 && stations.every((s) => s.state === 'done');
  const firstOpen = stations.findIndex((s) => s.state !== 'done');
  const target = allDone ? n - 1 : Math.max(0, firstOpen);
  const geo = width > 0 && n > 0 ? geometry(width, n) : null;
  const dense = n > 0 && width / n < 84; // too tight for every label: show only the current one

  useEffect(() => {
    const path = base.current;
    if (!geo || !path) return;
    const total = path.getTotalLength();
    // Length along the path to the target station (stations are segment ends).
    let to = 0;
    if (target > 0) {
      const seg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const cut = geo.d.split(' C').slice(0, target + 1).join(' C');
      seg.setAttribute('d', cut);
      to = seg.getTotalLength();
    }
    const place = (L: number) => {
      const p = path.getPointAtLength(L);
      const q = path.getPointAtLength(Math.min(total, L + 2));
      const r = path.getPointAtLength(Math.max(0, L - 2));
      const ang = (Math.atan2(q.y - r.y, q.x - r.x) * 180) / Math.PI;
      // The badge stays upright; the star inside turns with the route.
      boat.current?.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
      star.current?.setAttribute('transform', `rotate(${(ang + 45).toFixed(1)})`);
      done.current?.setAttribute('stroke-dasharray', `${L.toFixed(1)} ${total.toFixed(1)}`);
    };
    const from = Math.min(progress.current, to);
    if (!motionAllowed() || from === to) {
      progress.current = to;
      place(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 1250;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const L = from + (to - from) * ease(k);
      progress.current = L;
      place(L);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    place(from);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [geo?.d, target]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrap} className="voyage" role="img" aria-label={label}>
      {geo && (
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="voyage-svg" aria-hidden="true">
          <path ref={base} d={geo.d} className="voyage-base" />
          <path ref={done} d={geo.d} className="voyage-done" strokeDasharray={`0 ${width * 2}`} />
          {geo.pts.map((p, i) => (
            <g key={stations[i].key} className={`voyage-stn st-${stations[i].state}`} transform={`translate(${p.x},${p.y})`}>
              <circle r={i === target && !allDone ? 9 : 7} />
              {stations[i].state === 'done' && <path d="M-3.2 0.2l2.2 2.2 4.2-4.4" className="voyage-tick" />}
            </g>
          ))}
          <g ref={boat} className="voyage-boat">
            <g transform="translate(0,-20)">
              <rect x={-11} y={-11} width={22} height={22} rx={7} />
              <path ref={star} d="M0 -6.5 L1.8 -1.8 L6.5 0 L1.8 1.8 L0 6.5 L-1.8 1.8 L-6.5 0 L-1.8 -1.8 Z" />
            </g>
          </g>
        </svg>
      )}
      {geo && (
        <ol className="voyage-labels" aria-hidden="true">
          {geo.pts.map((p, i) => (dense && i !== target ? null :
            <li key={stations[i].key} className={`st-${stations[i].state}`} style={{ left: p.x, top: p.y + 14 }} title={stations[i].title}>
              <span>{stations[i].label}</span>
              {stations[i].sub && <small>{stations[i].sub}</small>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
