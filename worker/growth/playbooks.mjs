// MUSHAK sales playbooks — the skills each Growth agent job loads into its prompt.
// Adapted from the MIT-licensed skill files of github.com/ethanplusai/harvey (Copyright (c) 2026 Ethan Rogers),
// rewritten for Ganesha AI Studio's three brands and rules. Deliberately NOT adopted from that source:
// email-pattern guessing and SMTP probing (we store only generic business mailboxes), LinkedIn profile search
// and LinkedIn automation (against LinkedIn's terms), and any automated sending (the owner approves and sends).

const PROSPECTING = `PLAYBOOK · FINDING (prospecting)
- Prefer prospects with a real, current trigger: hiring for a related role, a new product/book/app/album launch, a recent raise or expansion, an active collab or sponsorship programme, a "partner with us" / "submit your music" / "work with us" page.
- Good public sources: the organisation's own site (about, team, partners, press, careers pages), its press releases and blog, news articles, job boards, and public creator pages. Never personal profiles behind logins.
- Each lead needs: real name, own website, one-line description, category, location, and the exact source URL for each fact. If a field cannot be verified, leave it empty; never guess.
- Skip: unrelated industries, brands failing the brand safety filter, organisations with no public business contact route, anyone already in the CRM or who opted out.
- Quality over volume: a few sharp, relevant prospects beat a long generic list.`;

const SIGNALS = `PLAYBOOK · SIGNALS
- A signal is the reason to contact them now. Rank: hiring > recent raise/launch > active partner/collab programme > visible gap next to what we offer > general industry problem > none.
- Record at most the 2-3 strongest signals with source URL and date. Note how old each one is; a signal older than ~3 months is "aged" and must not be presented as current.
- If there is no real signal, say so plainly. Do not dress up "they exist and match the profile" as a signal.`;

const QUALIFICATION = `PLAYBOOK · QUALIFICATION (BANT mapped to our score)
- fit = ideal-profile match (category, size, audience, geography) and, if known, whether the listed role decides on partnerships/purchases.
- need = evidence they need what the brand offers now (signals, programmes, gaps) plus timeline signals; "not now" is not zero but is low.
- commercial = ability to pay or bring value (budget signals: size, funding, existing sponsorships/paid tools).
- access = a public decision-maker role and a public business contact route (generic mailbox or official form) — none means low.
- evidence = how fresh and verified the sources are.
- Disqualify (give low fit and say why): wrong industry, fails brand safety, no public contact route, already opted out, locked into a direct competitor with no switching signal.
- Priority: 80+ contact first with a personal message; 60-79 batch later; below 60 hold.`;

const WRITING = `PLAYBOOK · WRITING (outreach)
- Purpose of a first message: start a conversation, not close a deal. No pitch, no price, no attachment, at most one link (none is better).
- Open with the prospect, not with "I"/"We". The first sentence states ONE verified signal or observation plainly. Never claim more than the evidence proves.
- One idea, one question. Prefer an easy-yes or offer CTA ("want the 3 reel ideas we'd make for you?", "is this on your radar at all?") over "can we get on a 30-minute call?".
- Length: first contact 50-110 words; follow-ups under 60 words and a NEW angle (never "just following up"); the last follow-up closes the loop politely with no pitch.
- Subject: honest, 2-5 words, lowercase, no name, no "quick question", never a fake "re:" or "fwd:".
- Sound like a real person: plain text, no bullet points or bold, no exclamation marks, no em dashes, short sentences, contractions.
- Never use: "I hope this finds you well", "just following up", "picture this", "imagine if", "what if I told you", "game-changer", "revolutionary", "cutting-edge", "in today's ...", "I'd love to", "no pressure".
- Build the message around one reply trigger: recognition (their real situation in their words), honest curiosity, an easy yes, or a real public peer example. Never invent customers, numbers, mutual contacts, referrals or urgency.
- Identity is always the real brand. If asked whether the message was written with AI help, the owner answers truthfully.`;

const OFFERS = `PLAYBOOK · OFFER LADDER
- Curious (asked a question) → answer it plus a soft next step. Interested (shared a need) → one relevant sample or idea, then suggest a short call. Ready (asked price/timeline/next steps) → the concrete offer and the exact next step. Never jump a level.
- When asked about price, give a real answer from the brand's verified pricing or say the owner will confirm; never dodge, never invent a discount.
- For meetings: propose 2-3 specific day/time options with the time zone; the owner confirms every meeting himself.`;

const REPLIES = `PLAYBOOK · REPLIES & OBJECTIONS
- First diagnose: reflex brush-off (instant "not interested"), condition (a fact like "under contract till March" → note the date, follow up only then), smokescreen ("too expensive" without asking the price → real issue is priority or trust), or genuine objection (specific and engaged → worth a real answer).
- Categories: budget, authority ("not the right person" → ask who is, politely), need ("we already have this" → ask what they'd improve, or leave a seed), timing (agree a date).
- Respond with Listen → Acknowledge → Assess → Respond → Confirm. One answer per objection; if they push back again, respect it. Match their length: a one-line reply gets a shorter answer.
- Hard rules: any opt-out wording ("stop", "remove me", "no thanks") is final and permanent everywhere; anger or "this is spam" / "how did you get my email" → one short factual apology with the data source, stop, flag for the owner; "not interested" is final.`;

const ACCOUNTS = `PLAYBOOK · ACCOUNT RULES
- One contact per organisation at a time. Wait at least 5 business days before contacting a second person there, and share context between them.
- Stop after 3 people at one organisation have not replied, or after about 6 touches over 2-4 weeks with one person.
- Start at the level that feels the problem and can say yes: small deals → the person who would use it; larger ones → the head of the function.`;

/** Which playbooks each Growth job loads (mirrors the skill → agent map of the source project). */
export const PLAYBOOKS_FOR = Object.freeze({
  discover: [PROSPECTING, SIGNALS],
  research: [PROSPECTING, SIGNALS, ACCOUNTS],
  qualify: [QUALIFICATION, SIGNALS],
  draft: [SIGNALS, WRITING, OFFERS, ACCOUNTS],
  classify_reply: [REPLIES, OFFERS],
});

/** The playbook text for one job kind ('' for kinds without playbooks). */
export function playbookFor(kind) {
  return (PLAYBOOKS_FOR[kind] ?? []).join('\n\n');
}

/** One-line skill list for MUSHAK's own system prompt. */
export const MUSHAK_SKILLS =
  'SKILLS (sales playbooks your agents follow): signal-based prospecting from public sources; BANT-style qualification mapped to the 5-part score; short, honest, signal-first outreach (one idea, one easy-yes question, no fake "re:", no hype); offer ladder (no pitch before interest); objection diagnosis (brush-off / condition / smokescreen / genuine) with one answer per objection; account rules (one contact per organisation at a time, stop after 3 silent contacts or ~6 touches). Opt-outs are final everywhere.';

// Phrases that make a draft read as a template or as AI. They do not block a draft (the owner can still
// approve it) but are shown to the owner as style flags in Approvals.
const STYLE_FLAGS = [
  [/hope this (email |message )?finds you well/i, '"hope this finds you well"'],
  [/\bjust (following|checking) (up|in)\b/i, '"just following up"'],
  [/\bpicture this\b/i, '"picture this"'],
  [/\bimagine if\b/i, '"imagine if"'],
  [/\bwhat if i told you\b/i, '"what if I told you"'],
  [/\b(game[- ]changer|revolutionary|cutting[- ]edge)\b/i, 'hype word'],
  [/\bin today's\b/i, '"in today\'s …"'],
  [/\bno pressure\b/i, '"no pressure"'],
  [/—/, 'em dash'],
  [/!/, 'exclamation mark'],
];

/** Style flags for a draft body (non-blocking). */
export function styleFlags(body) {
  const text = String(body ?? '');
  const out = STYLE_FLAGS.filter(([re]) => re.test(text)).map(([, label]) => label);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words > 140) out.push(`${words} words (aim for 50-110)`);
  return out;
}

/** A first-contact subject that pretends to continue a thread is deceptive (blocks the draft). */
export function deceptiveSubject(subject, kind) {
  return kind === 'first_contact' && /^\s*(re|fwd?)\s*:/i.test(String(subject ?? ''));
}
