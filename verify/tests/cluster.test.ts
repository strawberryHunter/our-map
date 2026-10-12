// Edge cases for grouping photos into outings (src/sync/cluster.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterPhotos, distanceKm, sameOuting, type PhotoMeta } from '../../src/sync/cluster';

const H = 3600e3;
const T0 = Date.parse('2026-10-03T11:00:00+09:00');
const SEONGSU: [number, number] = [37.5445, 127.0560];
const JAMSIL: [number, number] = [37.5113, 127.0980];
const JEJU: [number, number] = [33.4596, 126.3106];
const p = (id: string, hours: number, at: [number, number] | null): PhotoMeta =>
  ({ id, time: T0 + hours * H, lat: at?.[0] ?? null, lng: at?.[1] ?? null });
const ids = (o: { photos: PhotoMeta[] }[]) => o.map(x => x.photos.map(y => y.id).join(''));
const jitter = (at: [number, number], m: number): [number, number] => [at[0] + m / 111_000, at[1]];

test('one afternoon in one neighbourhood is one outing', () => {
  const o = clusterPhotos([p('a', 0, SEONGSU), p('b', 0.5, jitter(SEONGSU, 200)), p('c', 1.2, jitter(SEONGSU, -150))]);
  assert.deepEqual(ids(o), ['abc']);
});

test('a 3h+ gap starts a new outing', () => {
  assert.deepEqual(ids(clusterPhotos([p('a', 0, SEONGSU), p('b', 3.5, SEONGSU)])), ['a', 'b']);
});

test('moving to another district (>5 km) starts a new outing', () => {
  assert.ok(distanceKm(...SEONGSU, ...JAMSIL) > 5);
  assert.deepEqual(ids(clusterPhotos([p('a', 0, SEONGSU), p('b', 0.5, SEONGSU), p('c', 1, JAMSIL)])), ['ab', 'c']);
});

test('input order does not matter', () => {
  const o = clusterPhotos([p('c', 1, SEONGSU), p('a', 0, SEONGSU), p('b', 0.5, SEONGSU)]);
  assert.deepEqual(ids(o), ['abc']);
});

test('photos without GPS (e.g. from a messenger) stay with their time neighbours', () => {
  const o = clusterPhotos([p('a', 0, SEONGSU), p('b', 0.3, null), p('c', 0.6, SEONGSU)]);
  assert.deepEqual(ids(o), ['abc']);
  assert.ok(Math.abs(o[0].lat! - SEONGSU[0]) < 1e-6);
});

test('an outing with no GPS at all has no location (not placed on the map)', () => {
  const o = clusterPhotos([p('a', 0, null), p('b', 0.5, null)]);
  assert.equal(o.length, 1);
  assert.equal(o[0].lat, null);
});

test('indoor GPS drift (~1 km) does not split an outing', () => {
  const o = clusterPhotos([p('a', 0, SEONGSU), p('b', 0.2, jitter(SEONGSU, 900)), p('c', 0.4, jitter(SEONGSU, -800)), p('d', 0.6, SEONGSU)]);
  assert.deepEqual(ids(o), ['abcd']);
});

test('a single wild GPS fix in the middle does not split an outing into three', () => {
  // One bad fix ~40 km away between normal photos; real life: phone grabbed a stale/cell location.
  const o = clusterPhotos([p('a', 0, SEONGSU), p('b', 0.3, SEONGSU), p('x', 0.5, [37.9, 127.06]), p('c', 0.7, SEONGSU), p('d', 0.9, SEONGSU)]);
  assert.deepEqual(ids(o), ['abxcd']);
  assert.ok(distanceKm(o[0].lat!, o[0].lng!, ...SEONGSU) < 0.5, 'center should ignore the outlier');
});

test('a real move is still detected when the first photo there is followed by more', () => {
  const o = clusterPhotos([p('a', 0, SEONGSU), p('b', 0.5, SEONGSU), p('c', 1, JAMSIL), p('d', 1.3, JAMSIL)]);
  assert.deepEqual(ids(o), ['ab', 'cd']);
});

test('the last photo of a sync batch can be at a new place on its own', () => {
  const o = clusterPhotos([p('a', 0, SEONGSU), p('b', 0.5, SEONGSU), p('c', 1, JEJU)]);
  assert.deepEqual(ids(o), ['ab', 'c']);
});

test('an outing that crosses midnight stays one outing', () => {
  const late = Date.parse('2026-10-03T23:30:00+09:00');
  const o = clusterPhotos([
    { id: 'a', time: late, lat: SEONGSU[0], lng: SEONGSU[1] },
    { id: 'b', time: late + 1 * H, lat: SEONGSU[0], lng: SEONGSU[1] },
  ]);
  assert.equal(o.length, 1);
});

test('two phones: same outing matches, different place or day does not', () => {
  const mine = { start: T0, end: T0 + 2 * H, lat: SEONGSU[0], lng: SEONGSU[1] };
  assert.equal(sameOuting(mine, { start: T0 + 1 * H, end: T0 + 3 * H, lat: jitter(SEONGSU, 300)[0], lng: SEONGSU[1] }), true);
  assert.equal(sameOuting(mine, { start: T0 + 1 * H, end: T0 + 2 * H, lat: JAMSIL[0], lng: JAMSIL[1] }), false);
  assert.equal(sameOuting(mine, { start: T0 + 24 * H, end: T0 + 25 * H, lat: SEONGSU[0], lng: SEONGSU[1] }), false);
  assert.equal(sameOuting(mine, { start: T0 + 0.5 * H, end: T0 + 1 * H, lat: null, lng: null }), true);
});

test('large library: 10k photos cluster in well under a second', () => {
  const many: PhotoMeta[] = [];
  for (let i = 0; i < 10_000; i++) many.push(p(String(i), i * 0.05, jitter(SEONGSU, (i % 7) * 30)));
  const t = performance.now();
  const o = clusterPhotos(many);
  const ms = performance.now() - t;
  assert.equal(o.length, 1);
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
});
