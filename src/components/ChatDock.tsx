// SAARTHI — floating CBO chat (technical id: saarthi_cbo_chat).
// Sits minimised at the bottom-right of every page; opens a side panel with the same CBO chat
// (same thread, engines, Think/Research) as the CBO page. Rendered in a portal so the topbar's
// backdrop-filter or tilted cards can never trap or clip it.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CboChat } from './cbo/StudioDesk';

export const CHAT_BOT_NAME = 'SAARTHI';
const KEY = 'gas.dock.open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function ChatDock({ hidden = false }: { hidden?: boolean }) {
  const [open, setOpen] = useState(readOpen);
  // Mount the chat on first open, then keep it mounted while minimised so a reply in progress survives.
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (hidden) return null;

  return createPortal(
    <>
      {mounted && (
        <aside className={`dock-panel ${open ? 'is-open' : ''}`} aria-label={`${CHAT_BOT_NAME} chat`} aria-hidden={!open}>
          <div className="dock-head">
            <img className="dock-avatar dock-saarthi" src="./agents/saarthi-96.webp" alt="" aria-hidden="true" />
            <div>
              <strong>{CHAT_BOT_NAME}</strong>
              <span className="dock-sub">Your Chief Business Officer · plans, delegates, runs</span>
            </div>
            <button className="icon-btn dock-min" onClick={() => setOpen(false)} aria-label="Minimise chat" title="Minimise (Esc)">
              —
            </button>
          </div>
          <div className="dock-body">
            <CboChat compact title={`Chat with ${CHAT_BOT_NAME}`} />
          </div>
        </aside>
      )}
      {!open && (
        <button className="dock-fab" onClick={() => setOpen(true)} aria-label={`Open ${CHAT_BOT_NAME} chat`} title={`Chat with ${CHAT_BOT_NAME}`}>
          <img className="dock-avatar dock-saarthi" src="./agents/saarthi-96.webp" alt="" aria-hidden="true" />
          <span className="dock-fab-label">{CHAT_BOT_NAME}</span>
        </button>
      )}
    </>,
    document.body,
  );
}
