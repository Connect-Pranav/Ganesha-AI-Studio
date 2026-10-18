// LittleLoop Reel Factory panel: factory switch + daily cap, character sheets (rotation),
// reels waiting for approval (watch the video, then Approve & post / New take / Reject),
// and recent reels with their Instagram links. Every value comes from /api/reels.
import { useCallback, useEffect, useRef, useState } from 'react';
import { InstagramConnect } from './cbo/StudioDesk';
import { SheetThumb } from './SheetThumb';
import { api, base, getToken, AUTH_EVENT } from '../services/adminService';
import { Card, EmptyState, formatWhen } from './ui';
import { Icon } from './Icon';

type ReelStatus = 'queued' | 'rendering' | 'review' | 'approved' | 'publishing' | 'published' | 'rejected' | 'failed';
interface Scene {
  n: number;
  duration_s: number;
  setting?: string;
  camera?: string;
  beats?: { t?: string; action?: string; dialogue?: string; sfx?: string }[];
  music?: string;
  final_frame?: string;
}
interface Reel {
  id: string;
  day: string;
  slot: number;
  sheetId: string;
  status: ReelStatus;
  script: { title?: string; logline?: string; lesson_or_payoff?: string; scenes?: Scene[] } | null;
  caption: string | null;
  videoUrl: string | null;
  videoMeta: { duration?: number; width?: number; height?: number; qc?: string } | null;
  attempts: number;
  costUsd: number;
  error: string | null;
  igPermalink: string | null;
  publishedAt: string | null;
  updatedAt: string;
  flow?: { stage: 'awaiting_clips' | 'clips_uploaded' | 'joining'; uploadUrl: string; expires: string; uploaded: number[]; clips: { n: number; duration_s: number; prompt: string | null }[] };
}
interface Sheet {
  id: string;
  name: string;
  notes: string;
  details: string | null;
  detailsStatus: 'pending' | 'ready' | 'error';
  active: boolean;
  useCount: number;
  lastUsedAt: string | null;
}
interface Overview {
  config: { enabled: boolean; perDay: number; dailyCapUsd: number; estReelUsd: number; language: string; brief: string; renderMode: 'flow' | 'api'; flowModel: string; flowCreditsPerReel: number };
  day: string;
  sheets: Sheet[];
  reels: Reel[];
  spend: { todayUsd: number; monthUsd: number; monthReels: number };
  connections: { media: boolean; instagram: boolean; runnerLastSeen: string | null };
  pendingApproval: number;
  waitingForFlow: number;
}

const STATUS: Record<ReelStatus, [string, string]> = {
  queued: ['Queued', 'pill-idle'],
  rendering: ['Rendering', 'pill-running'],
  review: ['Needs your approval', 'pill-warn'],
  approved: ['Approved · posting', 'pill-info'],
  publishing: ['Posting to Instagram', 'pill-info'],
  published: ['Posted', 'pill-running'],
  rejected: ['Rejected', 'pill-idle'],
  failed: ['Failed', 'pill-error'],
};
const usd = (n: number) => `$${n.toFixed(2)}`;

export function ReelFactory() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheetName, setSheetName] = useState('');
  const [sheetNotes, setSheetNotes] = useState('');

  const load = useCallback(async () => {
    if (!getToken()) {
      setError('locked');
      return;
    }
    try {
      setData(await api<Overview>('/api/reels'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener(AUTH_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(AUTH_EVENT, load);
    };
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? `Failed: ${e.message}` : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const saveConfig = (patch: Partial<Overview['config']>, done: string) => act('config', () => api('/api/reels/config', { method: 'PUT', body: JSON.stringify(patch) }), done);
  const decide = (r: Reel, decision: 'approve' | 'reject' | 'redo') => {
    const reason = decision === 'approve' ? '' : window.prompt(decision === 'redo' ? 'What should change in the new take? (optional)' : 'Why reject? (optional)') ?? null;
    if (reason === null) return;
    act(r.id, () => api(`/api/reels/${r.id}/${decision}`, { method: 'POST', body: JSON.stringify({ reason }) }), decision === 'approve' ? 'Approved — posting to Instagram now.' : decision === 'redo' ? 'A new take is queued.' : 'Rejected.');
  };

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !sheetName.trim()) return setNotice('Pick an image and give the character a name.');
    const token = getToken();
    await act(
      'upload',
      async () => {
        const q = new URLSearchParams({ name: sheetName.trim(), notes: sheetNotes.trim() });
        const res = await fetch(`${base()}/api/reels/sheets?${q}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': file.type }, body: file });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      },
      `Uploaded ${sheetName.trim()}. The runner reads it on its next run (about 30 min).`,
    );
    setSheetName('');
    setSheetNotes('');
    if (fileRef.current) fileRef.current.value = '';
  };

  if (error === 'locked') return <Card title="LittleLoop Reel Factory"><EmptyState title="Unlock the studio to manage reels" hint="Use the bell → Unlock with your admin token." /></Card>;
  if (error) return <Card title="LittleLoop Reel Factory"><p className="form-error">Reel factory: {error}</p></Card>;
  if (!data) return <Card title="LittleLoop Reel Factory"><p className="cx-sub">Loading…</p></Card>;

  const { config: cfg, connections: con } = data;
  const review = data.reels.filter((r) => r.status === 'review');
  const others = data.reels.filter((r) => r.status !== 'review').slice(0, 12);
  const runnerOk = con.runnerLastSeen && Date.now() - Date.parse(con.runnerLastSeen) < 2 * 3600_000;
  const sheetName_ = (id: string) => data.sheets.find((s) => s.id === id)?.name ?? 'character';

  return (
    <Card
      title="LittleLoop Reel Factory"
      className="rf"
      action={
        <button className={`btn btn-small ${cfg.enabled ? 'btn-primary' : ''}`} disabled={busy === 'config'} onClick={() => saveConfig({ enabled: !cfg.enabled }, cfg.enabled ? 'Factory switched off.' : `Factory on: ${cfg.perDay} reels/day, max ${usd(cfg.dailyCapUsd)}/day.`)}>
          {cfg.enabled ? 'ON · tap to stop' : 'OFF · tap to start'}
        </button>
      }
    >
      {notice && <p className="drawer-notice" role="status">{notice}</p>}
      <InstagramConnect />

      <div className="rf-stats">
        <div><span className="rf-k">Plan</span><span className="rf-v">{cfg.perDay}/day · 2 × 10 s</span></div>
        {cfg.renderMode === 'flow' ? (
          <div><span className="rf-k">Google Flow</span><span className="rf-v">{cfg.flowModel} · ~{cfg.flowCreditsPerReel * cfg.perDay} credits/day</span></div>
        ) : (
          <div><span className="rf-k">Today</span><span className="rf-v">{usd(data.spend.todayUsd)} of {usd(cfg.dailyCapUsd)}</span></div>
        )}
        <div><span className="rf-k">This month</span><span className="rf-v">{usd(data.spend.monthUsd)} · {data.spend.monthReels} reels</span></div>
        <div><span className="rf-k">Waiting for you</span><span className="rf-v">{data.pendingApproval}</span></div>
      </div>
      <p className="rf-conn">
        <span className={`pill ${runnerOk ? 'pill-running' : 'pill-warn'}`}>Renderer {con.runnerLastSeen ? `seen ${formatWhen(con.runnerLastSeen)}` : 'not seen yet'}</span>{' '}
        <span className={`pill ${con.instagram ? 'pill-running' : 'pill-warn'}`}>Instagram {con.instagram ? 'connected' : 'not connected'}</span>{' '}
        <span className={`pill ${con.media ? 'pill-running' : 'pill-error'}`}>Video storage {con.media ? 'ready' : 'missing'}</span>{' '}
        <button className="btn btn-small" onClick={() => setSettings((s) => !s)}>{settings ? 'Close settings' : 'Settings'}</button>
      </p>
      <p className="cx-sub">
        {cfg.renderMode === 'flow'
          ? `Videos are made in Google Flow with your AI Pro credits (${cfg.flowModel}: 3 clips of 8 + 6 + 6 s ≈ ${cfg.flowCreditsPerReel} credits per reel), so no API money is spent. Scripts use the free Gemini key.`
          : 'Costs are real token usage from the Gemini API (Omni Flash $1.50 in / $17.50 video out per 1M tokens), not guesses.'}{' '}
        Nothing is posted until you approve it here.
      </p>

      {settings && (
        <form
          className="form rf-settings"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            saveConfig({ perDay: Number(f.get('perDay')), dailyCapUsd: Number(f.get('cap')), language: String(f.get('language')), brief: String(f.get('brief')), renderMode: f.get('renderMode') as 'flow' | 'api', flowModel: String(f.get('flowModel')) }, 'Settings saved.');
          }}
        >
          <div className="form-row">
            <label>Reels per day<input name="perDay" type="number" min={1} max={4} defaultValue={cfg.perDay} /></label>
            <label>Daily spend cap (USD)<input name="cap" type="number" min={0} max={100} step={0.5} defaultValue={cfg.dailyCapUsd} /></label>
          </div>
          <div className="form-row">
            <label>Make videos with<select name="renderMode" defaultValue={cfg.renderMode}><option value="flow">Google Flow (free AI Pro credits)</option><option value="api">Gemini API · Omni Flash (paid)</option></select></label>
            <label>Flow model<select name="flowModel" defaultValue={cfg.flowModel}><option>Veo 3.1 Lite</option><option>Veo 3.1 Fast</option><option>Veo 3.1 Quality</option></select></label>
          </div>
          <label>Dialogue language<input name="language" maxLength={120} defaultValue={cfg.language} /></label>
          <label>Standing brief for the writer (optional)<textarea name="brief" maxLength={1500} rows={3} defaultValue={cfg.brief} placeholder="e.g. Every story ends with a small good habit. Keep Dadi in the background." /></label>
          <div className="modal-actions"><button className="btn btn-primary" disabled={busy === 'config'}>Save</button></div>
        </form>
      )}

      {data.reels.some((r) => r.flow) && (
        <>
          <h3 className="rf-h">Make in Google Flow</h3>
          {data.reels.filter((r) => r.flow).map((r) => (
            <FlowJob key={r.id} reel={r} sheetName={sheetName_(r.sheetId)} flowModel={cfg.flowModel} onChange={load} setNotice={setNotice} />
          ))}
        </>
      )}

      <h3 className="rf-h">Needs your approval</h3>
      {review.length === 0 && <p className="cx-sub">Nothing waiting. New reels appear here after rendering (~20–40 min each).</p>}
      {review.map((r) => (
        <article key={r.id} className="rf-review">
          {r.videoUrl && <video className="rf-video" src={r.videoUrl} controls playsInline preload="metadata" />}
          <div className="rf-review-body">
            <p className="nt-title">{r.script?.title ?? 'Untitled'} <span className="cx-sub">· {sheetName_(r.sheetId)} · {r.day} #{r.slot}</span></p>
            {r.script?.logline && <p className="nt-text">{r.script.logline}</p>}
            <p className="rf-caption">{r.caption}</p>
            <p className="cx-sub">QC: {r.videoMeta?.qc ?? '—'} · {r.videoMeta?.duration ?? '?'} s · {r.videoMeta?.width}×{r.videoMeta?.height} · cost {usd(r.costUsd)}</p>
            <button className="btn btn-small" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide script' : 'Show script'}</button>
            {open === r.id && <ScriptView reel={r} />}
            <div className="nt-actions">
              <button className="btn btn-small btn-primary" disabled={busy === r.id} onClick={() => decide(r, 'approve')}>Approve & post</button>
              <button className="btn btn-small" disabled={busy === r.id} onClick={() => decide(r, 'redo')}>New take</button>
              <button className="btn btn-small" disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Reject</button>
            </div>
          </div>
        </article>
      ))}

      <h3 className="rf-h">Recent reels</h3>
      {others.length === 0 ? (
        <p className="cx-sub">No reels yet. Upload character sheets and switch the factory on.</p>
      ) : (
        <ul className="rf-list">
          {others.map((r) => (
            <li key={r.id}>
              <span className={`pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
              <span className="rf-li-title">{r.script?.title ?? sheetName_(r.sheetId)}</span>
              <span className="cx-sub">{r.day} #{r.slot}{r.costUsd ? ` · ${usd(r.costUsd)}` : ''}</span>
              {r.igPermalink && <a href={r.igPermalink} target="_blank" rel="noreferrer">Open on Instagram</a>}
              {r.error && <span className="rf-err">{r.error}</span>}
              {r.status === 'failed' && <button className="btn btn-small" disabled={busy === r.id} onClick={() => decide(r, 'redo')}>Try again</button>}
            </li>
          ))}
        </ul>
      )}

      <h3 className="rf-h">Character sheets · rotation</h3>
      <p className="cx-sub">Each day the least recently used active sheet goes first. The renderer reads every new sheet once and writes a character bible so the look stays identical.</p>
      <div className="rf-sheets">
        {data.sheets.map((s) => (
          <div key={s.id} className={`rf-sheet ${s.active ? '' : 'rf-off'}`}>
            <SheetThumb id={s.id} name={s.name} />
            <p className="nt-title">{s.name}</p>
            <p className="cx-sub">
              {s.detailsStatus === 'ready' ? 'Ready' : s.detailsStatus === 'pending' ? 'Waiting to be read' : 'Could not read'} · used {s.useCount}×{s.lastUsedAt ? ` · last ${formatWhen(s.lastUsedAt)}` : ''}
            </p>
            {s.detailsStatus === 'error' && <p className="rf-err">{s.details}</p>}
            <button className="btn btn-small" disabled={busy === s.id} onClick={() => act(s.id, () => api(`/api/reels/sheets/${s.id}`, { method: 'PUT', body: JSON.stringify({ active: !s.active }) }), s.active ? `${s.name} paused.` : `${s.name} back in rotation.`)}>
              {s.active ? 'Pause' : 'Use again'}
            </button>
          </div>
        ))}
      </div>
      <div className="form rf-upload">
        <div className="form-row">
          <label>Character name<input value={sheetName} onChange={(e) => setSheetName(e.target.value)} maxLength={60} placeholder="e.g. Chiku" /></label>
          <label>Sheet image (PNG/JPG/WebP, max 8 MB)<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" /></label>
        </div>
        <label>Notes the image can’t show (optional)<input value={sheetNotes} onChange={(e) => setSheetNotes(e.target.value)} maxLength={1000} placeholder="e.g. 3 years old, speaks in short giggly sentences" /></label>
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={busy === 'upload'} onClick={upload}>
            <Icon name="plus" size={16} /> Add character sheet
          </button>
        </div>
      </div>
    </Card>
  );
}

function FlowJob({ reel, sheetName, flowModel, onChange, setNotice }: { reel: Reel; sheetName: string; flowModel: string; onChange: () => void; setNotice: (s: string) => void }) {
  const f = reel.flow!;
  const [busy, setBusy] = useState<number | null>(null);
  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(() => setNotice(`${what} copied.`), () => setNotice('Copy failed — select the text instead.'));
  };
  const send = async (n: number, file: File | undefined) => {
    if (!file) return;
    setBusy(n);
    try {
      const res = await fetch(`${f.uploadUrl}/${n}`, { method: 'PUT', headers: { 'content-type': file.type || 'video/mp4' }, body: file });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setNotice(body.complete ? 'All clips in — joining and checking now (next renderer run, ≤30 min).' : `Clip ${n} uploaded.`);
      onChange();
    } catch (e) {
      setNotice(e instanceof Error ? `Upload failed: ${e.message}` : 'Upload failed');
    } finally {
      setBusy(null);
    }
  };
  return (
    <article className="rf-review rf-flow">
      <div className="rf-review-body">
        <p className="nt-title">{reel.script?.title ?? 'Untitled'} <span className="cx-sub">· {sheetName} · {reel.day} #{reel.slot}</span></p>
        {f.stage === 'awaiting_clips' ? (
          <p className="cx-sub">In Flow: new project → 9:16 → {flowModel} → add the {sheetName} sheet as an ingredient → make clip 1, then extend for clips 2 and 3 → upload each clip here. Link valid until {formatWhen(f.expires)}.</p>
        ) : (
          <p className="cx-sub">{f.stage === 'joining' ? 'Joining and checking the clips now…' : 'All clips received — the renderer joins them on its next run.'}</p>
        )}
        {reel.error && <p className="rf-err">{reel.error}</p>}
        {f.clips.map((c) => (
          <div key={c.n} className="rf-clip">
            <p className="rf-clip-head">
              <strong>Clip {c.n} · {c.duration_s} s</strong>
              {f.uploaded.includes(c.n) ? <span className="pill pill-running">Uploaded</span> : <span className="pill pill-idle">Waiting</span>}
              {c.prompt && <button className="btn btn-small" onClick={() => copy(c.prompt!, `Clip ${c.n} prompt`)}>Copy prompt</button>}
            </p>
            {c.prompt && <p className="rf-prompt">{c.prompt}</p>}
            {f.stage === 'awaiting_clips' && (
              <label className="rf-file">
                {busy === c.n ? 'Uploading…' : f.uploaded.includes(c.n) ? 'Replace clip' : 'Upload clip'}
                <input type="file" accept="video/mp4,video/quicktime,video/webm" disabled={busy !== null} onChange={(e) => send(c.n, e.target.files?.[0])} />
              </label>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function ScriptView({ reel }: { reel: Reel }) {
  return (
    <div className="rf-script">
      {reel.script?.lesson_or_payoff && <p><strong>Payoff:</strong> {reel.script.lesson_or_payoff}</p>}
      {(reel.script?.scenes ?? []).map((s) => (
        <div key={s.n}>
          <p><strong>Scene {s.n} · {s.duration_s}s</strong> — {s.setting} · {s.camera}</p>
          <ul>
            {(s.beats ?? []).map((b, i) => (
              <li key={i}>{b.t}: {b.action}{b.dialogue ? ` — ${b.dialogue}` : ''}{b.sfx ? ` [${b.sfx}]` : ''}</li>
            ))}
          </ul>
          {s.music && <p className="cx-sub">Music: {s.music} · Ends on: {s.final_frame}</p>}
        </div>
      ))}
    </div>
  );
}
