// Multi-file upload: pick many files at once, each gets a name taken from its file name (editable
// before upload), then they upload one by one with a status per file. Used for character sheets
// and voice recordings. Also exports InlineRename for renaming items that are already saved.
import { useRef, useState, type ReactNode } from 'react';
import { base, getToken } from '../services/adminService';

/** "chiku_happy-v2.final.png" → "chiku happy v2.final" (extension dropped, _ and - become spaces). */
export function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Adds " 2", " 3"… when a name is already taken (case-insensitive). */
export function uniqueName(name: string, taken: Set<string>): string {
  const base0 = name.trim() || 'Untitled';
  let n = base0;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base0.slice(0, 56)} ${i}`;
  return n;
}

interface Item {
  key: string;
  file: File;
  name: string;
  state: 'ready' | 'uploading' | 'done' | 'failed';
  error?: string;
}

export function BatchUpload({
  accept,
  allowed,
  maxBytes,
  maxLabel,
  takenNames,
  endpoint,
  label,
  button,
  extra,
  mimeOf,
  onUploaded,
}: {
  accept: string;
  allowed: (f: File) => boolean;
  maxBytes: number;
  maxLabel: string;
  takenNames: string[];
  endpoint: (name: string) => string;
  label: string;
  button: string;
  extra?: ReactNode;
  mimeOf?: (f: File) => string;
  onUploaded: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    setNotice(null);
    const taken = new Set([...takenNames, ...items.map((i) => i.name)].map((n) => n.toLowerCase()));
    const next: Item[] = [];
    const skipped: string[] = [];
    for (const f of Array.from(files)) {
      if (!allowed(f)) skipped.push(`${f.name} (type not supported)`);
      else if (f.size > maxBytes) skipped.push(`${f.name} (over ${maxLabel})`);
      else {
        const name = uniqueName(nameFromFile(f.name), taken);
        taken.add(name.toLowerCase());
        next.push({ key: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`, file: f, name, state: 'ready' });
      }
    }
    setItems((x) => [...x, ...next]);
    if (skipped.length) setNotice(`Skipped: ${skipped.join(', ')}`);
    if (inputRef.current) inputRef.current.value = '';
  };

  const uploadAll = async () => {
    const todo = items.filter((i) => i.state === 'ready' || i.state === 'failed');
    if (!todo.length) return;
    const names = todo.map((i) => i.name.trim().toLowerCase());
    if (todo.some((i) => !i.name.trim())) return setNotice('Every file needs a name.');
    if (new Set(names).size !== names.length) return setNotice('Two files have the same name — change one.');
    setBusy(true);
    setNotice(null);
    let ok = 0;
    for (const it of todo) {
      setItems((x) => x.map((i) => (i.key === it.key ? { ...i, state: 'uploading', error: undefined } : i)));
      try {
        const res = await fetch(`${base()}${endpoint(it.name.trim())}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${getToken()}`, 'content-type': mimeOf?.(it.file) || it.file.type || 'application/octet-stream' },
          body: it.file,
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        ok++;
        setItems((x) => x.map((i) => (i.key === it.key ? { ...i, state: 'done' } : i)));
      } catch (e) {
        setItems((x) => x.map((i) => (i.key === it.key ? { ...i, state: 'failed', error: e instanceof Error ? e.message : 'failed' } : i)));
      }
    }
    setBusy(false);
    setNotice(`${ok} of ${todo.length} uploaded.${ok < todo.length ? ' Fix the red ones and press Upload again.' : ''}`);
    if (ok) onUploaded();
    // Clear finished rows shortly after so the list shows only what still needs attention.
    setTimeout(() => setItems((x) => x.filter((i) => i.state !== 'done')), 2500);
  };

  const pending = items.filter((i) => i.state === 'ready' || i.state === 'failed').length;
  return (
    <div className="bu">
      <div className="bu-pick">
        <label className="btn btn-small bu-file">
          {label}
          <input ref={inputRef} type="file" multiple accept={accept} onChange={(e) => add(e.target.files)} />
        </label>
        {extra}
        <span className="cx-sub">Select one or many files (max {maxLabel} each). Names come from the file names — edit any before uploading.</span>
      </div>
      {items.length > 0 && (
        <ul className="bu-list">
          {items.map((it) => (
            <li key={it.key} className={`bu-item bu-${it.state}`}>
              <input
                value={it.name}
                maxLength={60}
                disabled={it.state === 'uploading' || it.state === 'done'}
                onChange={(e) => setItems((x) => x.map((i) => (i.key === it.key ? { ...i, name: e.target.value } : i)))}
                aria-label={`Name for ${it.file.name}`}
              />
              <span className="cx-sub bu-meta" title={it.file.name}>
                {it.file.name} · {fmtSize(it.file.size)}
              </span>
              <span className="bu-state">{it.state === 'uploading' ? 'Uploading…' : it.state === 'done' ? '✅ Saved' : it.state === 'failed' ? `⚠️ ${it.error}` : ''}</span>
              {(it.state === 'ready' || it.state === 'failed') && !busy && (
                <button type="button" className="btn btn-small" onClick={() => setItems((x) => x.filter((i) => i.key !== it.key))} aria-label={`Remove ${it.file.name}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {pending > 0 && (
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={busy} onClick={uploadAll}>
            {busy ? 'Uploading…' : `${button} (${pending})`}
          </button>
        </div>
      )}
      {notice && <p className="drawer-notice" role="status">{notice}</p>}
    </div>
  );
}

/** Click ✏️ to rename an item that is already saved; PUTs { name } to the given path. */
export function InlineRename({ name, path, onSaved }: { name: string; path: string; onSaved: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!editing)
    return (
      <span className="bu-name">
        <span className="nt-title">{name}</span>
        <button type="button" className="icon-btn bu-edit" onClick={() => (setVal(name), setErr(null), setEditing(true))} aria-label={`Rename ${name}`} title="Rename">
          ✏️
        </button>
      </span>
    );
  const save = async () => {
    const v = val.trim();
    if (!v) return setErr('Name is required');
    if (v === name) return setEditing(false);
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${base()}${path}`, { method: 'PUT', headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: v }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      onSaved(v);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="bu-rename">
      <input
        value={val}
        maxLength={60}
        autoFocus
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label="New name"
      />
      <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={save}>Save</button>
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      {err && <span className="form-error">{err}</span>}
    </span>
  );
}
