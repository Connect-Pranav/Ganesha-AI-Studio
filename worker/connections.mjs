// Provider & Subscription Manager. Keeps seven different things apart:
// consumer subscription · signed-in account · API credentials · API billing · included allowance ·
// remaining quota · capabilities. A state is "connected" only after a real request succeeded.
import { newId, nowIso } from './util.mjs';
import { ttsModel } from './voices.mjs';

const OPENAI_TIMEOUT = 20_000;

export async function listConnections(env, db, llmProviders) {
  const lastCall = async (provider) => db.prepare("SELECT status, error, created_at FROM provider_calls WHERE provider = ? ORDER BY created_at DESC LIMIT 1").bind(provider).first();
  const lastOk = async (provider) => db.prepare("SELECT created_at FROM provider_calls WHERE provider = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1").bind(provider).first();
  const claude = llmProviders.find((p) => p.provider === 'claude');
  const gemini = llmProviders.find((p) => p.provider === 'gemini');
  const oai = await lastCall('openai');
  const tts = await lastCall('gemini_tts');
  const ttsOk = await lastOk('gemini_tts');
  const ytOk = await db.prepare("SELECT fetched_at FROM analytics_snapshots WHERE brand = 'sunverse' ORDER BY fetched_at DESC LIMIT 1").first();
  const llmState = (p) => (p.state === 'last_request_ok' ? 'connected' : p.state === 'last_request_failed' ? 'error' : p.state === 'key_set_untested' ? 'credentials_set_untested' : 'not_configured');

  return [
    {
      id: 'claude',
      name: 'Anthropic API (Claude)',
      kind: 'api',
      state: llmState(claude),
      authMethod: 'API key (Worker secret ANTHROPIC_API_KEY)',
      model: claude.model,
      capabilities: ['Agent text generation (all 31 agents can use it)', 'JSON deliverables'],
      lastSuccessAt: claude.lastSuccessAt,
      lastError: claude.lastError,
      quotaVisibility: 'Not exposed to the Worker',
      billingVisibility: 'Token usage is counted here; invoices are in console.anthropic.com',
      subscriptionNote: 'A Claude Pro/Max subscription does NOT include API usage. The API is billed per token separately.',
      missing: claude.state === 'not_configured' ? ['ANTHROPIC_API_KEY'] : [],
      nextAction: claude.state === 'not_configured' ? 'Optional: create an API key at console.anthropic.com and run `npx wrangler secret put ANTHROPIC_API_KEY`.' : claude.state === 'last_request_ok' ? null : 'Run Test connection.',
      testable: true,
    },
    {
      id: 'gemini',
      name: 'Gemini API (Google AI Studio)',
      kind: 'api',
      state: llmState(gemini),
      authMethod: 'API key (Worker secret GEMINI_API_KEY)',
      model: gemini.model,
      capabilities: ['Agent text generation (studio primary engine)', 'SOMA analytics insights'],
      lastSuccessAt: gemini.lastSuccessAt,
      lastError: gemini.lastError,
      quotaVisibility: 'Free-tier limits are not reported by the API',
      billingVisibility: 'Token usage is counted here; set your billing tier (free/paid) in CFO → Settings',
      subscriptionNote: 'Google AI Pro is a consumer plan. It does not grant Gemini API billing or unlimited API quota.',
      missing: gemini.state === 'not_configured' ? ['GEMINI_API_KEY'] : [],
      nextAction: gemini.state === 'not_configured' ? 'Create a key at aistudio.google.com → Get API key, then `npx wrangler secret put GEMINI_API_KEY`.' : gemini.state === 'last_request_ok' ? null : 'Run Test connection.',
      testable: true,
    },
    {
      id: 'gemini_tts',
      name: 'Gemini TTS (speech for voice profiles)',
      kind: 'api',
      state: !env.GEMINI_API_KEY ? 'not_configured' : tts ? (tts.status === 'success' ? 'connected' : 'error') : 'credentials_set_untested',
      authMethod: 'Same GEMINI_API_KEY',
      model: ttsModel(env),
      capabilities: ['Adult speech synthesis for profiles with a configured prebuilt voice name', 'No singing', 'No verified child voices'],
      lastSuccessAt: ttsOk?.created_at ?? null,
      lastError: tts?.status === 'error' ? { at: tts.created_at, message: tts.error } : null,
      quotaVisibility: 'Not reported',
      billingVisibility: 'Usage + estimated cost counted in the ledger',
      missing: [!env.GEMINI_API_KEY && 'GEMINI_API_KEY', 'Provider voice names per profile (Voice Library)'].filter(Boolean),
      nextAction: 'In Voice Library set provider "gemini_tts" and a prebuilt voice name from Google’s TTS docs, then press Preview. The first preview is the live verification.',
      testable: false,
    },
    {
      id: 'openai',
      name: 'OpenAI API',
      kind: 'api',
      state: !env.OPENAI_API_KEY ? 'not_configured' : oai ? (oai.status === 'success' ? 'connected' : 'error') : 'credentials_set_untested',
      authMethod: 'API key (Worker secret OPENAI_API_KEY)',
      model: null,
      capabilities: ['Credential check only (lists models; no tokens used)', 'No agent adapter yet — add one when you decide to pay for the API'],
      lastSuccessAt: oai?.status === 'success' ? oai.created_at : null,
      lastError: oai?.status === 'error' ? { at: oai.created_at, message: oai.error } : null,
      quotaVisibility: 'Not exposed',
      billingVisibility: 'platform.openai.com → Usage',
      subscriptionNote: 'A ChatGPT subscription does not include API access. Never enter your ChatGPT password here.',
      missing: env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY (optional)'],
      nextAction: env.OPENAI_API_KEY ? 'Run Test connection.' : 'Optional: platform.openai.com → API keys → `npx wrangler secret put OPENAI_API_KEY`.',
      testable: true,
    },
    {
      id: 'canva',
      name: 'Canva Connect API',
      kind: 'oauth',
      state: env.CANVA_CLIENT_ID && env.CANVA_CLIENT_SECRET ? 'credentials_set_oauth_not_implemented' : 'not_configured',
      authMethod: 'OAuth 2.0 with PKCE (Canva integration in the Canva Developer Portal)',
      model: null,
      capabilities: ['Planned: create designs, upload assets, export PNG/PDF, brand-template autofill (Canva Pro/Teams/Enterprise)'],
      lastSuccessAt: null,
      lastError: null,
      quotaVisibility: 'n/a',
      billingVisibility: 'Covered by your Canva plan',
      missing: ['Canva integration (client ID + secret)', 'OAuth flow in this Worker (not built yet)', 'TOKEN_ENCRYPTION_KEY for storing the refresh token'],
      nextAction: 'Create an integration at canva.com/developers with redirect URL https://ganesha-studio.pravanigroup.workers.dev/api/oauth/canva/callback and scopes design:content:write, design:content:read, asset:write, asset:read; then set CANVA_CLIENT_ID / CANVA_CLIENT_SECRET. Until then NATA’s artwork briefs are used in Canva by hand and the exported files are registered as assets.',
      testable: false,
    },
    {
      id: 'google_flow',
      name: 'Google Flow (video)',
      kind: 'manual',
      state: 'manual_handoff',
      authMethod: 'Your Google account in the browser (Google AI Pro)',
      model: null,
      capabilities: ['Scene prompts + reference lists prepared here', 'You generate in Flow and register the output link', 'Generation status is owner-reported'],
      lastSuccessAt: null,
      lastError: null,
      quotaVisibility: 'Flow credits are only visible inside Flow',
      billingVisibility: 'Included in Google AI Pro (consumer)',
      missing: [],
      nextAction: 'No public Flow API was found (checked 2026-10-14). Use Video Studio → Prepare Flow handoff.',
      testable: false,
    },
    {
      id: 'youtube_stats',
      name: 'YouTube Data API (public stats)',
      kind: 'api',
      state: !env.YOUTUBE_API_KEY ? 'not_configured' : ytOk ? 'connected' : 'credentials_set_untested',
      authMethod: 'API key (YOUTUBE_API_KEY)',
      model: null,
      capabilities: ['Public channel + video statistics for @SURVERSE_09'],
      lastSuccessAt: ytOk?.fetched_at ?? null,
      lastError: null,
      quotaVisibility: 'Google Cloud console',
      billingVisibility: 'Free quota',
      missing: env.YOUTUBE_API_KEY ? [] : ['YOUTUBE_API_KEY'],
      nextAction: null,
      testable: false,
    },
    {
      id: 'instagram',
      name: 'Instagram (LittleLoop @little_loop09)',
      kind: 'api',
      state: env.IG_ACCESS_TOKEN ? 'credentials_set_untested' : 'not_configured',
      authMethod: 'Instagram API with Instagram Login · Connect button (LittleLoop) or Worker secret IG_ACCESS_TOKEN',
      model: null,
      capabilities: ['Post approved reels (Reel Factory)', 'LittleLoop analytics: followers, per-post views/reach/likes/comments/saves'],
      lastSuccessAt: null,
      lastError: null,
      quotaVisibility: 'Meta app dashboard',
      billingVisibility: 'Free',
      missing: env.IG_ACCESS_TOKEN ? [] : ['IG_ACCESS_TOKEN'],
      nextAction: env.IG_ACCESS_TOKEN ? null : 'LittleLoop → Reel Factory → Connect Instagram (needs IG_APP_ID + IG_APP_SECRET from a Meta app once).',
      testable: false,
    },
    {
      id: 'youtube_upload',
      name: 'YouTube upload',
      kind: 'oauth',
      state: 'not_configured',
      authMethod: 'Google OAuth (not built)',
      model: null,
      capabilities: ['Publishing stays manual after your approval'],
      lastSuccessAt: null,
      lastError: null,
      quotaVisibility: 'n/a',
      billingVisibility: 'n/a',
      missing: ['Google OAuth client'],
      nextAction: 'See docs/INTEGRATION_SETUP.md §6.',
      testable: false,
    },
  ];
}

/** Live OpenAI credential check: GET /v1/models (no tokens billed). */
export async function testOpenAI(env, db, deps = {}) {
  if (!env.OPENAI_API_KEY) return { provider: 'openai', state: 'not_configured', message: 'Set secret OPENAI_API_KEY.' };
  const fetchImpl = deps.fetch ?? fetch;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT);
  let ok = false;
  let message;
  let status = null;
  try {
    const res = await fetchImpl('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: ctrl.signal });
    status = res.status;
    const raw = await res.text();
    if (res.ok) {
      const n = JSON.parse(raw).data?.length ?? 0;
      ok = true;
      message = `Key accepted; ${n} models visible to this key.`;
    } else message = `HTTP ${res.status}: ${raw.split(env.OPENAI_API_KEY).join('[redacted]').slice(0, 300)}`;
  } catch (e) {
    message = e.name === 'AbortError' ? 'Timed out' : `Network error: ${String(e.message).slice(0, 200)}`;
  } finally {
    clearTimeout(timer);
  }
  await db
    .prepare(`INSERT INTO provider_calls (id, provider, model, purpose, task_id, status, http_status, input_tokens, output_tokens, cost_usd, latency_ms, error, created_at) VALUES (?,?,?,?,NULL,?,?,NULL,NULL,NULL,?,?,?)`)
    .bind(newId('pc'), 'openai', 'models.list', 'connection_test', ok ? 'success' : 'error', status, Date.now() - started, ok ? null : message, nowIso())
    .run();
  return { provider: 'openai', state: ok ? 'connected' : 'error', message };
}
