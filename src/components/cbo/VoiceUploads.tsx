// Uploaded voice recordings (technical id: voice_sample_library): upload many at once, names come
// from the file names (editable), play, rename, delete. Kept per brand so products never mix.
import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, formatWhen } from '../ui';
import { api, base, getToken, AUTH_EVENT } from '../../services/adminService';
import { BatchUpload, InlineRename, fmtSize } from '../BatchUpload';

type Brand = 'studio' | 'littleloop' | 'sunverse' | 'foliocraft';
interface Sample { id: string; brand: Brand; name: string; mime: string; bytes: number; createdAt: string }
const BRANDS: { id: Brand; label: string }[] = [
  { id: 'littleloop', label: 'LittleLoop' },
  { id: 'sunverse', label: 'Sunverse' },
  { id: 'foliocraft', label: 'Foliocraft' },
  { id: 'studio', label: 'Studio (shared)' },
];
const AUDIO = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm', 'audio/flac'];
// Some phones report no type for .m4a/.mp3; fall back on the extension.
const EXT: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' };
const isAudio = (f: File) => AUDIO.includes(f.type) || (!f.type && Boolean(EXT[f.name.split('.').pop()?.toLowerCase() ?? '']));

export function VoiceUploads() {
  const [brand, setBrand] = useState<Brand>('littleloop');
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(!getToken());
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) return setLocked(true);
    setLocked(false);
    try {
      setSamples((await api<{ samples: Sample[] }>(`/api/voices/samples?brand=${brand}`)).samples);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load voices');
    }
  }, [brand]);
  useEffect(() => {
    load();
    window.addEventListener(AUTH_EVENT, load);
    return () => window.removeEventListener(AUTH_EVENT, load);
  }, [load]);
  useEffect(() => () => {
    if (playing) URL.revokeObjectURL(playing.url);
  }, [playing]);

  const play = async (s: Sample) => {
    if (playing?.id === s.id) return setPlaying(null);
    try {
      const res = await fetch(`${base()}/api/voices/samples/${s.id}/audio`, { headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      setPlaying({ id: s.id, url: URL.createObjectURL(await res.blob()) });
    } catch (e) {
      setNotice(`Could not play ${s.name}: ${e instanceof Error ? e.message : 'error'}`);
    }
  };
  const remove = async (s: Sample) => {
    if (!window.confirm(`Delete the voice "${s.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/voices/samples/${s.id}`, { method: 'DELETE' });
      setNotice(`${s.name} deleted.`);
      load();
    } catch (e) {
      setNotice(`Delete failed: ${e instanceof Error ? e.message : 'error'}`);
    }
  };

  const title = 'My voice recordings';
  if (locked) return <Card title={title}><EmptyState title="Unlock the studio to upload voices" hint="Bell → Unlock with your admin token." /></Card>;
  return (
    <Card title={title}>
      <p className="cx-sub">Apni voice files (MP3, M4A, WAV…) ek ya kai ek saath upload karo. Naam file ke naam se aata hai — ✏️ se badal sakte ho. Yeh reference recordings hain; inse kisi ki awaaz clone nahi hoti.</p>
      <div className="tabs" role="tablist" aria-label="Brand">
        {BRANDS.map((b) => (
          <button key={b.id} role="tab" aria-selected={brand === b.id} className={`tab ${brand === b.id ? 'active' : ''}`} onClick={() => (setBrand(b.id), setSamples(null), setPlaying(null))}>
            {b.label}
          </button>
        ))}
      </div>
      <BatchUpload
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.webm,.flac"
        allowed={isAudio}
        mimeOf={(f) => f.type || EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] || ''}
        maxBytes={20 * 1024 * 1024}
        maxLabel="20 MB"
        takenNames={(samples ?? []).map((s) => s.name)}
        endpoint={(name) => `/api/voices/samples?${new URLSearchParams({ name, brand })}`}
        label={`🎙 Choose voice files · ${BRANDS.find((b) => b.id === brand)?.label}`}
        button="Upload voices"
        onUploaded={load}
      />
      {notice && <p className="drawer-notice" role="status">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      {samples && samples.length === 0 && <p className="cx-sub">No voices uploaded for this brand yet.</p>}
      {samples && samples.length > 0 && (
        <ul className="vu-list">
          {samples.map((s) => (
            <li key={s.id} className="vu-item">
              <button type="button" className="btn btn-small" onClick={() => play(s)} aria-label={playing?.id === s.id ? `Stop ${s.name}` : `Play ${s.name}`}>
                {playing?.id === s.id ? '■' : '▶'}
              </button>
              <div className="vu-main">
                <InlineRename name={s.name} path={`/api/voices/samples/${s.id}`} onSaved={(n) => (setNotice(`Renamed to ${n}.`), load())} />
                <span className="cx-sub">{fmtSize(s.bytes)} · added {formatWhen(s.createdAt)}</span>
                {playing?.id === s.id && <audio src={playing.url} controls autoPlay onEnded={() => setPlaying(null)} />}
              </div>
              <button type="button" className="btn btn-small" onClick={() => remove(s)} aria-label={`Delete ${s.name}`}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
