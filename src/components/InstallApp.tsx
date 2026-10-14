// "Install app" button: appears only when the browser offers installation (Android Chrome/Edge,
// desktop Chrome). iPhone Safari has no install prompt — use Share → Add to Home Screen.
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallApp() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches ?? false);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    const done = () => (setInstalled(true), setEvt(null));
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', on);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  if (installed || !evt) return null;
  return (
    <button
      className="btn btn-small btn-primary install-btn"
      onClick={async () => {
        await evt.prompt();
        await evt.userChoice;
        setEvt(null);
      }}
    >
      ⬇ Install app
    </button>
  );
}
