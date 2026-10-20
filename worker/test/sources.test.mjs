// Free lead sources for Mushak; every network call is MOCKED.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getBindings, disposeDb, resetDb } from './helpers.mjs';
import { readSite, youtubeChannels } from '../growth/sources.mjs';
import * as core from '../growth/core.mjs';
import { youtubeDiscover } from '../growth/agents.mjs';

let db;
before(async () => ({ DB: db } = await getBindings()));
after(disposeDb);
beforeEach(() => resetDb(db));

const html = (body, type = 'text/html') => new Response(body, { status: 200, headers: { 'content-type': type } });

test('website reader: robots.txt honoured, only business mailboxes on the same domain, social links kept', async () => {
  const seen = [];
  const fetch = async (url) => {
    seen.push(String(url));
    if (url.endsWith('/robots.txt')) return html('User-agent: *\nDisallow: /about', 'text/plain');
    if (url.endsWith('/contact')) return html('<a href="mailto:Partnerships@tinytoys.in">x</a> priya.k@tinytoys.in hello@gmail.com <a href="https://www.instagram.com/tinytoys/">ig</a>');
    return html('<title>Tiny Toys</title><meta name="description" content="Wooden toys for toddlers">');
  };
  const r = await readSite('https://www.tinytoys.in/shop', { fetch });
  assert.deepEqual(r.emails, ['partnerships@tinytoys.in'], 'role mailbox only, same domain');
  assert.deepEqual(r.socials, ['https://www.instagram.com/tinytoys']);
  assert.equal(r.title, 'Tiny Toys');
  assert.ok(!seen.some((u) => u.endsWith('/about')), '/about is disallowed by robots.txt');
  const blocked = await readSite('tinytoys.in', { fetch: async (u) => (u.endsWith('/robots.txt') ? html('User-agent: *\nDisallow: /', 'text/plain') : assert.fail('must not read')) });
  assert.equal(blocked.blocked, true);
  assert.equal(await readSite('not a url', { fetch }), null);
});

test('YouTube creator search → leads with API facts; unsafe channels skipped for LittleLoop; job logged at ₹0', async () => {
  const fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/search')) return Response.json({ items: [{ id: { channelId: 'A' } }, { id: { channelId: 'B' } }, { id: { channelId: 'C' } }] });
    return Response.json({ items: [
      { id: 'A', snippet: { title: 'Rhyme Rabbit', customUrl: '@rhymerabbit', description: 'Nursery rhymes', country: 'IN' }, statistics: { subscriberCount: '12000', videoCount: '80', viewCount: '900000' } },
      { id: 'B', snippet: { title: 'Scary Prank TV', description: 'horror pranks' }, statistics: { subscriberCount: '5000', videoCount: '10', viewCount: '1' } },
      { id: 'C', snippet: { title: 'Empty', description: '' }, statistics: { videoCount: '0' } },
    ] });
  };
  await assert.rejects(youtubeChannels({}, 'x'), /YOUTUBE_API_KEY/);
  const list = await youtubeChannels({ YOUTUBE_API_KEY: 'k' }, 'kids', {}, { fetch });
  assert.equal(list.length, 2, 'channels with no videos dropped');
  const c = await core.createCampaign(db, { brand: 'littleloop', name: 'Kids creators', objective: 'creator_collaboration' });
  await core.setCampaignStatus(db, c.id, 'activate');
  const r = await youtubeDiscover({ YOUTUBE_API_KEY: 'k' }, db, c.id, {}, { fetch });
  assert.deepEqual(r.created.map((l) => l.name), ['Rhyme Rabbit']);
  assert.match(r.skipped[0].reason, /not suitable/);
  assert.match(r.created[0].evidence, /12,000 subscribers/);
  assert.equal(r.created[0].website, 'https://www.youtube.com/@rhymerabbit');
  const job = await db.prepare('SELECT * FROM growth_jobs').first();
  assert.equal(job.status, 'succeeded');
  assert.equal(job.cost_usd, 0);
});
