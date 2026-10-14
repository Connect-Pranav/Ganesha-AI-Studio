// AI Video & Filmmaking Studio: four pillars (learning + tools), productions, scenes with
// version history, Google Flow manual handoff, output registration and continuity checks.
import { useState } from 'react';
import { Card, EmptyState, productNames } from '../ui';
import { dateShort, studio, useLoad, type Character, type ProductionDetail, type Scene } from '../../services/cboService';
import { BRANDS, Gate, Honest, Pill, useAction } from './common';
import { PILLARS } from './learning';

const PROMPT_FIELDS: [string, string][] = [
  ['subject', 'Subject'],
  ['action', 'Action'],
  ['scene', 'Setting'],
  ['composition', 'Composition'],
  ['camera', 'Camera'],
  ['motion', 'Motion'],
  ['lighting', 'Lighting'],
  ['style', 'Style'],
  ['audio', 'Audio / dialogue'],
  ['duration', 'Duration'],
  ['aspectRatio', 'Aspect ratio'],
  ['constraints', 'Constraints'],
];
const FORMATS = ['instagram_reel', 'youtube_short', 'youtube_long', 'music_video', 'film', 'ad', 'graphic_novel'];

export function VideoStudio() {
  const [tab, setTab] = useState<'productions' | 'learn' | 'prompt'>('productions');
  const l = useLoad(() => studio.productions());
  return (
    <Gate title="AI Video & Filmmaking Studio" locked={l.locked} ready={Boolean(l.data)} error={l.error} onRetry={l.reload}>
      <div className="tabs" role="tablist" aria-label="Studio sections">
        {(
          [
            ['productions', 'Productions'],
            ['learn', 'Four pillars · learn'],
            ['prompt', 'Prompt builder'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'learn' && <Learn />}
      {tab === 'prompt' && <PromptBuilder />}
      {tab === 'productions' && l.data && <Productions data={l.data} reload={l.reload} />}
      <Honest>Google Flow has no public API (checked 2026-10-14): scenes are handed off with exact steps, you generate in Flow, and register the output link. A scene counts as generated only when a real file link is registered.</Honest>
    </Gate>
  );
}

function Learn() {
  const p = useLoad(() => studio.learning());
  const act = useAction();
  const status = new Map((p.data?.progress ?? []).map((x) => [x.module_id, x.status]));
  const total = PILLARS.reduce((a, x) => a + x.modules.length, 0);
  const done = [...status.values()].filter((s) => s === 'done').length;
  return (
    <>
      <p className="cx-sub">
        Progress: {done}/{total} modules done
      </p>
      {PILLARS.map((pl, i) => (
        <Card key={pl.id} title={`Pillar ${i + 1} — ${pl.title}`}>
          <div className="cx-learn">
            {pl.modules.map((m) => {
              const st = status.get(m.id) ?? 'not_started';
              return (
                <details key={m.id} className="cx-learn-item">
                  <summary>
                    <span>{m.title}</span> <Pill cls={st === 'done' ? 'pill-running' : st === 'in_progress' ? 'pill-warn' : 'pill-idle'}>{st.replace('_', ' ')}</Pill>
                  </summary>
                  <ul>
                    {m.points.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  <p>
                    <strong>Exercise:</strong> {m.exercise}
                  </p>
                  <div className="cx-actions">
                    {(['in_progress', 'done'] as const).map((s) => (
                      <button key={s} className="btn btn-small" disabled={st === s || !!act.busy} onClick={() => act.run(m.id, () => studio.setLearning(m.id, s), p.reload)}>
                        Mark {s.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </Card>
      ))}
    </>
  );
}

function PromptFields({ fields, setFields }: { fields: Record<string, string>; setFields: (f: Record<string, string>) => void }) {
  return (
    <div className="cx-prompt-grid">
      {PROMPT_FIELDS.map(([k, label]) => (
        <label key={k}>
          {label}
          <input value={fields[k] ?? ''} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} maxLength={600} />
        </label>
      ))}
    </div>
  );
}

function PromptBuilder() {
  const [fields, setFields] = useState<Record<string, string>>(PILLARS[0].modules[0].prompt ?? {});
  const [out, setOut] = useState('');
  const act = useAction();
  return (
    <Card title="Prompt-to-video builder">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          act.run('b', async () => setOut((await studio.prompt(fields, [])).prompt));
        }}
      >
        <PromptFields fields={fields} setFields={setFields} />
        <button className="btn btn-small btn-primary">Build prompt</button>
      </form>
      {out && (
        <div className="cx-top">
          <pre className="cx-pre">{out}</pre>
          <button className="btn btn-small" onClick={() => navigator.clipboard?.writeText(out)}>
            Copy
          </button>
        </div>
      )}
      {act.error && <p className="form-error">{act.error}</p>}
    </Card>
  );
}

function Productions({ data, reload }: { data: { productions: ProductionDetail['production'][]; pillars: Record<string, string[]> }; reload: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <NewProduction pillars={data.pillars} onCreated={(id) => (reload(), setOpen(id))} />
      <Card title="Productions">
        {data.productions.length === 0 ? (
          <EmptyState title="No productions yet." hint="Create one above: a Reel, Short, music video, film, ad or graphic novel." />
        ) : (
          <ul className="cx-list">
            {data.productions.map((p) => (
              <li key={p.id} className="cx-col-li">
                <div className="cx-row-between">
                  <div className="cx-li-main">
                    <p>
                      <strong>{p.title}</strong> <Pill cls="pill-idle">{p.status}</Pill>
                    </p>
                    <p className="cx-sub">
                      {productNames[p.brand as keyof typeof productNames]} · {p.format.replace(/_/g, ' ')} · {p.pillar}/{p.method.replace(/_/g, ' ')} · {p.approvedScenes}/{p.scenes} scenes approved
                      {p.requirements?.vocalRequirement ? ` · ${p.requirements.vocalRequirement.replace('_', '-')}` : ''}
                    </p>
                  </div>
                  <button className="btn btn-small" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    {open === p.id ? 'Close' : 'Open'}
                  </button>
                </div>
                {open === p.id && <ProductionPanel id={p.id} onChanged={reload} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function NewProduction({ pillars, onCreated }: { pillars: Record<string, string[]>; onCreated: (id: string) => void }) {
  const act = useAction();
  const [f, setF] = useState({ brand: 'littleloop', title: '', format: 'instagram_reel', pillar: 'production', method: 'kids_episode', brief: '', vocal: 'none' });
  return (
    <Card title="New production">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          act.run('c', async () => {
            const r = await studio.createProduction({ brand: f.brand, title: f.title, format: f.format, pillar: f.pillar, method: f.method, brief: f.brief, requirements: { vocalRequirement: f.vocal } });
            setF({ ...f, title: '', brief: '' });
            onCreated(r.id);
          });
        }}
      >
        <div className="form-row cx-wrap">
          <label>
            Brand
            <select value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })}>
              {BRANDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={120} />
          </label>
          <label>
            Format
            <select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
              {FORMATS.map((x) => (
                <option key={x} value={x}>
                  {x.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row cx-wrap">
          <label>
            Pillar
            <select value={f.pillar} onChange={(e) => setF({ ...f, pillar: e.target.value, method: pillars[e.target.value][0] })}>
              {Object.keys(pillars).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Method
            <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {(pillars[f.pillar] ?? []).map((x) => (
                <option key={x} value={x}>
                  {x.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vocal requirement
            <select value={f.vocal} onChange={(e) => setF({ ...f, vocal: e.target.value })}>
              <option value="none">None</option>
              <option value="male_only">Male only</option>
              <option value="female_only">Female only</option>
              <option value="duet">Duet</option>
            </select>
          </label>
        </div>
        <label>
          Brief
          <textarea rows={2} value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} maxLength={4000} />
        </label>
        <button className="btn btn-small btn-primary" disabled={act.busy === 'c'}>
          Create production
        </button>
        {act.error && <p className="form-error">{act.error}</p>}
      </form>
    </Card>
  );
}

function ProductionPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const d = useLoad(() => studio.production(id), [id]);
  const chars = useLoad(() => studio.characters(), []);
  if (!d.data) return <p className="cx-sub">{d.error ?? 'Loading…'}</p>;
  const brandChars = (chars.data?.characters ?? []).filter((c) => c.brand === d.data!.production.brand);
  const reload = () => (d.reload(), onChanged());
  const { continuity } = d.data;
  return (
    <div className="cx-panel">
      {d.data.production.brief && <p className="cx-sub">Brief: {d.data.production.brief}</p>}
      <div className={`cx-continuity ${continuity.ok ? '' : 'bad'}`}>
        <strong>Continuity: {continuity.ok ? 'no blocking issues' : 'issues found'}</strong>
        {continuity.issues.length > 0 && (
          <ul>
            {continuity.issues.map((i, n) => (
              <li key={n} className={`cx-lvl-${i.level}`}>
                {i.level.toUpperCase()}: {i.message}
              </li>
            ))}
          </ul>
        )}
        <p className="cx-sub">{continuity.note}</p>
      </div>
      {d.data.scenes.map((s) => (
        <SceneCard key={s.id} s={s} chars={brandChars} detail={d.data!} reload={reload} />
      ))}
      <AddScene productionId={id} chars={brandChars} onAdded={reload} />
    </div>
  );
}

function SceneCard({ s, chars, detail, reload }: { s: Scene; chars: Character[]; detail: ProductionDetail; reload: () => void }) {
  const act = useAction();
  const [handoff, setHandoff] = useState<{ jobId: string; prompt: string; steps: string[]; voiceDirection: string[] } | null>(null);
  const [link, setLink] = useState('');
  const [regen, setRegen] = useState(false);
  const [reason, setReason] = useState('');
  const [prompt, setPrompt] = useState(s.prompt);
  const job = detail.jobs.find((j) => j.scene_id === s.id && j.status === 'manual_handoff');
  const assets = detail.assets.filter((a) => a.scene_id === s.id);
  const name = (cid: string) => chars.find((c) => c.id === cid)?.name ?? cid;
  return (
    <article className="cx-scene">
      <header className="cx-row-between">
        <p>
          <strong>
            {s.ord}. {s.title}
          </strong>{' '}
          <span className="cx-sub">v{s.version}</span> <Pill cls={s.status === 'approved' ? 'pill-running' : s.status === 'rejected' ? 'pill-error' : 'pill-idle'}>{s.status.replace('_', ' ')}</Pill>
        </p>
      </header>
      <pre className="cx-pre">{s.prompt}</pre>
      {s.characters.length > 0 && <p className="cx-sub">Voices: {s.characters.map((c) => `${name(c)} → ${s.voice[c] ?? 'not set'}`).join(' · ')}</p>}
      {assets.length > 0 && (
        <p className="cx-sub">
          Outputs:{' '}
          {assets.map((a) => (
            <a key={a.id} href={a.external_ref} target="_blank" rel="noreferrer">
              {a.kind} ({a.status})
            </a>
          ))}
        </p>
      )}
      <div className="cx-actions">
        {!job && s.status !== 'approved' && (
          <button className="btn btn-small" disabled={!!act.busy} onClick={() => act.run('h', async () => setHandoff(await studio.flowHandoff(s.id)), reload)}>
            Prepare Flow handoff
          </button>
        )}
        {s.status === 'generated' && (
          <>
            <button className="btn btn-small btn-primary" onClick={() => act.run('a', () => studio.sceneStatus(s.id, 'approved'), reload)}>
              Approve scene
            </button>
            <button className="btn btn-small" onClick={() => act.run('r', () => studio.sceneStatus(s.id, 'rejected'), reload)}>
              Reject
            </button>
          </>
        )}
        <button className="btn btn-small" onClick={() => setRegen(!regen)}>
          Regenerate this scene
        </button>
      </div>
      {(handoff || job) && (
        <div className="cx-handoff">
          <p>
            <strong>Manual handoff to Google Flow</strong>
          </p>
          <ol>
            {(handoff?.steps ?? job!.request.steps).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
          {(handoff?.voiceDirection ?? job?.request.voiceDirection ?? []).length > 0 && <p className="cx-sub">Voice direction: {(handoff?.voiceDirection ?? job!.request.voiceDirection).join('; ')}</p>}
          <button className="btn btn-small" onClick={() => navigator.clipboard?.writeText(handoff?.prompt ?? job!.request.prompt)}>
            Copy prompt
          </button>
          <form
            className="form-row cx-wrap cx-top"
            onSubmit={(e) => {
              e.preventDefault();
              act.run('done', () => studio.completeJob(handoff?.jobId ?? job!.id, { status: 'succeeded', externalRef: link }), () => (setLink(''), setHandoff(null), reload()));
            }}
          >
            <label className="cx-grow">
              <span className="sr-only">Output link</span>
              <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https:// link to the downloaded clip (Drive etc.)" required />
            </label>
            <button className="btn btn-small btn-primary">Register output</button>
            <button type="button" className="btn btn-small" onClick={() => act.run('fail', () => studio.completeJob(handoff?.jobId ?? job!.id, { status: 'failed', error: 'Owner reported failure' }), reload)}>
              Mark failed
            </button>
          </form>
        </div>
      )}
      {regen && (
        <form
          className="form cx-top"
          onSubmit={(e) => {
            e.preventDefault();
            act.run('regen', () => studio.regenerate(s.id, { reason, prompt }), () => (setRegen(false), setReason(''), reload()));
          }}
        >
          <label>
            New prompt (characters and voices are kept)
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <label>
            Reason (kept in version history)
            <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
          </label>
          <button className="btn btn-small btn-primary">Save as v{s.version + 1}</button>
        </form>
      )}
      {act.error && <p className="form-error">{act.error}</p>}
    </article>
  );
}

function AddScene({ productionId, chars, onAdded }: { productionId: string; chars: Character[]; onAdded: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn btn-small btn-primary cx-top" onClick={() => setOpen(true)}>
        + Add scene
      </button>
    );
  return (
    <form
      className="form cx-scene"
      onSubmit={(e) => {
        e.preventDefault();
        act.run('add', () => studio.addScene(productionId, { title, characters: sel, fields }), () => (setOpen(false), setTitle(''), setFields({}), setSel([]), onAdded()));
      }}
    >
      <label>
        Scene title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
      </label>
      <fieldset className="cx-fieldset">
        <legend>Characters (approved looks and voices are applied automatically)</legend>
        {chars.length === 0 && <p className="cx-sub">No characters for this brand yet — add them in Characters & Assets.</p>}
        {chars.map((c) => (
          <label key={c.id} className="cx-inline">
            <input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />
            <span>
              {c.name} {c.approved ? '' : '(not approved)'}
            </span>
          </label>
        ))}
      </fieldset>
      <PromptFields fields={fields} setFields={setFields} />
      <div className="cx-actions">
        <button className="btn btn-small btn-primary" disabled={act.busy === 'add'}>
          Add scene
        </button>
        <button type="button" className="btn btn-small" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {act.error && <p className="form-error">{act.error}</p>}
    </form>
  );
}

export { dateShort };
