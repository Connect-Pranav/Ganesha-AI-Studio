// Festival themes: recolours the studio and adds light decorations from 4 days before each festival.
// The engine (festive.js) is shared verbatim with AGENTVERSE; this file only maps it onto our tokens.
import './festive.js';

type FestiveApi = { auto: (opts: Record<string, unknown>) => unknown };

export function startFestiveTheme() {
  const api = (globalThis as unknown as { Festive?: FestiveApi }).Festive;
  if (!api) return;
  try {
    api.auto({
      target: document.documentElement,
      // hi = bright accent on dark, deep = primary fill behind white text (keeps --primary-ink readable).
      vars: { hi: ['--blue', '--violet'], hi2: ['--cyan'], deep: ['--green', '--green-2'] },
      artBase: '/',
      position: 'bottom',
      offset: window.innerWidth < 900 ? 84 : 24, // clear the phone bottom nav
      particles: 16,
      minimal: () => document.querySelector('.app')?.getAttribute('data-fx') === 'minimal',
    });
  } catch (e) {
    console.warn('Festive theme not applied:', e);
  }
}
