// GANESHA GROWTH AI — brand configurations. Exactly three brands are authorised for Growth AI:
// LittleLoop, Sunverse (SURVERSE) and Foliocraft. Adding another brand is a deliberate code change
// (this file + the CHECK constraints in migrations/0017_growth.sql) — there is no runtime path to add one.
import { HttpError, nowIso } from '../util.mjs';

export const GROWTH_BRAND_IDS = Object.freeze(['littleloop', 'sunverse', 'foliocraft']);

// Score components and their maximum points (sum = 100). Brands may re-weight within these keys.
export const SCORE_COMPONENTS = Object.freeze({
  fit: { label: 'Ideal customer / partner fit', max: 30 },
  need: { label: 'Need and buying / collaboration signals', max: 25 },
  commercial: { label: 'Commercial potential', max: 20 },
  access: { label: 'Decision-maker accessibility', max: 15 },
  evidence: { label: 'Evidence quality and freshness', max: 10 },
});

const OPT_OUT = 'If this is not relevant, just reply "no thanks" and we will not contact you again.';

export const GROWTH_BRANDS = Object.freeze({
  littleloop: {
    name: 'LittleLoop',
    description: 'Original animated shorts for children aged 2–8 on Instagram (@little_loop09): gentle, kind, educational stories.',
    valueProposition: 'Safe, original, high-quality kids animation with a growing family audience — open to sponsorships, licensing and distribution.',
    idealProfile: 'Family-focused and children\'s brands, kids-content platforms, edtech for early learners, children\'s publishers, animation studios and family creators whose values fit a toddler audience.',
    prospectCategories: ['parenting pages & family creators (collab reels)', 'children\'s brands', 'family-focused businesses', 'kids edtech', 'children\'s publishers', 'content licensing & distribution', 'animation studios', 'family creators & platforms'],
    geography: 'India first, then English-speaking markets',
    goals: ['followers who share reels (collabs and reshares with parenting pages)', 'brand sponsorships', 'content licensing', 'distribution partnerships', 'animation collaborations'],
    metrics: ['qualified partners', 'replies', 'meetings', 'signed deals'],
    objectives: ['sponsorship', 'licensing', 'distribution', 'partnership', 'creator_collaboration'],
    messaging: {
      tone: 'Warm, professional, concise. Parents and child-safety first.',
      must: ['Mention only verified facts about the prospect', 'Be clear LittleLoop is a small, growing channel — no inflated audience claims', OPT_OUT],
      mustNot: ['Exaggerated reach or engagement numbers', 'Pressure tactics', 'Any targeting of children directly'],
    },
    safety: 'Child-safety and brand-suitability filter: exclude alcohol, tobacco/vaping, gambling/betting, weapons, adult content, dating, crypto/speculative finance, junk-food marketing aimed at kids, and any brand with recent child-safety controversies.',
    budget: { monthlyJobLimit: 300 },
  },
  sunverse: {
    name: 'Sunverse / SURVERSE',
    description: 'YouTube music channel (@SURVERSE_09) and music production house.',
    valueProposition: 'Original music, production and creator collaborations — open to artist features, licensing enquiries and promotion partnerships.',
    idealProfile: 'Independent artists, producers, small labels and distributors, music licensing platforms, playlist and music-media curators, and creators who need original music.',
    prospectCategories: ['independent artists', 'music producers', 'labels & distributors', 'music licensing', 'creator collaborations', 'playlist & media partners'],
    geography: 'India first, then global',
    goals: ['YouTube subscribers through artist collabs, features and Shorts', 'artist collaborations', 'licensing opportunities', 'distribution'],
    metrics: ['qualified collaborators', 'replies', 'meetings', 'agreements'],
    objectives: ['creator_collaboration', 'licensing', 'distribution', 'partnership'],
    messaging: {
      tone: 'Friendly, creative, respectful of the artist\'s work.',
      must: ['Mention only verified facts', 'Never claim a track is licensed, cleared or commercially available unless that is verified', OPT_OUT],
      mustNot: ['Unverified streaming numbers', 'Promises of placements or chart results'],
    },
    safety: 'Do not claim rights, clearances or availability that are not verified. Original work only.',
    budget: { monthlyJobLimit: 300 },
  },
  foliocraft: {
    name: 'Foliocraft',
    description: 'Portfolio website builder with paid premium features.',
    valueProposition: 'Professional portfolio sites in minutes for freelancers, creators, students and job seekers — with partner and distribution options for agencies and communities.',
    idealProfile: 'Individuals: freelancers, designers, developers, creators, students and job seekers. Businesses: agencies, bootcamps, colleges, career and creator communities, and integration partners.',
    prospectCategories: ['freelancers', 'students & job seekers', 'creators', 'agencies', 'career & education communities', 'B2B / integration partners'],
    geography: 'India first, then global',
    goals: ['paying customers who buy portfolios (individual segment)', 'B2B / distribution partnerships (business segment)'],
    metrics: ['qualified leads', 'replies', 'demos', 'conversions — tracked separately for individual and business campaigns'],
    objectives: ['customer_acquisition', 'partnership', 'distribution'],
    messaging: {
      tone: 'Helpful, practical, outcome-focused.',
      must: ['Mention only verified facts', 'Individual and business campaigns use different messages and metrics', OPT_OUT],
      mustNot: ['Fake scarcity or discounts', 'Claims about competitors that are not verified'],
    },
    safety: 'No collection of sensitive personal data. Individuals are contacted only through public professional channels.',
    budget: { monthlyJobLimit: 300 },
  },
});

/** Throws unless brand is one of the three authorised Growth brands. Backend scoping starts here. */
export function assertBrand(brand) {
  if (!GROWTH_BRAND_IDS.includes(brand)) throw new HttpError(400, `Growth AI supports only ${GROWTH_BRAND_IDS.join(', ')}`);
  return brand;
}

const EDITABLE = ['description', 'valueProposition', 'idealProfile', 'prospectCategories', 'geography', 'goals', 'metrics', 'messaging', 'weights', 'budget'];

export async function getBrandConfig(db, brand) {
  assertBrand(brand);
  const base = structuredClone(GROWTH_BRANDS[brand]);
  const row = await db.prepare('SELECT config_json, updated_at FROM growth_brand_config WHERE brand = ?').bind(brand).first();
  let over = {};
  try {
    over = row ? JSON.parse(row.config_json) : {};
  } catch {
    over = {};
  }
  const cfg = { ...base, ...over, id: brand, weights: weightsOf(over.weights), updatedAt: row?.updated_at ?? null };
  return cfg;
}

export async function listBrandConfigs(db) {
  return Promise.all(GROWTH_BRAND_IDS.map((b) => getBrandConfig(db, b)));
}

function weightsOf(w) {
  const out = Object.fromEntries(Object.entries(SCORE_COMPONENTS).map(([k, v]) => [k, v.max]));
  if (!w || typeof w !== 'object') return out;
  const keys = Object.keys(SCORE_COMPONENTS);
  const ok = keys.every((k) => Number.isInteger(w[k]) && w[k] >= 0 && w[k] <= 100) && keys.reduce((a, k) => a + w[k], 0) === 100;
  return ok ? Object.fromEntries(keys.map((k) => [k, w[k]])) : out;
}

export async function saveBrandConfig(db, brand, patch) {
  assertBrand(brand);
  if (!patch || typeof patch !== 'object') throw new HttpError(400, 'Body must be an object');
  const row = await db.prepare('SELECT config_json FROM growth_brand_config WHERE brand = ?').bind(brand).first();
  const cur = row ? JSON.parse(row.config_json) : {};
  for (const [k, v] of Object.entries(patch)) {
    if (!EDITABLE.includes(k)) throw new HttpError(400, `${k} cannot be changed`);
    if (k === 'weights') {
      const keys = Object.keys(SCORE_COMPONENTS);
      if (!v || keys.some((x) => !Number.isInteger(v[x]) || v[x] < 0) || keys.reduce((a, x) => a + v[x], 0) !== 100) throw new HttpError(400, `weights must be whole numbers for ${keys.join(', ')} adding up to 100`);
    }
    if (JSON.stringify(v).length > 5000) throw new HttpError(400, `${k} is too long`);
    cur[k] = v;
  }
  await db.prepare('INSERT INTO growth_brand_config (brand, config_json, updated_at) VALUES (?,?,?) ON CONFLICT(brand) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at').bind(brand, JSON.stringify(cur), nowIso()).run();
  return getBrandConfig(db, brand);
}
