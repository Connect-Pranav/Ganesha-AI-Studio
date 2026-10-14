// Signature Voice Library + Smart Voice Director. A profile is descriptive until a real provider
// voice is configured; previews play only real audio returned by the provider.
import { useMemo, useState } from 'react';
import { Card, EmptyState } from '../ui';
import { studio, voices, money, useLoad, type VoiceProfile, type VoiceRec } from '../../services/cboService';
import { Gate, Honest, Pill, useAction } from './common';

type Filter = 'all' | 'male' | 'female' | 'child' | 'speech' | 'singing' | 'favorite';

export function VoiceLibrary() {
  const l = useLoad(() => voices.list());
  const [filter, setFilter] = useState<Filter>('all');
  const profiles = l.data?.profiles ?? [];
  const shown = profiles.filter((p) => (filter === 'all' ? true : filter === 'favorite' ? p.favorite : filter === 'speech' || filter === 'singing' ? p.modes.includes(filter) : p.gender === filter));
  return (
    <Gate title="Voice Library" locked={l.locked} ready={Boolean(l.data)} error={l.error} onRetry={l.reload}>
      <Director profiles={profiles} />
      <Card title={`Signature voices (${profiles.length})`}>
        <div className="tabs" role="tablist" aria-label="Filter voices">
          {(['all', 'male', 'female', 'child', 'speech', 'singing', 'favorite'] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'child' ? 'kids' : f}
            </button>
          ))}
        </div>
        <div className="cx-voice-grid">
          {shown.map((p) => (
            <VoiceCard key={p.id} p={p} onChange={(list) => l.setData({ profiles: list })} />
          ))}
        </div>
        <Honest>All 10 profiles are original creative directions inspired by broad Indian vocal traditions. They are not clones of, and do not imitate, any specific singer. “Descriptive” means direction only; no audio is produced until a provider voice is configured and works.</Honest>
      </Card>
    </Gate>
  );
}

function capPills(p: VoiceProfile) {
  const a = p.availability;
  return (
    <div className="cx-pills">
      <Pill cls="pill-idle">Descriptive</Pill>
      <Pill cls={a.configuredProviderVoice ? 'pill-running' : 'pill-idle'}>{a.configuredProviderVoice ? `Voice: ${p.provider}/${p.providerVoiceId}` : 'No provider voice'}</Pill>
      <Pill cls={a.speechSynthesis ? 'pill-running' : 'pill-idle'}>{a.speechSynthesis ? 'Speech ready' : 'No speech'}</Pill>
      <Pill cls="pill-idle">{a.singing ? 'Singing ready' : 'No singing provider'}</Pill>
    </div>
  );
}

function VoiceCard({ p, onChange }: { p: VoiceProfile; onChange: (l: VoiceProfile[]) => void }) {
  const act = useAction();
  const [edit, setEdit] = useState(false);
  const [provider, setProvider] = useState(p.provider ?? 'gemini_tts');
  const [voiceId, setVoiceId] = useState(p.providerVoiceId ?? '');
  const [audio, setAudio] = useState<string | null>(null);
  const preview = () =>
    act.run('preview', async () => {
      const r = await voices.synthesize(p.id, p.sampleScript.slice(0, 400));
      setAudio(pcmToWavUrl(r.audioBase64, r.mimeType));
    });
  return (
    <article className="cx-voice">
      <header>
        <p className="cx-voice-id">{p.id}</p>
        <h3>{p.name}</h3>
        <button className={`cx-fav ${p.favorite ? 'on' : ''}`} aria-pressed={p.favorite} aria-label={p.favorite ? 'Remove favourite' : 'Mark favourite'} onClick={() => act.run('fav', async () => onChange((await voices.update(p.id, { favorite: !p.favorite })).profiles))}>
          ★
        </button>
      </header>
      <p className="cx-sub">
        {p.gender === 'child' ? 'Kids' : p.gender} · {p.language} · {p.accent} · {p.modes.join(' + ')}
      </p>
      <p>{p.direction}</p>
      <dl className="cx-voice-dl">
        <dt>Pitch & pacing</dt>
        <dd>{p.pitchPacing}</dd>
        <dt>Emotional range</dt>
        <dd>{p.emotionalRange.join(', ')}</dd>
        <dt>Use for</dt>
        <dd>{p.useCases.join(' · ')}</dd>
        <dt>Sample script</dt>
        <dd>
          <em>{p.sampleScript}</em>
        </dd>
      </dl>
      {capPills(p)}
      {p.assignments.length > 0 && <p className="cx-sub">Assigned: {p.assignments.map((a) => `${a.scope} ${a.scopeRef.slice(0, 12)} · ${a.role}${a.locked ? ' 🔒' : ''}`).join('; ')}</p>}
      <details className="cx-details">
        <summary>Limits</summary>
        <ul>
          {p.availability.limits.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
      <div className="cx-actions">
        {p.availability.previewable && p.previewRef && (
          <a className="btn btn-small" href={p.previewRef} target="_blank" rel="noreferrer">
            Open preview
          </a>
        )}
        {p.availability.speechSynthesis && (
          <button className="btn btn-small btn-primary" onClick={preview} disabled={act.busy === 'preview'}>
            {act.busy === 'preview' ? 'Generating…' : 'Generate preview (uses API)'}
          </button>
        )}
        <button className="btn btn-small" onClick={() => setEdit(!edit)}>
          {edit ? 'Close' : 'Configure voice'}
        </button>
      </div>
      {audio && <audio controls src={audio} className="cx-audio" />}
      {edit && (
        <form
          className="form cx-top"
          onSubmit={(e) => {
            e.preventDefault();
            act.run('save', async () => onChange((await voices.update(p.id, { provider: provider || null, providerVoiceId: voiceId.trim() || null })).profiles), () => setEdit(false));
          }}
        >
          <label>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="gemini_tts">gemini_tts (Gemini API speech)</option>
              <option value="manual">manual (record / other tool)</option>
            </select>
          </label>
          <label>
            Provider voice name / ID
            <input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} placeholder="from the provider’s voice list" />
          </label>
          <button className="btn btn-small btn-primary" disabled={act.busy === 'save'}>
            Save
          </button>
        </form>
      )}
      {act.error && <p className="form-error">{act.error}</p>}
    </article>
  );
}

/** Gemini TTS returns raw 16-bit PCM; wrap it in a WAV header so the browser can play it. */
function pcmToWavUrl(b64: string, mime: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (!/L16|pcm/i.test(mime)) return URL.createObjectURL(new Blob([bytes], { type: mime }));
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  const h = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  h.setUint32(4, 36 + bytes.length, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true);
  h.setUint16(22, 1, true);
  h.setUint32(24, rate, true);
  h.setUint32(28, rate * 2, true);
  h.setUint16(32, 2, true);
  h.setUint16(34, 16, true);
  w(36, 'data');
  h.setUint32(40, bytes.length, true);
  return URL.createObjectURL(new Blob([h.buffer, bytes], { type: 'audio/wav' }));
}

function Director({ profiles }: { profiles: VoiceProfile[] }) {
  const act = useAction();
  const prods = useLoad(() => studio.productions());
  const [brief, setBrief] = useState('');
  const [brand, setBrand] = useState('littleloop');
  const [contentType, setContentType] = useState('reel');
  const [vocal, setVocal] = useState('');
  const [project, setProject] = useState('');
  const [recs, setRecs] = useState<{ recommendations: VoiceRec[]; notes: string[] } | null>(null);
  const [override, setOverride] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const brandProds = (prods.data?.productions ?? []).filter((p) => p.brand === brand);
  return (
    <Card title="Smart Voice Director">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          act.run('rec', async () => {
            setRecs(await voices.recommend({ brief, brand, contentType, vocalRequirement: vocal || undefined, projectRef: project || undefined }));
            setOverride({});
          });
        }}
      >
        <label>
          Brief
          <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Toddler tries to feed the cat, dad panics, mom laughs — 20s Reel" required maxLength={4000} />
        </label>
        <div className="form-row cx-wrap">
          <label>
            Brand
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="littleloop">LittleLoop</option>
              <option value="sunverse">Sunverse</option>
              <option value="foliocraft">Foliocraft</option>
              <option value="studio">Studio</option>
            </select>
          </label>
          <label>
            Content
            <select value={contentType} onChange={(e) => setContentType(e.target.value)}>
              {['reel', 'short', 'long', 'documentary', 'music_video', 'song', 'ad', 'vlog', 'animation'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Vocal rule
            <select value={vocal} onChange={(e) => setVocal(e.target.value)}>
              <option value="">From brief</option>
              <option value="male_only">Male only</option>
              <option value="female_only">Female only</option>
              <option value="duet">Duet</option>
            </select>
          </label>
          <label>
            Project (to keep voices consistent)
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">None</option>
              {brandProds.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn btn-small btn-primary" disabled={act.busy === 'rec' || !brief.trim()}>
          {act.busy === 'rec' ? 'Matching…' : 'Recommend voices'}
        </button>
      </form>
      {act.error && <p className="form-error">{act.error}</p>}
      {recs && (
        <div className="cx-top">
          {recs.notes.map((n) => (
            <p key={n} className="cx-sub">
              {n}
            </p>
          ))}
          {recs.recommendations.length === 0 ? (
            <EmptyState title="No voices needed." hint="Nothing was added that the brief didn’t ask for." />
          ) : (
            <ul className="cx-list">
              {recs.recommendations.map((r) => {
                const chosen = override[r.role] ?? r.profileId ?? '';
                return (
                  <li key={r.role} className="cx-rec">
                    <div className="cx-li-main">
                      <p>
                        <strong>{r.role}</strong> → {byId.get(chosen)?.name ?? '—'} <span className="cx-sub">({chosen})</span> {r.matchScore !== undefined && <Pill cls="pill-idle">match {r.matchScore}</Pill>} {r.locked && <Pill cls="pill-running">approved 🔒</Pill>}
                      </p>
                      <p className="cx-sub">{r.reason}</p>
                      {r.delivery && <p className="cx-sub">Delivery: {r.delivery}</p>}
                      {r.pronunciation && <p className="cx-sub">Pronunciation: {r.pronunciation}</p>}
                      <p className="cx-sub">
                        Method: {r.generationMethod} · Est. cost (sample): {r.estimatedCost ? money(r.estimatedCost.inr, r.estimatedCost.usd) : '—'}
                      </p>
                      {r.limitations?.slice(0, 2).map((x) => (
                        <p key={x} className="cx-warn-text">
                          {x}
                        </p>
                      ))}
                    </div>
                    <div className="cx-actions cx-col-actions">
                      <label className="cx-inline">
                        <span className="sr-only">Override for {r.role}</span>
                        <select value={chosen} onChange={(e) => setOverride({ ...override, [r.role]: e.target.value })}>
                          {[r.profileId, ...r.backups.map((b) => b.profileId), ...profiles.map((p) => p.id)]
                            .filter((v, i, a) => v && a.indexOf(v) === i)
                            .map((id) => (
                              <option key={id!} value={id!}>
                                {id} {byId.get(id!)?.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button
                        className="btn btn-small btn-primary"
                        disabled={!project || !chosen || act.busy === r.role}
                        title={project ? '' : 'Choose a project to save voices to'}
                        onClick={() =>
                          act.run(r.role, async () => {
                            const mode = r.mode ?? 'speech';
                            try {
                              await voices.assign({ scope: 'project', scopeRef: project, role: r.role, profileId: chosen, mode });
                            } catch (e) {
                              if (e instanceof Error && /confirmReplace/.test(e.message)) {
                                const reason = window.prompt(`${r.role} already has an approved voice. Reason for replacing it?`);
                                if (!reason) throw new Error('Replacement cancelled — the approved voice is unchanged.');
                                await voices.assign({ scope: 'project', scopeRef: project, role: r.role, profileId: chosen, mode, confirmReplace: true, reason });
                              } else throw e;
                            }
                            setMsg(`Saved ${chosen} for ${r.role}. It stays locked for this project.`);
                          })
                        }
                      >
                        Approve for project
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {msg && <p className="cx-ok">{msg}</p>}
        </div>
      )}
    </Card>
  );
}
