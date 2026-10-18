// Auto-update: an open tab or installed app checks for a new deploy and reloads itself
// (when the owner isn't typing), so the studio is always the latest version.
const CHECK_MS = 3 * 60_000;

function busyTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).build ?? null;
  } catch {
    return null;
  }
}

export function startAutoUpdate() {
  if (typeof window === 'undefined' || !/^https:/.test(window.location.protocol)) return;
  let pending = false;
  const check = async () => {
    const b = await latestBuild();
    if (!b || b === __BUILD_ID__) return;
    pending = true;
    tryReload();
  };
  const tryReload = () => {
    if (!pending) return;
    if (busyTyping()) return; // retry on the next check / blur
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    window.location.reload();
  };
  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  window.addEventListener('focusout', () => setTimeout(tryReload, 500));
  setTimeout(check, 15_000);
}
