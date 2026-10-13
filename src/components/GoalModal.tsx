// Start a goal inside Ganesha: creates a workflow on the studio's own backend.
// No GitHub: GANESHA runs it, approvals show in the bell, deliverables open in the panel.
import { useState, type FormEvent } from 'react';
import { Modal } from './AiConnection';
import { Unlock } from './NotificationCenter';
import { api, getToken } from '../services/adminService';

export const GOAL_TYPES: { template: string; label: string; brand: string; placeholder: string }[] = [
  { template: 'sunverse_song_release', label: 'Sunverse song', brand: 'Sunverse', placeholder: 'e.g. Hindi monsoon lofi song about missing home' },
  { template: 'littleloop_episode', label: 'LittleLoop episode', brand: 'LittleLoop', placeholder: 'e.g. Noomi learns colours with balloons' },
  { template: 'foliocraft_feature', label: 'Foliocraft feature', brand: 'Foliocraft', placeholder: 'e.g. Add a dark-mode toggle to every theme' },
  { template: 'research_brief', label: 'Research brief', brand: 'Studio', placeholder: 'e.g. What kids’ Shorts formats are growing in India?' },
  { template: 'ops_weekly_review', label: 'Weekly ops review', brand: 'Studio', placeholder: 'e.g. Review this week’s runs, costs and failures' },
];

/** Open the goal form from anywhere: window.dispatchEvent(new CustomEvent(NEW_GOAL_EVENT, { detail: { template } })) */
export const NEW_GOAL_EVENT = 'ganesha:new-goal';
export const openNewGoal = (template?: string) => window.dispatchEvent(new CustomEvent(NEW_GOAL_EVENT, { detail: { template } }));

export function GoalModal({ initialTemplate, onClose, onCreated }: { initialTemplate?: string; onClose: () => void; onCreated: (title: string) => void }) {
  const [template, setTemplate] = useState(initialTemplate ?? GOAL_TYPES[0].template);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(Boolean(getToken()));
  const type = GOAL_TYPES.find((g) => g.template === template) ?? GOAL_TYPES[0];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) return setError('Give the goal a short title (at least 3 characters).');
    setBusy(true);
    setError('');
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      await api('/api/workflows', { method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify({ template, title: title.trim(), goal: details.trim() }) });
      onCreated(title.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the goal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New goal" onClose={onClose}>
      {!unlocked ? (
        <Unlock onUnlocked={() => setUnlocked(true)} />
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <label>
            Type
            <select id="goal-type" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {GOAL_TYPES.map((g) => (
                <option key={g.template} value={g.template}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input id="goal-title" autoFocus value={title} onChange={(e) => (setTitle(e.target.value), setError(''))} placeholder={type.placeholder} maxLength={120} />
          </label>
          <label>
            Details (optional)
            <textarea id="goal-details" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Mood, audience, length, must include, must avoid…" maxLength={4000} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <p className="modal-note">GANESHA assigns the {type.brand} team right away. Progress shows on the Pipelines page; anything that needs you appears in the 🔔 bell.</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Starting…' : 'Start goal'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
