// Owner access to the Worker API from this browser.
// The admin token is typed in by the owner and kept only in this browser's storage.
// It is sent as a Bearer header to this studio's own Worker and nowhere else.
const KEY = 'gas.adminToken';
const WORKER_ORIGIN = 'https://ganesha-studio.connect-pranav09.workers.dev';

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export const AUTH_EVENT = 'ganesha:auth';
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: owner re-enters the token next time */
  }
  // Every page re-reads live studio data when the owner locks or unlocks.
  try {
    window.dispatchEvent(new Event(AUTH_EVENT));
  } catch {
    /* non-browser */
  }
}

export function base(): string {
  try {
    return window.location.hostname.endsWith('github.io') ? WORKER_ORIGIN : '';
  } catch {
    return '';
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}, token = getToken()): Promise<T> {
  if (!token) throw new ApiError(401, 'Locked');
  const res = await fetch(`${base()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export interface Notifications {
  approvals: {
    id: string;
    action: string;
    summary: string;
    created_at: string;
    workflow_id: string;
    task_id: string;
    workflow_title: string;
    brand: string;
    agent_id: string;
    deliverable: string;
    output_artifact: string | null;
  }[];
  external: { task_id: string; step_key: string; deliverable: string; agent_id: string; updated_at: string; workflow_id: string; workflow_title: string; brand: string }[];
  failures: { task_id: string; step_key: string; agent_id: string; error: string | null; updated_at: string; workflow_id: string; workflow_title: string; brand: string }[];
  events: { id: number; workflow_id: string | null; task_id: string | null; kind: string; message: string; created_at: string }[];
  counts: { approvals: number; external: number; failures: number };
}
