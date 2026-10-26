// Studio skin: 'classic' (deep navy) or 'neon' (Neon Coast — sunset, neon, game HUD). Saved per browser.
export type Skin = 'classic' | 'neon';
export const SKIN_EVENT = 'gas-skin';
const KEY = 'gas.skin';

export function getSkin(): Skin {
  try {
    return localStorage.getItem(KEY) === 'neon' ? 'neon' : 'classic';
  } catch {
    return 'classic';
  }
}

export function applySkin(skin: Skin = getSkin()) {
  document.documentElement.dataset.skin = skin;
}

export function setSkin(skin: Skin) {
  try {
    localStorage.setItem(KEY, skin);
  } catch {
    /* private mode: still switch for this visit */
  }
  applySkin(skin);
  window.dispatchEvent(new CustomEvent(SKIN_EVENT, { detail: skin }));
}
