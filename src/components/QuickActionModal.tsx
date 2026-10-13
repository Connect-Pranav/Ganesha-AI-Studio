import { useState, type FormEvent } from 'react';
import { Modal } from './AiConnection';
import type { QuickActionKind } from './Widgets';
import type { AgentId, Priority, ProductId, Task } from '../types';

const config: Record<QuickActionKind, { title: string; agent: AgentId; placeholder: string }> = {
  content: { title: 'Create content', agent: 'ganesha', placeholder: 'e.g. Script for episode 20' },
  research: { title: 'Research request', agent: 'narada', placeholder: 'e.g. Trending lullaby formats in India' },
  code: { title: 'Coding task', agent: 'code-shakti', placeholder: 'e.g. Add pricing toggle to Foliocraft' },
  analytics: { title: 'Analytics report', agent: 'ganesha', placeholder: 'e.g. Weekly Sunverse channel report' },
};

export function QuickActionModal({
  kind,
  defaultProduct,
  onClose,
  onCreate,
}: {
  kind: QuickActionKind;
  defaultProduct: ProductId | 'studio';
  onClose: () => void;
  onCreate: (task: Omit<Task, 'id' | 'status'>) => void;
}) {
  const c = config[kind];
  const [title, setTitle] = useState('');
  const [product, setProduct] = useState<ProductId | 'studio'>(defaultProduct);
  const [priority, setPriority] = useState<Priority>('medium');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) {
      setError('Please describe the task in at least 3 characters.');
      return;
    }
    onCreate({ title: title.trim(), product, priority, agent: c.agent });
  };

  return (
    <Modal title={c.title} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <label>
          Task
          <input
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError('');
            }}
            placeholder={c.placeholder}
            aria-invalid={!!error}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-row">
          <label>
            Brand
            <select value={product} onChange={(e) => setProduct(e.target.value as ProductId | 'studio')}>
              <option value="littleloop">LittleLoop</option>
              <option value="sunverse">Sunverse</option>
              <option value="foliocraft">Foliocraft</option>
              <option value="studio">Studio (shared)</option>
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>
        <p className="modal-note">
          Opens a pre-filled goal in your private vault. Submit it there and GANESHA picks it up on its next run.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Open goal in vault
          </button>
        </div>
      </form>
    </Modal>
  );
}
