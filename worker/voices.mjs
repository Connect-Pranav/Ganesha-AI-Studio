// Signature Voice Library (10 original profiles) + Smart Voice Director.
// The profiles are original creative directions. They are inspired by broad Indian vocal
// traditions, never by a specific singer, and are never cloned from or attributed to a real voice.
// A profile is only *descriptive* until a real provider voice is configured and tested.
import { HttpError, newId, nowIso } from './util.mjs';
import { getSettings, priceFor, chargeFor, toInr, tokenCostUsd } from './finance.mjs';

export const VOICE_PROFILES = [
  {
    id: 'M1', name: 'The Golden Melody', gender: 'male', age: 'adult', modes: ['singing', 'speech'],
    language: 'Hindi', accent: 'Neutral Hindustani', style: 'Warm, rounded, timeless melodic',
    direction: 'Warm, rounded tone with a gentle vibrato on held notes. Clear Hindi diction, soft consonants, heartfelt phrasing that leans into the meaning of each line.',
    pitchPacing: 'Mid baritone-tenor range; unhurried, legato phrasing; speech at ~140 wpm.',
    emotionalRange: ['tender', 'romantic', 'nostalgic', 'reassuring'],
    useCases: ['Romantic songs', 'Music videos', 'Expressive narration'],
    tags: ['romantic', 'melodic', 'classic', 'narration', 'song', 'music_video', 'warm'],
    sampleScript: 'Baarish ki pehli boond jaise, tum aaye chupke se — aur shaam phir se gungunane lagi.',
  },
  {
    id: 'M2', name: 'The Soulful Baritone', gender: 'male', age: 'adult', modes: ['singing', 'speech'],
    language: 'Hindi', accent: 'Neutral Hindustani', style: 'Deep, textured, mature',
    direction: 'Deep, textured baritone with restrained intensity — emotion held back rather than pushed. Slight grain on low notes; long breaths before key lines.',
    pitchPacing: 'Low register; slow, deliberate; speech at ~125 wpm with weighted pauses.',
    emotionalRange: ['longing', 'heartbreak', 'gravitas', 'reflective'],
    useCases: ['Soulful songs', 'Heartbreak and longing', 'Cinematic narration', 'Documentary narration'],
    tags: ['soulful', 'sad', 'heartbreak', 'cinematic', 'documentary', 'narration', 'mature', 'deep', 'song'],
    sampleScript: 'Some stories are not told loudly. They wait, quietly, for someone patient enough to listen.',
  },
  {
    id: 'M3', name: 'The Modern Romantic', gender: 'male', age: 'young_adult', modes: ['singing', 'speech'],
    language: 'Hindi / Hinglish', accent: 'Urban Indian', style: 'Youthful, intimate, airy',
    direction: 'Youthful and intimate, close-mic airy delivery. Conversational verses that rise into expressive melodic peaks on the hook.',
    pitchPacing: 'Light tenor; relaxed verses, lifted choruses; speech at ~155 wpm.',
    emotionalRange: ['playful', 'romantic', 'hopeful', 'casual'],
    useCases: ['Contemporary romance', 'Instagram Reels narration', 'YouTube Shorts'],
    tags: ['romantic', 'modern', 'pop', 'reel', 'short', 'social', 'conversational', 'comedy', 'vlog', 'song'],
    sampleScript: 'Okay, real talk — chai at 4 pm is not a habit. It is a whole personality.',
  },
  {
    id: 'M4', name: 'The Folk Soul', gender: 'male', age: 'adult', modes: ['singing', 'speech'],
    language: 'Hindi + regional languages', accent: 'Regional, earthy', style: 'Earthy, expressive, ornamented',
    direction: 'Earthy, open-throated folk character with melodic ornamentation (murki-style turns) and strong regional articulation. Rhythmic, grounded storytelling.',
    pitchPacing: 'Mid-high chest voice; rhythmic; speech at ~145 wpm with storytelling cadence.',
    emotionalRange: ['joyful', 'proud', 'devotional-free celebration', 'earnest'],
    useCases: ['Folk-inspired songs', 'Culturally grounded storytelling', 'Village and festival themes'],
    tags: ['folk', 'regional', 'storytelling', 'festival', 'earthy', 'song'],
    sampleScript: 'Khet ki mitti, nadiya ka paani — har kahani yahin se shuru hoti hai.',
  },
  {
    id: 'F1', name: 'The Eternal Melody', gender: 'female', age: 'adult', modes: ['singing', 'speech'],
    language: 'Hindi', accent: 'Neutral Hindustani', style: 'Graceful, warm, precise',
    direction: 'Graceful and precise with crystal-clear articulation and a delicate vibrato. Expressive phrasing that shapes every vowel.',
    pitchPacing: 'Soprano-mezzo range; flowing legato; speech at ~140 wpm.',
    emotionalRange: ['tender', 'romantic', 'serene', 'graceful'],
    useCases: ['Timeless romantic music', 'Narration', 'Lullaby-style songs'],
    tags: ['romantic', 'melodic', 'classic', 'narration', 'graceful', 'song', 'music_video', 'warm'],
    sampleScript: 'Chaandni ne kaha dheere se — yeh raat bhi tumhari kahani sunna chahti hai.',
  },
  {
    id: 'F2', name: 'The Emotional Powerhouse', gender: 'female', age: 'adult', modes: ['singing', 'speech'],
    language: 'Hindi', accent: 'Neutral Hindustani', style: 'Rich, powerful, dynamic',
    direction: 'Rich and powerful with controlled intensity — builds from a held-back verse to a full-voiced climax without losing pitch control.',
    pitchPacing: 'Mezzo with strong belt; dynamic swells; speech at ~135 wpm.',
    emotionalRange: ['passionate', 'defiant', 'grief', 'triumphant'],
    useCases: ['Emotional songs', 'Dramatic musical climaxes', 'Ad voiceovers with impact'],
    tags: ['emotional', 'powerful', 'dramatic', 'ad', 'climax', 'song', 'cinematic'],
    sampleScript: 'Har toofan ke baad bhi, main wahin khadi hoon — aur ab, awaaz meri hai.',
  },
  {
    id: 'F3', name: 'The Modern Dream Voice', gender: 'female', age: 'young_adult', modes: ['singing', 'speech'],
    language: 'Hindi / Hinglish', accent: 'Urban Indian', style: 'Youthful, intimate, airy',
    direction: 'Youthful, soft and airy with intimate, breathy romantic expression. Natural and conversational for modern narration.',
    pitchPacing: 'Light soprano; relaxed; speech at ~150 wpm.',
    emotionalRange: ['dreamy', 'romantic', 'curious', 'warm'],
    useCases: ['Modern melodic songs', 'Contemporary narration', 'Reels and Shorts', 'Explainers'],
    tags: ['romantic', 'modern', 'pop', 'reel', 'short', 'social', 'conversational', 'explainer', 'vlog', 'song', 'warm'],
    sampleScript: 'Three things that made today better: rain on the window, an old song, and you reading this.',
  },
  {
    id: 'F4', name: 'The Classical Folk Muse', gender: 'female', age: 'adult', modes: ['singing', 'speech'],
    language: 'Hindi + regional languages', accent: 'Classical / regional', style: 'Ornamented, agile, classical-folk',
    direction: 'Agile melodic phrasing with expressive ornamentation and taans; semi-classical training character blended with folk warmth.',
    pitchPacing: 'Wide range; agile runs; speech at ~140 wpm with lilting cadence.',
    emotionalRange: ['joyful', 'yearning', 'celebratory', 'meditative'],
    useCases: ['Original folk songs', 'Semi-classical projects', 'Cultural storytelling'],
    tags: ['folk', 'classical', 'semi-classical', 'regional', 'festival', 'song', 'storytelling'],
    sampleScript: 'Saawan aaya, jhoole pade — aangan mein geet utre.',
  },
  {
    id: 'K1', name: 'Tiny Tot', gender: 'child', age: 'toddler', modes: ['speech'],
    language: 'Hindi / English (very simple)', accent: 'Child', style: 'Toddler speech, very short phrases',
    direction: 'A 1–2-year-old character: one to three word phrases, simple vocabulary, natural pauses, giggles and playful reactions. Never long sentences.',
    pitchPacing: 'High, bright; slow with long pauses; 1–3 words per phrase.',
    emotionalRange: ['delighted', 'curious', 'sleepy', 'surprised'],
    useCases: ['Recurring toddler character (LittleLoop)', 'Short family comedy'],
    tags: ['toddler', 'kids', 'littleloop', 'family', 'comedy', 'animation', 'character'],
    sampleScript: 'Papa! … Dekho! Bubble! … Hehe. Aur!',
  },
  {
    id: 'K2', name: 'Little Star', gender: 'child', age: 'child', modes: ['speech', 'singing'],
    language: 'Hindi / English', accent: 'Child', style: 'Bright, expressive, curious',
    direction: 'Bright, expressive child (about 5–8) with clearer speech than Tiny Tot: curious questions, playful reactions and simple storytelling.',
    pitchPacing: 'High, lively; quick bursts; ~150 wpm.',
    emotionalRange: ['excited', 'curious', 'proud', 'giggly'],
    useCases: ['Kids stories', 'Animation narration', "Children's songs (where a provider supports it)"],
    tags: ['child', 'kids', 'littleloop', 'story', 'animation', 'narration', 'character', 'song'],
    sampleScript: 'Mumma, why does the moon follow our car? Is it… our moon?',
  },
];
export const profileById = (id) => VOICE_PROFILES.find((p) => p.id === id);

/* ---------------- provider capability (never assumed) ---------------- */
export const TTS_PROVIDER = 'gemini_tts';
export const ttsModel = (env) => (env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts').trim();

/** What can actually be done with a profile right now. */
export function capabilities(profile, setting, env) {
  const ttsReady = Boolean(env.GEMINI_API_KEY);
  const voiceSet = Boolean(setting?.provider && setting?.provider_voice_id);
  const usesTts = setting?.provider === TTS_PROVIDER;
  const childLimit = profile.age === 'toddler' || profile.age === 'child';
  const speech = voiceSet && usesTts && ttsReady && !childLimit;
  const limits = [];
  if (!voiceSet) limits.push('Descriptive only: no provider voice is configured for this profile.');
  if (voiceSet && usesTts && !ttsReady) limits.push('GEMINI_API_KEY is not set on the Worker, so speech cannot be generated.');
  if (voiceSet && !usesTts) limits.push(`Provider "${setting.provider}" has no adapter in this studio; use it manually and register the audio file.`);
  if (childLimit) limits.push('No configured provider offers verified child or toddler voices. An adult voice must not be passed off as a child; record or source child audio with consent, or use a provider that documents child voices.');
  limits.push('Singing: no singing-capable music provider is configured. TTS voices are not singing models.');
  return {
    descriptive: true,
    configuredProviderVoice: voiceSet,
    previewable: Boolean(setting?.preview_ref) || speech,
    speechSynthesis: speech,
    singing: false,
    verifiedLive: false,
    limits,
  };
}

export async function listVoices(env, db) {
  const { results } = await db.prepare('SELECT * FROM voice_profile_settings').all();
  const set = new Map(results.map((r) => [r.profile_id, r]));
  const assign = (await db.prepare('SELECT * FROM voice_assignments ORDER BY updated_at DESC').all()).results;
  return VOICE_PROFILES.map((p) => {
    const s = set.get(p.id) ?? null;
    return {
      ...p,
      provider: s?.provider ?? null,
      providerVoiceId: s?.provider_voice_id ?? null,
      favorite: Boolean(s?.favorite),
      previewRef: s?.preview_ref ?? null,
      availability: capabilities(p, s, env),
      assignments: assign.filter((a) => a.profile_id === p.id).map((a) => ({ id: a.id, scope: a.scope, scopeRef: a.scope_ref, role: a.role, mode: a.mode, locked: Boolean(a.locked) })),
    };
  });
}

export async function updateVoiceSetting(db, id, b) {
  if (!profileById(id)) throw new HttpError(404, 'Unknown voice profile');
  const cur = (await db.prepare('SELECT * FROM voice_profile_settings WHERE profile_id = ?').bind(id).first()) ?? {};
  const provider = b.provider === undefined ? cur.provider ?? null : b.provider;
  if (provider !== null && !/^[a-z0-9_]{2,32}$/.test(String(provider))) throw new HttpError(400, 'provider must be an id like gemini_tts');
  const voiceId = b.providerVoiceId === undefined ? cur.provider_voice_id ?? null : b.providerVoiceId;
  if (voiceId !== null && (typeof voiceId !== 'string' || voiceId.length > 100)) throw new HttpError(400, 'providerVoiceId must be a string');
  const preview = b.previewRef === undefined ? cur.preview_ref ?? null : b.previewRef;
  if (preview !== null && !/^https:\/\//.test(String(preview))) throw new HttpError(400, 'previewRef must be an https link to real audio');
  const fav = b.favorite === undefined ? cur.favorite ?? 0 : b.favorite ? 1 : 0;
  await db
    .prepare(`INSERT INTO voice_profile_settings (profile_id, provider, provider_voice_id, favorite, preview_ref, updated_at) VALUES (?,?,?,?,?,?)
              ON CONFLICT(profile_id) DO UPDATE SET provider = excluded.provider, provider_voice_id = excluded.provider_voice_id, favorite = excluded.favorite, preview_ref = excluded.preview_ref, updated_at = excluded.updated_at`)
    .bind(id, provider, voiceId, fav, preview, nowIso())
    .run();
}

/* ---------------- assignments (consistency + approval for replacements) ---------------- */
export async function assignVoice(db, { scope, scopeRef, role = 'main', profileId, mode, confirmReplace = false, reason = null, settings = {} }) {
  if (!['project', 'character'].includes(scope)) throw new HttpError(400, 'scope must be project or character');
  if (typeof scopeRef !== 'string' || !scopeRef.trim()) throw new HttpError(400, 'scopeRef is required');
  const p = profileById(profileId);
  if (!p) throw new HttpError(400, 'Unknown voice profile');
  if (!['speech', 'singing'].includes(mode)) throw new HttpError(400, 'mode must be speech or singing');
  if (!p.modes.includes(mode)) throw new HttpError(400, `${p.id} is not designed for ${mode}`);
  if (typeof role !== 'string' || !role.trim() || role.length > 40) throw new HttpError(400, 'role is required');
  const cur = await db.prepare('SELECT * FROM voice_assignments WHERE scope = ? AND scope_ref = ? AND role = ?').bind(scope, scopeRef, role).first();
  if (cur && cur.locked && cur.profile_id !== profileId && !confirmReplace) {
    throw new HttpError(409, `Role "${role}" already has approved voice ${cur.profile_id}. Replacing it changes an established voice — resend with confirmReplace: true and a reason.`);
  }
  if (cur && cur.profile_id !== profileId && confirmReplace && !(typeof reason === 'string' && reason.trim())) throw new HttpError(400, 'A reason is required to replace an approved voice');
  const now = nowIso();
  await db
    .prepare(`INSERT INTO voice_assignments (id, scope, scope_ref, role, profile_id, mode, locked, settings_json, reason, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)
              ON CONFLICT(scope, scope_ref, role) DO UPDATE SET profile_id = excluded.profile_id, mode = excluded.mode, settings_json = excluded.settings_json, reason = excluded.reason, locked = 1, updated_at = excluded.updated_at`)
    .bind(newId('va'), scope, scopeRef, role, profileId, mode, JSON.stringify(settings ?? {}), reason, now, now)
    .run();
  await db
    .prepare('INSERT INTO events (workflow_id, task_id, kind, message, data_json, created_at) VALUES (NULL, NULL, ?, ?, ?, ?)')
    .bind(cur && cur.profile_id !== profileId ? 'voice_replaced' : 'voice_assigned', `${scope} ${scopeRef} · ${role}: ${cur && cur.profile_id !== profileId ? `${cur.profile_id} → ` : ''}${profileId} (${mode})`, JSON.stringify({ reason }), now)
    .run();
  return db.prepare('SELECT * FROM voice_assignments WHERE scope = ? AND scope_ref = ? AND role = ?').bind(scope, scopeRef, role).first();
}

export async function listAssignments(db, scope, scopeRef) {
  return (await db.prepare('SELECT * FROM voice_assignments WHERE scope = ? AND scope_ref = ? ORDER BY role').bind(scope, scopeRef).all()).results;
}

/* ---------------- Smart Voice Director ---------------- */
const KEYWORDS = {
  toddler: /\b(toddler|baby|1[- ]?2 ?(yr|year)|tiny tot)\b/i,
  child: /\b(child|kid|kids|boy|girl|little one|5[- ]?8)\b/i,
  dad: /\b(dad|papa|father)\b/i,
  mom: /\b(mom|mum|mumma|mother|mama)\b/i,
  maleOnly: /\bmale[- ]only\b|\bonly (a )?male\b|\bsolo male\b/i,
  femaleOnly: /\bfemale[- ]only\b|\bonly (a )?female\b|\bsolo female\b/i,
  duet: /\bduet\b/i,
  musicOnly: /\b(music[- ]only|instrumental|no narration|no voice ?over)\b/i,
  documentary: /\b(documentary|tech(nology)? (explainer|documentary)|explainer)\b/i,
  comedy: /\b(comedy|funny|humou?r|skit)\b/i,
  romantic: /\b(romantic|romance|love)\b/i,
  sad: /\b(sad|heartbreak|longing|soulful)\b/i,
  folk: /\b(folk|regional|village|lok)\b/i,
  classical: /\b(classical|raag|raga|semi-classical)\b/i,
  song: /\b(song|sing|singing|lyrics|vocal|music video)\b/i,
};

function score(profile, want) {
  let s = 40;
  const hits = [];
  for (const t of want.tags) if (profile.tags.includes(t)) (s += 9, hits.push(t));
  if (want.mode && profile.modes.includes(want.mode)) s += 8;
  if (want.mode && !profile.modes.includes(want.mode)) s -= 60;
  if (want.gender && profile.gender !== want.gender) s -= 80;
  if (want.age && profile.age !== want.age && !(want.age === 'adult' && profile.age === 'young_adult')) s -= 80;
  return { s: Math.max(0, Math.min(100, s)), hits };
}

/**
 * Recommends one profile per role. Approved assignments for the project are kept, not re-picked.
 * Input: { brief, brand, platform, contentType, mode, roles:[{role, kind}], vocalRequirement, projectRef }
 */
export async function recommendVoices(env, db, input) {
  const brief = String(input?.brief ?? '').slice(0, 4000);
  if (!brief.trim() && !input?.roles?.length) throw new HttpError(400, 'brief or roles is required');
  const k = (name) => KEYWORDS[name].test(brief);
  const brand = input.brand ?? null;
  const contentType = String(input.contentType ?? '').toLowerCase();
  const musicOnly = Boolean(input.musicOnly) || k('musicOnly');
  const vocal = input.vocalRequirement ?? (k('maleOnly') ? 'male_only' : k('femaleOnly') ? 'female_only' : k('duet') ? 'duet' : null);
  const singing = input.mode === 'singing' || (input.mode !== 'speech' && (brand === 'sunverse' && (k('song') || ['song', 'music_video'].includes(contentType))));
  const notes = [];
  const genreTags = ['romantic', 'sad', 'folk', 'classical', 'comedy', 'documentary'].filter(k).map((t) => (t === 'sad' ? 'soulful' : t));
  if (['reel', 'short', 'shorts'].includes(contentType) || /reel|shorts?\b/i.test(brief)) genreTags.push('reel', 'short', 'social');
  if (contentType === 'documentary') genreTags.push('documentary', 'narration');

  // Roles: explicit, else inferred from the brief.
  let roles = Array.isArray(input.roles) ? input.roles.filter((r) => r && typeof r.role === 'string').slice(0, 8) : [];
  if (!roles.length) {
    if (singing) {
      if (musicOnly && !k('song')) roles = [];
      else if (vocal === 'male_only') roles = [{ role: 'lead vocal', kind: 'singer_male' }];
      else if (vocal === 'female_only') roles = [{ role: 'lead vocal', kind: 'singer_female' }];
      else if (vocal === 'duet') roles = [{ role: 'male vocal', kind: 'singer_male' }, { role: 'female vocal', kind: 'singer_female' }];
      else roles = [{ role: 'lead vocal', kind: 'singer' }];
    } else if (!musicOnly) {
      if (k('toddler')) roles.push({ role: 'toddler', kind: 'toddler' });
      else if (k('child')) roles.push({ role: 'child', kind: 'child' });
      if (k('dad')) roles.push({ role: 'dad', kind: 'adult_male' });
      if (k('mom')) roles.push({ role: 'mom', kind: 'adult_female' });
      if (!roles.length) roles.push({ role: 'narrator', kind: 'narrator' });
    }
  }
  if (musicOnly) notes.push('Music-only: no narration added.');
  if (vocal === 'male_only') notes.push('Male-only requirement preserved: no female voice will be suggested.');
  if (vocal === 'female_only') notes.push('Female-only requirement preserved: no male voice will be suggested.');

  const existing = input.projectRef ? await listAssignments(db, 'project', String(input.projectRef)) : [];
  const voices = await listVoices(env, db);
  const settings = await getSettings(db);
  const out = [];
  for (const r of roles) {
    const kept = existing.find((a) => a.role === r.role);
    const mode = r.kind?.startsWith('singer') || (singing && r.kind === 'singer') ? 'singing' : 'speech';
    const want = { tags: [...genreTags, mode === 'singing' ? 'song' : 'narration'], mode };
    if (r.kind === 'toddler') Object.assign(want, { age: 'toddler', gender: 'child' });
    else if (r.kind === 'child') Object.assign(want, { age: 'child', gender: 'child' });
    else if (r.kind === 'adult_male' || r.kind === 'singer_male') Object.assign(want, { gender: 'male', age: 'adult' });
    else if (r.kind === 'adult_female' || r.kind === 'singer_female') Object.assign(want, { gender: 'female', age: 'adult' });
    else want.age = 'adult';
    if (vocal === 'male_only') want.gender = 'male';
    if (vocal === 'female_only') want.gender = 'female';
    if (r.kind === 'adult_male' || r.kind === 'adult_female') want.tags.push('conversational', 'warm');
    if (brand === 'littleloop' && (r.kind === 'adult_male' || r.kind === 'adult_female')) want.tags.push('comedy', 'conversational');

    const ranked = voices
      .map((v) => ({ v, ...score(v, want) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (b.v.favorite ? 1 : 0) - (a.v.favorite ? 1 : 0));
    if (!ranked.length) {
      out.push({ role: r.role, profileId: null, reason: 'No profile fits this role and constraint.', backups: [] });
      continue;
    }
    const pick = kept ? ranked.find((x) => x.v.id === kept.profile_id) ?? { v: voices.find((v) => v.id === kept.profile_id), s: 100, hits: [] } : ranked[0];
    const v = pick.v;
    const cost = await speechCostEstimate(db, settings, v.sampleScript);
    out.push({
      role: r.role,
      mode,
      profileId: v.id,
      profileName: v.name,
      matchScore: kept ? 100 : pick.s,
      reason: kept ? `Approved earlier for this project (locked). Kept for consistency.` : `${v.style}. Matches: ${[...new Set(pick.hits)].join(', ') || 'role and range'}.`,
      locked: Boolean(kept),
      provider: v.provider,
      providerVoiceId: v.providerVoiceId,
      backups: ranked.filter((x) => x.v.id !== v.id).slice(0, 2).map((x) => ({ profileId: x.v.id, name: x.v.name, matchScore: x.s })),
      pronunciation: v.language.includes('Hindi') ? 'Hindi in Devanagari or clear romanisation; mark stressed syllables and English loanwords; keep schwa deletion natural (e.g. "Ram" not "Rama").' : 'Spell names phonetically in the script.',
      delivery: v.direction,
      generationMethod: mode === 'singing' ? 'Singing provider required — none configured (manual production)' : v.availability.speechSynthesis ? `Text-to-speech via ${v.provider} (${v.providerVoiceId})` : 'Manual: no speech provider voice configured for this profile',
      estimatedCost: mode === 'speech' ? cost : { inr: null, usd: null, note: 'No singing provider: cost unknown.' },
      limitations: v.availability.limits,
    });
  }
  return { controller: 'GANESHA_CBO', director: 'smart_voice_director', recommendations: out, notes, overridable: true };
}

/** Rough TTS cost for a script: ~2.5 words/s speech, 25 audio tokens per second (Gemini pricing page). */
export async function speechCostEstimate(db, settings, script) {
  const words = String(script).trim().split(/\s+/).filter(Boolean).length;
  const seconds = Math.max(1, words / 2.5);
  const price = await priceFor(db, TTS_PROVIDER, 'gemini-3.8-flash-tts');
  const usd = tokenCostUsd(price, Math.ceil(String(script).length / 3.5), Math.ceil(seconds * 25));
  const ch = chargeFor(price, settings.provider_billing[TTS_PROVIDER] ?? 'unknown', usd);
  return { seconds: Math.round(seconds), usd: ch.usd === null ? null : Math.round(ch.usd * 1e6) / 1e6, inr: toInr(ch.usd, settings.fx_usd_inr), basis: ch.basis, note: 'Estimate for the sample script.' };
}

/* ---------------- speech synthesis (Gemini TTS) ---------------- */
/**
 * Generates speech for a profile with a configured gemini_tts voice. Returns base64 PCM.
 * Implemented against Google's documented generateContent TTS request shape; NOT verified live
 * from this studio yet (no key in the build environment). Logged in provider_calls + cost_ledger.
 */
export async function synthesize(env, db, profileId, text, deps = {}) {
  const p = profileById(profileId);
  if (!p) throw new HttpError(404, 'Unknown voice profile');
  if (typeof text !== 'string' || !text.trim() || text.length > 400) throw new HttpError(400, 'text is required (max 400 characters)');
  const s = await db.prepare('SELECT * FROM voice_profile_settings WHERE profile_id = ?').bind(profileId).first();
  const cap = capabilities(p, s, env);
  if (!cap.speechSynthesis) throw new HttpError(409, `Speech is not available for ${p.id}: ${cap.limits[0]}`);
  const settings = await getSettings(db);
  if (settings.dispatch_paused) throw new HttpError(409, 'Global dispatch pause is on: no new chargeable requests.');
  const model = ttsModel(env);
  const fetchImpl = deps.fetch ?? fetch;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let status = null;
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${p.direction}\n\nSay: ${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: s.provider_voice_id } } } },
      }),
    });
    status = res.status;
    const raw = await res.text();
    if (!res.ok) throw new HttpError(502, `Gemini TTS HTTP ${res.status}: ${raw.split(env.GEMINI_API_KEY).join('[redacted]').slice(0, 300)}`);
    const body = JSON.parse(raw);
    const part = body.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
    if (!part) throw new HttpError(502, 'Gemini TTS returned no audio');
    const usage = { input: body.usageMetadata?.promptTokenCount ?? null, output: body.usageMetadata?.candidatesTokenCount ?? null };
    await logTts(db, settings, { model, status, usage, started, ok: true });
    return { profileId, model, mimeType: part.inlineData.mimeType, audioBase64: part.inlineData.data, usage };
  } catch (e) {
    await logTts(db, settings, { model, status, started, ok: false, error: e.message });
    throw e instanceof HttpError ? e : new HttpError(502, `Gemini TTS request failed: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function logTts(db, settings, { model, status, usage, started, ok, error }) {
  const now = nowIso();
  await db
    .prepare(`INSERT INTO provider_calls (id, provider, model, purpose, task_id, status, http_status, input_tokens, output_tokens, cost_usd, latency_ms, error, created_at) VALUES (?,?,?,?,NULL,?,?,?,?,NULL,?,?,?)`)
    .bind(newId('pc'), TTS_PROVIDER, model, 'voice_preview', ok ? 'success' : 'error', status, usage?.input ?? null, usage?.output ?? null, Date.now() - started, error ? String(error).slice(0, 500) : null, now)
    .run();
  if (!ok) return;
  const price = await priceFor(db, TTS_PROVIDER, model);
  const ch = chargeFor(price, settings.provider_billing[TTS_PROVIDER] ?? 'unknown', tokenCostUsd(price, usage?.input ?? 0, usage?.output ?? 0));
  await db
    .prepare(`INSERT INTO cost_ledger (id, task_id, workflow_id, provider, model, purpose, calls, input_tokens, output_tokens, amount_usd, amount_inr, fx_rate, fx_at, basis, created_at) VALUES (?,NULL,NULL,?,?,'voice_preview',1,?,?,?,?,?,?,?,?)`)
    .bind(newId('cl'), TTS_PROVIDER, model, usage?.input ?? null, usage?.output ?? null, ch.usd, toInr(ch.usd, settings.fx_usd_inr), settings.fx_usd_inr?.rate ?? null, settings.fx_usd_inr?.at ?? null, ch.basis, now)
    .run();
}
