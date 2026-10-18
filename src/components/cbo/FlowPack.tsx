// Flow pack for a finished LittleLoop goal: one copy-paste Google Flow master prompt per reel,
// plus the character sheets (by the name saved in Ganesha) to add as Flow ingredients.
import { useEffect, useState } from 'react';
import { api, base, getToken } from '../../services/adminService';
import { formatWhen } from '../ui';
import { SheetThumb } from '../SheetThumb';

interface PackReel { n: number; title: string; durationSec: number | null; sheets: string[]; sheetNote: string; masterPrompt: string }
interface Pack { title: string; reels: PackReel[]; notes: string[]; provider: string; model: string; createdAt: string }
interface Sheet { id: string; name: string }

export function FlowPack({ workflowId }: { workflowId: string }) {
  const [pack, setPack] = useState<Pack | null | undefined>(undefined);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ pack: Pack | null }>(`/api/workflows/${workflowId}/flow-pack`).then((r) => setPack(r.pack), (e) => (setPack(null), setMsg(e instanceof Error ? e.message : 'failed')));
    api<{ sheets: Sheet[] }>('/api/reels').then((r) => setSheets(r.sheets), () => {});
  }, [workflowId]);

  const make = async (force: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      setPack((await api<{ pack: Pack }>(`/api/workflows/${workflowId}/flow-pack`, { method: 'POST', body: JSON.stringify({ force }) })).pack);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => setMsg(`${what} copied ✅`), () => setMsg('Copy failed — long-press the prompt and select all.'));
  const saveSheet = async (s: Sheet) => {
    try {
      const res = await fetch(`${base()}/api/reels/sheets/${s.id}/image`, { headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${s.name}.${blob.type.split('/')[1] || 'png'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setMsg(`Could not save ${s.name}: ${e instanceof Error ? e.message : 'error'}`);
    }
  };
  const byName = (n: string) => sheets.find((s) => s.name === n);

  if (pack === undefined) return <p className="cx-sub">Loading Flow pack…</p>;
  if (!pack)
    return (
      <div className="fp">
        <p className="cx-sub">Saare agents ke output (script, shots, character sheet, sound, safety) ko jodkar har reel ka <strong>ek hi Flow prompt</strong> banega, aur kaunsi character sheet Flow mein daalni hai uska naam. Gemini (free) se banta hai, ~30 sec.</p>
        <button className="btn btn-primary btn-small" disabled={busy} onClick={() => make(false)}>{busy ? 'Making Flow pack…' : '🎬 Make Flow pack'}</button>
        {msg && <p className="form-error">{msg}</p>}
      </div>
    );
  return (
    <div className="fp">
      <p className="cx-sub">
        Har reel: Flow → New project → <strong>9:16</strong> → Veo 3.1 → neeche wali sheet(s) ko <strong>Ingredients</strong> mein add karo → prompt paste karo. Flow ek baar mein max 8 sec banata hai; lambi reel ke liye wahi prompt rakh kar <strong>Extend</strong> karo. Result ki guarantee nahi — har clip check karo.
      </p>
      {pack.reels.map((r) => (
        <section key={r.n} className="fp-reel">
          <header className="fp-head">
            <strong>Reel {r.n} · {r.title}</strong>
            {r.durationSec ? <span className="cx-sub">{r.durationSec}s</span> : null}
            <button className="btn btn-small btn-primary" onClick={() => copy(r.masterPrompt, `Reel ${r.n} prompt`)}>📋 Copy prompt</button>
          </header>
          <div className="fp-sheets">
            <span className="cx-sub">Character sheet to upload in Flow:</span>
            {r.sheets.length === 0 && <span className="pill pill-warn">None matched</span>}
            {r.sheets.map((n) => {
              const s = byName(n);
              return (
                <span key={n} className="fp-sheet">
                  {s && <SheetThumb id={s.id} name={s.name} />}
                  <code>{n}</code>
                  <button className="btn btn-small" onClick={() => copy(n, `Sheet name "${n}"`)}>Copy name</button>
                  {s && <button className="btn btn-small" onClick={() => saveSheet(s)}>⬇ Save image</button>}
                </span>
              );
            })}
          </div>
          {r.sheetNote && <p className="cx-sub fp-note">⚠️ {r.sheetNote}</p>}
          <pre className="fp-prompt">{r.masterPrompt}</pre>
        </section>
      ))}
      {pack.notes.length > 0 && (
        <ul className="cx-sub fp-notes">
          {pack.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <p className="cx-sub">
        Made {formatWhen(pack.createdAt)} · {pack.model}{' '}
        <button className="btn btn-small" disabled={busy} onClick={() => window.confirm('Make a fresh Flow pack? The current one will be replaced.') && make(true)}>{busy ? 'Remaking…' : '↻ Remake'}</button>
      </p>
      {msg && <p className={msg.includes('✅') ? 'cx-ok' : 'form-error'}>{msg}</p>}
    </div>
  );
}
