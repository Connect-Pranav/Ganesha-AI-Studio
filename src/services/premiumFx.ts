// Premium interaction layer: 3D tilt + light sheen that follows the pointer on cards, smooth
// view transitions. One delegated listener, rAF-throttled; off for touch, Minimal effects and
// reduced motion.
const TILT_SEL = '.card, .stat, .rf-sheet, .sd-item, .cx-sub-card';
const MAX_DEG = 4;

function enabled(): boolean {
  const app = document.querySelector('.app');
  if (!app || app.getAttribute('data-fx') === 'minimal') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return window.matchMedia('(pointer: fine)').matches;
}

export function startPremiumFx() {
  let active: HTMLElement | null = null;
  let frame = 0;
  let last: PointerEvent | null = null;
  const reset = (el: HTMLElement | null) => {
    if (!el) return;
    el.style.removeProperty('--rx');
    el.style.removeProperty('--ry');
    el.classList.remove('fx-tilting');
  };
  const apply = () => {
    frame = 0;
    const e = last;
    if (!e) return;
    const t = e.target as HTMLElement | null;
    // Never tilt behind an open dialog (dialogs inside a transformed card would lose fixed positioning).
    const target = t && !t.closest('.modal-scrim, .modal, .drawer-scrim, input, textarea, select') && !document.querySelector('.modal-scrim') ? t.closest<HTMLElement>(TILT_SEL) : null;
    if (target !== active) {
      reset(active);
      active = target;
    }
    if (!active || !enabled()) return;
    const r = active.getBoundingClientRect();
    // Big panels tilt less so text stays easy to read.
    const scale = Math.min(1, 520 / Math.max(r.width, r.height));
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    active.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    active.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    active.style.setProperty('--rx', `${((0.5 - py) * MAX_DEG * 2 * scale).toFixed(2)}deg`);
    active.style.setProperty('--ry', `${((px - 0.5) * MAX_DEG * 2 * scale).toFixed(2)}deg`);
    active.classList.add('fx-tilting');
  };
  document.addEventListener(
    'pointermove',
    (e) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    },
    { passive: true },
  );
  document.addEventListener('pointerleave', () => {
    reset(active);
    active = null;
  });
}

// Where the last click/tap happened: page changes open as a circle from that point.
let origin: { x: number; y: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => (origin = { x: e.clientX, y: e.clientY }), { passive: true, capture: true });
}

/** Page change as a circular reveal from the click point (View Transitions); cross-fade fallback. */
export function withViewTransition(fn: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  const app = document.querySelector('.app');
  if (!d.startViewTransition || app?.getAttribute('data-fx') === 'minimal' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return fn();
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  origin = null;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  document.documentElement.classList.add('vt-reveal');
  const t = d.startViewTransition(() => fn());
  t.ready
    .then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' },
      ),
    )
    .catch(() => undefined);
  (t as unknown as { finished?: Promise<void> }).finished?.finally(() => document.documentElement.classList.remove('vt-reveal'));
}
