// Character & Asset Library: persistent characters per brand with reference links and a locked voice.
import { useState } from 'react';
import { Card, EmptyState } from '../ui';
import { studio, voices, useLoad, type Character } from '../../services/cboService';
import { BRANDS, Gate, Honest, Pill, useAction } from './common';
import { SheetUploader } from './StudioDesk';
import { SheetAgent } from './SheetAgent';

const EMPTY = { name: '', description: '', appearance: '', wardrobe: '', personality: '', language: '', styleConstraints: '', refs: '' };

export function CharactersView() {
  const [brand, setBrand] = useState('littleloop');
  const l = useLoad(() => studio.characters(brand), [brand]);
  const v = useLoad(() => voices.list());
  const [edit, setEdit] = useState<Character | 'new' | null>(null);
  const [sheetsKey, setSheetsKey] = useState(0);
  return (
    <Gate title="Characters & Assets" locked={l.locked} ready={Boolean(l.data)} error={l.error} onRetry={l.reload}>
      <div className="tabs" role="tablist" aria-label="Brand">
        {BRANDS.map((b) => (
          <button key={b.id} role="tab" aria-selected={brand === b.id} className={`tab ${brand === b.id ? 'active' : ''}`} onClick={() => (setBrand(b.id), setEdit(null))}>
            {b.name}
          </button>
        ))}
      </div>
      {brand === 'littleloop' && <SheetAgent onSheetAdded={() => setSheetsKey((k) => k + 1)} />}
      {brand === 'littleloop' && <SheetUploader key={sheetsKey} />}
      <Card title="Detailed characters (optional)" action={<button className="btn btn-small" onClick={() => setEdit('new')}>+ Detailed character</button>}>
        {edit && <CharacterForm key={edit === 'new' ? 'new' : edit.id} brand={brand} c={edit === 'new' ? null : edit} onDone={() => (setEdit(null), l.reload())} />}
        {(l.data?.characters ?? []).length === 0 ? (
          <EmptyState title="No characters for this brand yet." hint="Approved characters are reused across episodes instead of being recreated." />
        ) : (
          <div className="cx-voice-grid">
            {l.data!.characters.map((c) => (
              <article key={c.id} className="cx-voice">
                <header>
                  <h3>{c.name}</h3>
                  <Pill cls={c.approved ? 'pill-running' : 'pill-warn'}>{c.approved ? 'Approved' : 'Draft'}</Pill>
                </header>
                {c.description && <p>{c.description}</p>}
                <dl className="cx-voice-dl">
                  {c.appearance && (
                    <>
                      <dt>Appearance</dt>
                      <dd>{c.appearance}</dd>
                    </>
                  )}
                  {c.wardrobe && (
                    <>
                      <dt>Wardrobe</dt>
                      <dd>{c.wardrobe}</dd>
                    </>
                  )}
                  {c.personality && (
                    <>
                      <dt>Personality</dt>
                      <dd>{c.personality}</dd>
                    </>
                  )}
                  {c.style_constraints && (
                    <>
                      <dt>Style rules</dt>
                      <dd>{c.style_constraints}</dd>
                    </>
                  )}
                  <dt>References</dt>
                  <dd>
                    {c.reference_assets.length === 0
                      ? 'None — add approved reference images'
                      : c.reference_assets.map((r, i) => (
                          <a key={r} href={r} target="_blank" rel="noreferrer">
                            ref {i + 1}{' '}
                          </a>
                        ))}
                  </dd>
                  <dt>Voice</dt>
                  <dd>{c.voices.find((x) => x.role === 'main')?.profile_id ?? 'Not assigned'}</dd>
                </dl>
                <CharacterVoice c={c} profiles={v.data?.profiles.map((p) => ({ id: p.id, name: p.name, modes: p.modes })) ?? []} onDone={l.reload} />
                <button className="btn btn-small" onClick={() => setEdit(c)}>
                  Edit
                </button>
              </article>
            ))}
          </div>
        )}
        <Honest>Reference links point to files in your own storage (no images are uploaded to the studio). Continuity checks flag problems in records and prompts; they cannot guarantee a video model keeps a face identical.</Honest>
      </Card>
    </Gate>
  );
}

function CharacterVoice({ c, profiles, onDone }: { c: Character; profiles: { id: string; name: string; modes: string[] }[]; onDone: () => void }) {
  const act = useAction();
  const cur = c.voices.find((x) => x.role === 'main')?.profile_id ?? '';
  const [sel, setSel] = useState(cur);
  return (
    <div className="cx-actions">
      <label className="cx-inline">
        <span className="sr-only">Voice for {c.name}</span>
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">Choose voice…</option>
          {profiles
            .filter((p) => p.modes.includes('speech'))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} {p.name}
              </option>
            ))}
        </select>
      </label>
      <button
        className="btn btn-small"
        disabled={!sel || sel === cur || !!act.busy}
        onClick={() =>
          act.run('v', async () => {
            const body = { scope: 'character', scopeRef: c.id, role: 'main', profileId: sel, mode: 'speech' };
            if (cur) {
              const reason = window.prompt(`${c.name} already uses ${cur}. Changing an established voice affects every episode. Reason?`);
              if (!reason) throw new Error('Voice unchanged.');
              await voices.assign({ ...body, confirmReplace: true, reason });
            } else await voices.assign(body);
          }, onDone)
        }
      >
        {cur ? 'Replace voice' : 'Lock voice'}
      </button>
      {act.error && <p className="form-error">{act.error}</p>}
    </div>
  );
}

function CharacterForm({ brand, c, onDone }: { brand: string; c: Character | null; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState(
    c
      ? { name: c.name, description: c.description, appearance: c.appearance, wardrobe: c.wardrobe, personality: c.personality, language: c.language, styleConstraints: c.style_constraints, refs: c.reference_assets.join('\n') }
      : EMPTY,
  );
  const [approved, setApproved] = useState(c?.approved ?? false);
  const save = (confirmChange = false) =>
    act.run('s', async () => {
      const refs = f.refs.split(/\s+/).map((x) => x.trim()).filter(Boolean);
      const body: Record<string, unknown> = { brand, name: f.name, description: f.description, appearance: f.appearance, wardrobe: f.wardrobe, personality: f.personality, language: f.language, styleConstraints: f.styleConstraints, approved, confirmChange };
      if (!c || refs.join('\n') !== c.reference_assets.join('\n')) body.referenceAssets = refs;
      try {
        await studio.saveCharacter(body, c?.id);
      } catch (e) {
        if (e instanceof Error && /confirmChange/.test(e.message) && window.confirm(`${e.message}\n\nApply the change anyway?`)) await studio.saveCharacter({ ...body, confirmChange: true }, c?.id);
        else throw e;
      }
    }, onDone);
  const field = (k: keyof typeof EMPTY, label: string, area = false) => (
    <label>
      {label}
      {area ? <textarea rows={2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={k === 'name'} />}
    </label>
  );
  return (
    <form
      className="form cx-scene"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="form-row cx-wrap">
        {field('name', 'Name')}
        {field('language', 'Language')}
      </div>
      {field('description', 'Description', true)}
      {field('appearance', 'Face & appearance', true)}
      {field('wardrobe', 'Wardrobe', true)}
      {field('personality', 'Personality', true)}
      {field('styleConstraints', 'Style constraints', true)}
      <label>
        Approved reference image links (https, one per line)
        <textarea rows={2} value={f.refs} onChange={(e) => setF({ ...f, refs: e.target.value })} />
      </label>
      <label className="cx-inline">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> <span>Approved (locks the look for continuity)</span>
      </label>
      <div className="cx-actions">
        <button className="btn btn-small btn-primary" disabled={act.busy === 's'}>
          Save
        </button>
        <button type="button" className="btn btn-small" onClick={onDone}>
          Cancel
        </button>
      </div>
      {act.error && <p className="form-error">{act.error}</p>}
    </form>
  );
}
