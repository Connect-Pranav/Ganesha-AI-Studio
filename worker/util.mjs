export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const isoIn = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function newId(prefix) {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${Date.now().toString(36)}${[...rnd].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Constant-time string comparison (avoids leaking token length/content via timing). */
export function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
