// AI connection status. The browser NEVER holds provider credentials.
//
// - No VITE_AI_STATUS_ENDPOINT set  → "Not configured" (Demo Mode). No network call.
// - Endpoint set                    → ONE request to YOUR server-side adapter,
//                                     which reports { status, provider?, message? }.
//   No automatic retries; the user re-checks manually.
import type { AiConnectionState, AiStatus } from '../types';

const ENDPOINT = (import.meta.env.VITE_AI_STATUS_ENDPOINT as string | undefined)?.trim() || '';

export function isAiConfigured(): boolean {
  return ENDPOINT.length > 0;
}

function status(state: AiConnectionState, message: string, provider: string | null = null): AiStatus {
  return { state, message, provider, checkedAt: new Date() };
}

export async function getAiStatus(): Promise<AiStatus> {
  if (!isAiConfigured()) {
    return status('not_configured', 'No AI provider configured. Running in Demo Mode.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(ENDPOINT, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return status('error', `Status endpoint returned HTTP ${res.status}.`);
    }
    const body = (await res.json()) as { status?: string; provider?: string; message?: string };
    const provider = body.provider ?? null;
    if (body.status === 'connected') return status('connected', body.message ?? 'Provider reachable.', provider);
    if (body.status === 'error') return status('error', body.message ?? 'Provider reported an error.', provider);
    return status('disconnected', body.message ?? 'Provider not reachable.', provider);
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return status('disconnected', aborted ? 'Status check timed out.' : 'Could not reach the status endpoint.');
  } finally {
    clearTimeout(timer);
  }
}
