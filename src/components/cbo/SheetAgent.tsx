// Character Sheet Agent (CHITRA): paste a story → character inventory, library-first reuse, and a
// copy-ready Gemini model-sheet prompt for every missing character, with one-tap upload back by name.
import { useEffect, useState } from 'react';
import { api, base, getToken } from '../../services/adminService';
import { Card, formatWhen } from '../ui';
import { SheetThumb } from '../SheetThumb';

interface Char {
  name: string;
  role: 'main' | 'supporting';
  status: 'existing' | 'missing' | 'uncertain';
  librarySheet: { id: string; name: string } | null;
  reason: string;
  description: string;
  palette: { name: string; hex: string | null }[];
  geminiPrompt: string | null;
}
interface Plan { id: string; project: string; createdAt: string; model: string; style: string; characters: Char[]; continuity: string[]; notes: string[]; librarySize: number }

const STATUS: Record<Char['status'], { label: string; cls: string }> = {
  existing: { label: 'In library · reuse', cls: 'pill-running' },
  missing: { label: 'Missing · make sheet', cls: 'pill-warn' },
  uncertain: { label: 'Unsure · check', cls: 'pill-warn' },
};

export function SheetAgent({ onSheetAdded }: { onSheetAdded?: () => void }) {
  const [story, setStory] = useState('');
  const [project, setProject] = useState('');
  const [style, setStyle] = useState('3d');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, string>>({});

  useEffect(() => {
    api<{ plans: Plan[] }>('/api/reels/sheet-agent').then((r) => (setPlans(r.plans), setPlan((p) => p ?? r.plans[0] ?? null)), () => {});
  }, []);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ plan: Plan }>('/api/reels/sheet-agent', { method: 'POST', body: JSON.stringify({ story, project, style }) });
      setPlan(r.plan);
      setPlans((x) => [r.plan, ...x].slice(0, 10));
      setUploaded({});
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };
  const copy = (t: string, what: string) => navigator.clipboard?.writeText(t).then(() => setMsg(`${what} copied ✅`), () => setMsg('Copy failed — select the text instead.'));
  const upload = async (c: Char, file: File | undefined) => {
    if (!file) return;
    setUploaded((x) => ({ ...x, [c.name]: 'uploading' }));
    try {
      const res = await fetch(`${base()}/api/reels/sheets?${new URLSearchParams({ name: c.name })}`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}`, 'content-type': file.type }, body: file });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      setUploaded((x) => ({ ...x, [c.name]: 'done' }));
      onSheetAdded?.();
    } catch (e) {
      setUploaded((x) => ({ ...x, [c.name]: `failed: ${e instanceof Error ? e.message : 'error'}` }));
    }
  };

  return (
    <Card title="Character Sheet Agent · CHITRA">
      <p className="cx-sub">
        Story paste karo → CHITRA har character dhoondhta hai, pehle aapki <strong>uploaded sheets</strong> mein match karta hai (mili toh wahi reuse), aur jo missing hain unke liye poora <strong>Gemini model-sheet prompt</strong> banata hai (portrait, front/side/back, 6+ expressions, 6+ poses, HEX palette). Image Gemini app mein banao (AI Pro mein free) aur yahin upload karo — naam pehle se bhara hota hai.
      </p>
      <div className="form">
        <div className="form-row">
          <label>Project / story name<input value={project} onChange={(e) => setProject(e.target.value)} maxLength={120} placeholder="e.g. Pip and the Magic of Sharing" /></label>
          <label>Style
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="3d">3D (premium CGI)</option>
              <option value="2d">2D</option>
              <option value="clay">Clay / stop-motion</option>
            </select>
          </label>
        </div>
        <label>Story, script or scene list<textarea value={story} onChange={(e) => setStory(e.target.value)} rows={5} maxLength={30000} placeholder="Paste the full story or script…" /></label>
        <div className="modal-actions">
          {plans.length > 1 && (
            <select aria-label="Previous runs" value={plan?.id ?? ''} onChange={(e) => setPlan(plans.find((p) => p.id === e.target.value) ?? null)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.project} · {formatWhen(p.createdAt)}</option>)}
            </select>
          )}
          <button className="btn btn-primary" disabled={busy || story.trim().length < 20} onClick={run}>{busy ? 'CHITRA is reading the story…' : '🎨 Find & plan character sheets'}</button>
        </div>
      </div>
      {msg && <p className={msg.includes('✅') ? 'cx-ok' : 'form-error'}>{msg}</p>}

      {plan && (
        <div className="sa">
          <p className="cx-sub"><strong>{plan.project}</strong> · {plan.characters.length} characters · library had {plan.librarySize} sheet(s) · {plan.style.toUpperCase()} · {formatWhen(plan.createdAt)}</p>
          {plan.characters.map((c) => (
            <section key={c.name} className="fp-reel">
              <header className="fp-head">
                <strong>{c.name}</strong>
                <span className="cx-sub">{c.role}</span>
                <span className={`pill ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
              </header>
              {c.librarySheet && (
                <div className="fp-sheets">
                  <span className="fp-sheet"><SheetThumb id={c.librarySheet.id} name={c.librarySheet.name} /><code>{c.librarySheet.name}</code></span>
                  <span className="cx-sub">Use this sheet as the Flow ingredient. Do not redesign.</span>
                </div>
              )}
              {c.reason && <p className="cx-sub">{c.reason}</p>}
              {c.palette.length > 0 && (
                <div className="sa-palette">
                  {c.palette.map((p) => (
                    <span key={p.name} className="sa-swatch" title={p.hex ?? 'no HEX given'}>
                      <i style={{ background: p.hex ?? 'transparent' }} />{p.name}{p.hex ? ` ${p.hex}` : ''}
                    </span>
                  ))}
                </div>
              )}
              {c.geminiPrompt && (
                <>
                  <div className="nt-actions">
                    <button className="btn btn-small btn-primary" onClick={() => copy(c.geminiPrompt!, `${c.name} Gemini prompt`)}>📋 Copy Gemini prompt</button>
                    <a className="btn btn-small" href="https://gemini.google.com/app" target="_blank" rel="noreferrer">Open Gemini ↗</a>
                    <label className="btn btn-small bu-file">
                      {uploaded[c.name] === 'uploading' ? 'Uploading…' : uploaded[c.name] === 'done' ? `✅ Saved as "${c.name}"` : `⬆ Upload sheet as "${c.name}"`}
                      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploaded[c.name] === 'uploading' || uploaded[c.name] === 'done'} onChange={(e) => upload(c, e.target.files?.[0])} />
                    </label>
                  </div>
                  {uploaded[c.name]?.startsWith('failed') && <p className="form-error">{uploaded[c.name]}</p>}
                  <details>
                    <summary className="cx-sub">Show prompt</summary>
                    <pre className="fp-prompt">{c.geminiPrompt}</pre>
                  </details>
                </>
              )}
            </section>
          ))}
          {plan.continuity.length > 0 && (
            <div>
              <p className="nt-title">Continuity rules (repeat in every clip prompt)</p>
              <ul className="cx-sub fp-notes">{plan.continuity.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <button className="btn btn-small" onClick={() => copy(plan.continuity.map((r) => `- ${r}`).join('\n'), 'Continuity rules')}>Copy rules</button>
            </div>
          )}
          {plan.notes.length > 0 && <ul className="cx-sub fp-notes">{plan.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </div>
      )}
    </Card>
  );
}
