// End-to-end run of src/sync/sync.ts against a fake gallery + fake Supabase (verify/mocks).
// Checks the decisions the sync makes: what becomes a memory, what is skipped, what waits,
// and that two phones and repeated runs never duplicate anything.
import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';
import { bundleSync } from '../mocks/bundle';
import type { FakeAsset } from '../mocks/env';

let runSync: Awaited<ReturnType<typeof bundleSync>>['runSync'];
let world: Awaited<ReturnType<typeof bundleSync>>['world'];
let resetWorld: () => void;
before(async () => ({ runSync, world, resetWorld } = await bundleSync()));

const H = 3600e3;
const ME = 'user-me', PARTNER = 'user-partner', COUPLE = 'couple-1';
const people = [
  { id: 'p-me', couple_id: COUPLE, name: 'MJ', embeddings: [[1]] },
  { id: 'p-you', couple_id: COUPLE, name: 'NY', embeddings: [[1]] },
];
const SEONGSU = { lat: 37.5445, lng: 127.056 };
const JAMSIL = { lat: 37.5113, lng: 127.098 };
const HONGDAE = { lat: 37.5563, lng: 126.9236 };

let now = Date.now();
const realNow = Date.now;
const ago = (h: number) => now - h * H;
const photo = (id: string, hoursAgo: number, at: { lat: number; lng: number } | null, faces: string[], extra: Partial<FakeAsset> = {}): FakeAsset =>
  ({ id, time: ago(hoursAgo), lat: at?.lat ?? null, lng: at?.lng ?? null, faces, ...extra });

const sync = (userId: string) => runSync({ userId, coupleId: COUPLE, people });
const memories = () => world.tables.memories;
const photosOf = (m: { id: string }) => world.tables.photos.filter(p => p.memory_id === m.id);

beforeEach(() => {
  resetWorld();
  now = realNow();
  Date.now = () => now;
  world.storage.set('syncStart', String(ago(24 * 30)));
});

describe('sync', () => {
  test('an outing with us becomes one memory; strangers-only outing is skipped', async () => {
    world.gallery = [
      photo('a1', 50, SEONGSU, ['p-me', 'p-you']),
      photo('a2', 49.5, SEONGSU, []), // coffee
      photo('a3', 49, SEONGSU, ['p-you']),
      photo('b1', 26, JAMSIL, []), // a work event, nobody of us
      photo('b2', 25.5, JAMSIL, []),
    ];
    const r = await sync(ME);
    assert.deepEqual(r, { memories: 1, photos: 3 });
    assert.equal(memories().length, 1);
    const m = memories()[0];
    assert.deepEqual([...m.people].sort(), ['p-me', 'p-you']);
    assert.ok(Math.abs(m.lat - SEONGSU.lat) < 1e-6);
    assert.equal(world.summarizeCalls.length, 1);
    assert.deepEqual([...world.summarizeCalls[0].body.people].sort(), ['MJ', 'NY']);
  });

  test('cover photo is one with both of us when there is one', async () => {
    world.gallery = [
      photo('a1', 50, SEONGSU, ['p-me']),
      photo('a2', 49.5, SEONGSU, ['p-me', 'p-you']),
      photo('a3', 49, SEONGSU, ['p-you']),
    ];
    await sync(ME);
    const cover = world.tables.photos.find(p => p.id === memories()[0].cover_photo);
    assert.equal(cover.source_asset, 'a2');
  });

  test('running again uploads nothing new', async () => {
    world.gallery = [photo('a1', 50, SEONGSU, ['p-me']), photo('a2', 49, SEONGSU, ['p-you'])];
    await sync(ME);
    const r = await sync(ME);
    assert.deepEqual(r, { memories: 0, photos: 0 });
    assert.equal(world.tables.photos.length, 2);
  });

  test('an outing still going on (last photo < 3h ago) waits, then is saved later', async () => {
    world.gallery = [photo('c1', 1.5, HONGDAE, ['p-me', 'p-you']), photo('c2', 1, HONGDAE, ['p-me'])];
    const r1 = await sync(ME);
    assert.equal(r1.memories, 0, 'held while ongoing');
    now += 4 * H;
    world.gallery.push(photo('c3', 4.5, HONGDAE, ['p-you'])); // one more photo before they left
    const r2 = await sync(ME);
    assert.equal(r2.memories, 1);
    assert.equal(photosOf(memories()[0]).length, 3);
  });

  test("partner's photos of the same outing join the same memory", async () => {
    world.gallery = [photo('a1', 50, SEONGSU, ['p-me', 'p-you']), photo('a2', 49, SEONGSU, ['p-you'])];
    await sync(ME);
    // Partner's phone: different asset ids, same afternoon and place, a bit later.
    world.gallery = [photo('x1', 49.5, { lat: SEONGSU.lat + 0.002, lng: SEONGSU.lng }, ['p-me']), photo('x2', 48.5, SEONGSU, ['p-me'])];
    const r = await sync(PARTNER);
    assert.equal(r.memories, 1);
    assert.equal(memories().length, 1, 'no second memory');
    const m = memories()[0];
    assert.equal(photosOf(m).length, 4);
    assert.equal(Date.parse(m.ended_at), ago(48.5), 'memory extended to cover partner photos');
    assert.equal(world.summarizeCalls.length, 1, 'already summarized; partner sync does not re-summarize');
  });

  test('a photo that cannot be read is skipped, the rest still sync', async () => {
    world.gallery = [photo('a1', 50, SEONGSU, ['p-me']), photo('a2', 49.8, SEONGSU, ['p-you'], { broken: true }), photo('a3', 49.5, SEONGSU, ['p-you'])];
    const r = await sync(ME);
    assert.deepEqual(r, { memories: 1, photos: 2 });
  });

  test('photos without a timestamp are ignored instead of landing in 1970', async () => {
    world.gallery = [photo('a1', 50, SEONGSU, ['p-me']), { id: 'nt', time: null, lat: null, lng: null, faces: ['p-me'] }];
    await sync(ME);
    assert.ok(memories().every(m => Date.parse(m.started_at) > Date.parse('2000-01-01')));
    assert.ok(!world.tables.photos.some(p => p.source_asset === 'nt'));
  });

  test('a big backlog is processed over several runs without duplicates or split memories', async () => {
    // 450 photos on one long day at one place: more than one run's batch (400).
    world.gallery = Array.from({ length: 450 }, (_, i) => photo(`d${i}`, 60 - i * 0.004, SEONGSU, i % 3 === 0 ? ['p-me', 'p-you'] : []));
    await sync(ME);
    await sync(ME);
    await sync(ME);
    assert.equal(memories().length, 1, 'one day, one memory');
    const assets = world.tables.photos.map(p => p.source_asset);
    assert.equal(new Set(assets).size, assets.length, 'no photo uploaded twice');
  });

  test('if the network drops mid-way, the next run finishes the job without duplicates', async () => {
    world.gallery = [
      photo('a1', 50, SEONGSU, ['p-me']), photo('a2', 49.5, SEONGSU, ['p-you']),
      photo('e1', 30, JAMSIL, ['p-me']), photo('e2', 29.5, JAMSIL, ['p-you']),
    ];
    world.failUploadAfter = 3;
    await assert.rejects(sync(ME));
    world.failUploadAfter = Infinity;
    await sync(ME);
    assert.equal(memories().length, 2);
    const assets = world.tables.photos.map(p => p.source_asset).sort();
    assert.deepEqual(assets, ['a1', 'a2', 'e1', 'e2']);
    assert.ok(memories().every(m => m.summary), 'every memory got its summary in the end');
  });

  test('if only the AI summary fails, it is retried on a later run', async () => {
    world.gallery = [photo('a1', 50, SEONGSU, ['p-me']), photo('a2', 49.5, SEONGSU, ['p-you'])];
    await sync(ME);
    // Pretend the Claude API was down on that run: memory and photos saved, no summary.
    for (const m of memories()) Object.assign(m, { summary: null, title: null });
    await sync(ME);
    assert.ok(memories().every(m => m.summary), 'memory should get a summary on the next run');
  });

  test('no photo permission gives a clear error, nothing uploaded', async () => {
    world.permission = false;
    world.gallery = [photo('a1', 50, SEONGSU, ['p-me'])];
    await assert.rejects(sync(ME), /권한/);
    assert.equal(world.tables.photos.length, 0);
  });

  test('no registered faces gives a clear error', async () => {
    await assert.rejects(runSync({ userId: ME, coupleId: COUPLE, people: [] }), /얼굴/);
  });
});
