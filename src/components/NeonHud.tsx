// Neon Coast skin: an original sunset/neon game-HUD look for the studio (not any game's branding).
// HUD = level & XP from real finished work, attention stars from real pending approvals, month AI spend,
// a brand radar, a "mission complete" banner when a Brain mission finishes, and a phone quick-menu.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { getSkin, setSkin, SKIN_EVENT, type Skin } from '../services/skin';
import type { View } from '../types';

interface Hud {
  xp: number;
  level: number;
  xpInLevel: number;
  xpForNext: number;
  counts: { missions: number; steps: number; reels: number; outreach: number; won: number };
  xpRules: { mission: number; step: number; reel: number; outreach: number; won: number };
  attention: { missionApprovals: number; reelReviews: number; outreachApprovals: number; failedMissions7d: number };
  stars: number;
  attentionTotal: number;
  running: number;
  spend: { monthUsd: number; calls: number; callsWithUnknownCost: number };
  brands: Record<'littleloop' | 'sunverse' | 'foliocraft', { awaiting: number; running: number; done: number; leads: number }>;
}

export function useSkin(): Skin {
  const [skin, set] = useState<Skin>(getSkin);
  useEffect(() => {
    const f = () => set(getSkin());
    window.addEventListener(SKIN_EVENT, f);
    return () => window.removeEventListener(SKIN_EVENT, f);
  }, []);
  return skin;
}

/** Header button: switch between Classic and Neon Coast. */
export function SkinToggle() {
  const skin = useSkin();
  const neon = skin === 'neon';
  return (
    <button className={`icon-btn skin-toggle ${neon ? 'active' : ''}`} onClick={() => setSkin(neon ? 'classic' : 'neon')} title={neon ? 'Switch to Classic theme' : 'Switch to Neon Coast theme'} aria-label={neon ? 'Switch to Classic theme' : 'Switch to Neon Coast theme'} aria-pressed={neon}>
      <span aria-hidden="true">{neon ? '🌙' : '🌴'}</span>
    </button>
  );
}

const BRAND_POS: Record<string, { x: number; y: number; label: string }> = {
  littleloop: { x: 30, y: 26, label: 'LittleLoop' },
  sunverse: { x: 72, y: 38, label: 'Sunverse' },
  foliocraft: { x: 44, y: 72, label: 'Foliocraft' },
};

function Radar({ hud, onOpen }: { hud: Hud; onOpen: (v: View) => void }) {
  return (
    <button className="nh-radar" onClick={() => onOpen('brain')} title="Brand radar — pulsing blip = a mission needs your approval" aria-label="Brand radar">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="47" className="nh-radar-bg" />
        <circle cx="50" cy="50" r="31" className="nh-radar-ring" />
        <circle cx="50" cy="50" r="15" className="nh-radar-ring" />
        <path d="M50 3 V97 M3 50 H97" className="nh-radar-ring" />
        <g className="nh-sweep"><path d="M50 50 L50 3 A47 47 0 0 1 90 26 Z" /></g>
        {Object.entries(BRAND_POS).map(([id, p]) => {
          const b = hud.brands[id as keyof Hud['brands']];
          const cls = b?.awaiting ? 'alert' : b?.running ? 'busy' : 'calm';
          return (
            <g key={id} className={`nh-blip ${cls}`}>
              <circle cx={p.x} cy={p.y} r="4.5" />
              <title>{`${p.label}: ${b?.awaiting ?? 0} waiting for you, ${b?.running ?? 0} running, ${b?.done ?? 0} done`}</title>
            </g>
          );
        })}
        <polygon points="50,44 54,54 50,51 46,54" className="nh-you" />
      </svg>
    </button>
  );
}

function Banner({ kind, text, sub, onDone }: { kind: 'mission' | 'level'; text: string; sub: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={`nh-banner ${kind}`} role="status" onClick={onDone}>
      <div className="nh-banner-text">{text}</div>
      <div className="nh-banner-sub">{sub}</div>
    </div>
  );
}

const PHONE_APPS: { view: View; icon: string; label: string }[] = [
  { view: 'brain', icon: '🧠', label: 'Brain' },
  { view: 'cbo', icon: '🪷', label: 'Saarthi' },
  { view: 'growth', icon: '🐭', label: 'Mushak' },
  { view: 'littleloop', icon: '🎬', label: 'LittleLoop' },
  { view: 'sunverse', icon: '🎵', label: 'Sunverse' },
  { view: 'foliocraft', icon: '💼', label: 'Foliocraft' },
  { view: 'pipelines', icon: '🛠️', label: 'Pipelines' },
  { view: 'finance', icon: '💵', label: 'Costs' },
  { view: 'settings', icon: '⚙️', label: 'Settings' },
];

function Phone({ onOpen, hud }: { onOpen: (v: View) => void; hud: Hud | null }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTime(new Date()), 30_000);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <>
      <button className="nh-phone-fab" onClick={() => setOpen((o) => !o)} aria-label="Open phone menu" aria-expanded={open} title="Phone menu">
        📱{hud && hud.attentionTotal > 0 && <span className="nh-badge">{hud.attentionTotal}</span>}
      </button>
      {open && (
        <div className="nh-phone" role="dialog" aria-label="Phone menu">
          <div className="nh-phone-top">
            <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span>Ganesha</span>
            <button onClick={() => setOpen(false)} aria-label="Close phone">✕</button>
          </div>
          {hud && hud.attentionTotal > 0 && (
            <button className="nh-phone-alert" onClick={() => { onOpen('brain'); setOpen(false); }}>
              🔔 {hud.attentionTotal} cheez{hud.attentionTotal > 1 ? 'en' : ''} aapka wait kar rahi hai
            </button>
          )}
          <div className="nh-phone-apps">
            {PHONE_APPS.map((a) => (
              <button key={a.view} onClick={() => { onOpen(a.view); setOpen(false); }}>
                <span className="nh-app-icon">{a.icon}</span>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
          <button className="nh-phone-skin" onClick={() => setSkin('classic')}>🌙 Classic theme</button>
        </div>
      )}
    </>
  );
}

const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

/** The HUD strip under the header. Renders only in the Neon Coast skin and when the studio is unlocked. */
export function NeonHud({ onOpen }: { onOpen: (v: View) => void }) {
  const skin = useSkin();
  const [hud, setHud] = useState<Hud | null>(null);
  const [locked, setLocked] = useState(!getToken());
  const [banner, setBanner] = useState<{ kind: 'mission' | 'level'; text: string; sub: string } | null>(null);
  const prev = useRef<Hud | null>(null);
  const queue = useRef<{ kind: 'mission' | 'level'; text: string; sub: string }[]>([]);
  const showing = useRef(false);

  const load = useCallback(() => {
    const has = Boolean(getToken());
    setLocked(!has);
    if (!has) return;
    api<Hud>('/api/brain/hud')
      .then((h) => {
        const p = prev.current;
        if (p) {
          if (h.counts.missions > p.counts.missions) queue.current.push({ kind: 'mission', text: 'MISSION COMPLETE', sub: `+${(h.counts.missions - p.counts.missions) * h.xpRules.mission} XP · Brain mein result dekhiye` });
          if (h.level > p.level) queue.current.push({ kind: 'level', text: `LEVEL ${h.level}`, sub: 'Studio level up — real kaam se kamaya' });
          if (!showing.current && queue.current.length) {
            showing.current = true;
            setBanner(queue.current.shift() ?? null);
          }
        }
        prev.current = h;
        setHud(h);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (skin !== 'neon') return;
    load();
    const t = setInterval(load, 45_000);
    window.addEventListener(AUTH_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(AUTH_EVENT, load);
    };
  }, [skin, load]);

  const nextBanner = useCallback(() => {
    const n = queue.current.shift() ?? null;
    showing.current = Boolean(n);
    setBanner(n);
  }, []);

  if (skin !== 'neon') return null;
  if (locked) return <div className="nh nh-locked">🌴 Neon Coast · unlock the studio (🔔 bell) to see your HUD</div>;
  if (!hud) return <div className="nh nh-locked">🌴 Loading HUD…</div>;
  const pct = Math.round((hud.xpInLevel / Math.max(1, hud.xpForNext)) * 100);
  const a = hud.attention;
  const why = [a.missionApprovals && `${a.missionApprovals} mission plan(s) to approve`, a.reelReviews && `${a.reelReviews} reel(s) to review`, a.outreachApprovals && `${a.outreachApprovals} outreach draft(s) to approve`, a.failedMissions7d && `${a.failedMissions7d} mission(s) failed this week`].filter(Boolean).join(' · ') || 'Nothing waiting for you';
  const c = hud.counts;
  return (
    <>
      <div className="nh" role="region" aria-label="Studio HUD">
        <Radar hud={hud} onOpen={onOpen} />
        <div className="nh-level" title={`XP is counted from real work: ${c.missions} missions × ${hud.xpRules.mission}, ${c.steps} steps × ${hud.xpRules.step}, ${c.reels} reels posted × ${hud.xpRules.reel}, ${c.outreach} outreach sent × ${hud.xpRules.outreach}, ${c.won} deals won × ${hud.xpRules.won}`}>
          <span className="nh-lv">LV {hud.level}</span>
          <div className="nh-xpbar" role="progressbar" aria-valuemin={0} aria-valuemax={hud.xpForNext} aria-valuenow={hud.xpInLevel} aria-label="XP to next level">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="nh-xp">{hud.xpInLevel}/{hud.xpForNext} XP</span>
        </div>
        <button className="nh-stars" onClick={() => onOpen('brain')} title={why} aria-label={`Attention level ${hud.stars} of 5: ${why}`}>
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className={i < hud.stars ? 'on' : ''}>★</span>)}
        </button>
        <div className="nh-cash" title={`${hud.spend.calls} AI calls this month${hud.spend.callsWithUnknownCost ? `, ${hud.spend.callsWithUnknownCost} with unknown cost (free tier or no price set)` : ''}`}>
          <span className="nh-cash-v">{usd(hud.spend.monthUsd)}</span>
          <span className="nh-cash-k">AI spend · month</span>
        </div>
        {hud.running > 0 && <button className="nh-live" onClick={() => onOpen('brain')}>⚡ {hud.running} mission{hud.running > 1 ? 's' : ''} live</button>}
      </div>
      {banner && <Banner {...banner} onDone={nextBanner} />}
      <Phone onOpen={onOpen} hud={hud} />
    </>
  );
}
