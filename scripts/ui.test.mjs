// UI design-token checks: WCAG text contrast of the cosmic theme, computed from src/styles.css.
// Translucent surfaces are composited over the darkest and lightest backdrop they can sit on
// (deep space, and a bright nebula/Milky Way region) so the worst case is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const vars = Object.fromEntries([...rootBlock.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const resolve = (v) => {
  let x = v;
  for (let i = 0; i < 5 && /var\(--/.test(x); i++) x = x.replace(/var\(--([a-z0-9-]+)\)/g, (_, n) => vars[n]);
  return x;
};
function parse(c) {
  c = resolve(c);
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`cannot parse colour ${c}`);
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// Worst-case backdrops behind glass panels.
const DARK = parse('#03050f');
const BRIGHT = [76, 60, 150, 1]; // a bright violet nebula / Milky Way patch (brighter than the CSS layers produce)
const panelOn = (bg) => over(parse('var(--surface)'), bg);

test('theme is dark and tokens resolve', () => {
  assert.match(vars['color-scheme'] ?? rootBlock, /dark/);
  for (const k of ['ink', 'ink-2', 'ink-3', 'surface', 'surface-2', 'surface-solid', 'line', 'green', 'ok', 'warn', 'err', 'cyan', 'violet', 'amber', 'magenta', 'glow-strong', 'dur', 'glass-blur']) assert.ok(vars[k], `missing token --${k}`);
});

test('body text meets WCAG AA (4.5:1) on panels over every backdrop', () => {
  for (const bg of [DARK, BRIGHT]) {
    const panel = panelOn(bg);
    for (const t of ['ink', 'ink-2', 'ink-3']) assert.ok(ratio(parse(`var(--${t})`), panel) >= 4.5, `--${t} on panel: ${ratio(parse(`var(--${t})`), panel).toFixed(2)}`);
    assert.ok(ratio(parse('var(--ink-3)'), parse('var(--surface-solid)')) >= 4.5);
  }
});

test('status and accent text colours are legible on their soft badges', () => {
  const panel = panelOn(BRIGHT);
  for (const [fg, bg] of [['ok', 'ok-soft'], ['warn-ink', 'warn-soft'], ['err', 'err-soft'], ['info', 'info-soft'], ['ink-2', 'muted-soft']]) {
    const b = over(parse(`var(--${bg})`), panel);
    const r = ratio(parse(`var(--${fg})`), b);
    assert.ok(r >= 4.5, `${fg} on ${bg}: ${r.toFixed(2)}`);
  }
  for (const a of ['cyan', 'violet', 'amber', 'magenta', 'blue']) assert.ok(ratio(parse(`var(--${a})`), panel) >= 3, `--${a} as chart/large text: ${ratio(parse(`var(--${a})`), panel).toFixed(2)}`);
});

test('primary buttons: white text on the primary colour meets AA', () => {
  assert.ok(ratio([255, 255, 255, 1], parse('var(--green)')) >= 4.5, `${ratio([255, 255, 255, 1], parse('var(--green)')).toFixed(2)}`);
  assert.ok(ratio([255, 255, 255, 1], parse('#4f46e5')) >= 4.5);
});

test('motion safety: reduced-motion block disables cosmic animations; lightning is a single soft flash', () => {
  const rm = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(rm, /\.cz-root \*/);
  assert.match(rm, /animation: none !important/);
  const flash = /@keyframes cz-flash \{([\s\S]*?)\n\}/.exec(css)[1];
  assert.equal((flash.match(/^\s*\d+%\s*\{/gm) ?? []).length, 2, 'one rise-and-fade: no strobe');
  assert.match(css, /\.cz-storm\.cz-flash \{ animation: cz-flash 900ms ease-out 1; \}/, 'one iteration, ~1 s');
  const src = readFileSync(join(ROOT, 'src/components/cosmic/CosmicBackground.tsx'), 'utf8');
  for (const m of src.matchAll(/lightningGap: \[(\d+), (\d+)\]/g)) assert.ok(Number(m[1]) >= 15000, 'lightning at most every 15 s');
  assert.match(src, /minimal: \{[^}]*fps: 0[^}]*lightningGap: null/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /visibilitychange/);
  assert.ok(!/new Audio|AudioContext/.test(src), 'no sound');
});
