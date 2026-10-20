// POST a chat message and read the Worker's server-sent events: `ping` keepalives (every 15 s, so a slow
// answer is never cut by Cloudflare's 100-second idle limit), optional `delta` text, then `done` or `error`.
import { base, getToken } from './adminService';

export async function postStream<T>(path: string, body: object, onDelta?: (t: string) => void, timeoutMs = 240_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}${path}`, { method: 'POST', cache: 'no-store', signal: ctl.signal, headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (\w+)/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!ev || !data) continue;
        const d = JSON.parse(data);
        if (ev === 'delta') onDelta?.(d.t);
        else if (ev === 'done') return d.reply as T;
        else if (ev === 'error') throw new Error(d.error ?? 'Chat failed');
      }
    }
    throw new Error('Connection closed before the reply finished');
  } finally {
    clearTimeout(timer);
  }
}
