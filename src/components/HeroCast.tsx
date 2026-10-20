// Home hero cast: the LittleLoop character sheets you uploaded, fanned out under the big
// heading on a glowing horizon. Sheets are private (owner token); without the token or
// before any sheet exists, the three brand marks stand in — nothing is invented.
import { useEffect, useState } from 'react';
import { api, AUTH_EVENT, getToken } from '../services/adminService';
import { SheetThumb } from './SheetThumb';
import { BrandMark, hasLogo } from './BrandMark';

interface Sheet {
  id: string;
  name: string;
  active?: boolean;
}

const BRANDS = [
  { id: 'littleloop', name: 'LittleLoop' },
  { id: 'sunverse', name: 'Sunverse' },
  { id: 'foliocraft', name: 'Foliocraft' },
] as const;

export function HeroCast({ onOpen }: { onOpen: (v: 'characters' | 'littleloop' | 'sunverse' | 'foliocraft') => void }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  useEffect(() => {
    const load = () => {
      if (!getToken()) return setSheets([]);
      api<{ sheets: Sheet[] }>('/api/reels')
        .then((r) => setSheets((r.sheets ?? []).filter((s) => s.active !== false).slice(0, 5)))
        .catch(() => setSheets([]));
    };
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, []);

  if (sheets === null) return <div className="hc hc-empty" aria-hidden="true" />;

  if (sheets.length === 0)
    return (
      <div className="hc">
        <div className="hc-row hc-brands">
          {BRANDS.map((b, i) => (
            <button key={b.id} className={`hc-orb ${hasLogo(b.id) ? 'has-logo' : ''}`} style={{ ['--i' as string]: i - 1 }} onClick={() => onOpen(b.id)} aria-label={`Open ${b.name}`}>
              <BrandMark id={b.id} size={150} iconSize={34} />
              {!hasLogo(b.id) && <span>{b.name}</span>}
            </button>
          ))}
        </div>
        <div className="hc-horizon" aria-hidden="true" />
      </div>
    );

  const mid = (sheets.length - 1) / 2;
  return (
    <div className="hc">
      <div className="hc-row">
        {sheets.map((s, i) => (
          <button key={s.id} className={`hc-card ${Math.abs(i - mid) > 1 ? 'hc-far' : ''}`} style={{ ['--i' as string]: i - mid, ['--n' as string]: sheets.length }} onClick={() => onOpen('characters')} title={s.name}>
            <SheetThumb id={s.id} name={s.name} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <div className="hc-horizon" aria-hidden="true" />
    </div>
  );
}
