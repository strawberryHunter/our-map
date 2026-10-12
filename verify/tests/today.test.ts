// 오늘의 추억 (src/lib/today.ts)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { todaysMemories, type TodayMemory } from '../../src/lib/today';

const SEOUL = { lat: 37.5445, lng: 127.056 };
const JEJU = { lat: 33.4596, lng: 126.3106 };
const mem = (id: string, kstIso: string, at: { lat: number; lng: number } | null = SEOUL): TodayMemory =>
  ({ id, started_at: new Date(`${kstIso}+09:00`).toISOString(), lat: at?.lat ?? null, lng: at?.lng ?? null, title: id, place: null });
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const kinds = (xs: { kind: string; label: string }[]) => xs.map(x => x.label);

const ms = [
  mem('first', '2023-05-20T14:00:00'),
  mem('seongsu', '2024-10-12T13:00:00'),
  mem('jeju', '2025-03-01T10:00:00', JEJU),
  mem('hangang', '2025-10-12T19:00:00'),
  mem('late', '2025-10-12T23:30:00'),
];

test('N년 전 오늘: one card per year, newest first, both memories of that day', () => {
  const r = todaysMemories(ms, kst('2026-10-12T09:00:00'));
  assert.deepEqual(kinds(r), ['1년 전 오늘', '2년 전 오늘']);
  assert.deepEqual(r[0].memoryIds, ['hangang', 'late']);
});

test('uses Korea time: 23:30 KST on Oct 12 is Oct 12 (it is still Oct 12 14:30 UTC)', () => {
  const base = mem('base', '2024-01-01T12:00:00');
  const r = todaysMemories([base, mem('late', '2025-10-12T23:30:00')], kst('2026-10-12T00:10:00'));
  assert.deepEqual(kinds(r), ['1년 전 오늘']);
  // ...and early morning KST is the previous day in UTC: still the same KST date.
  const r2 = todaysMemories([base, mem('early', '2025-10-12T01:00:00')], kst('2026-10-12T23:00:00'));
  assert.deepEqual(kinds(r2), ['1년 전 오늘']);
});

test('첫 추억 N주년 on the first memory\'s date', () => {
  const r = todaysMemories(ms, kst('2026-05-20T08:00:00'));
  assert.deepEqual(kinds(r), ['첫 추억 3주년'], 'not also shown as "3년 전 오늘"');
});

test('첫 여행 N주년: first memory far from home', () => {
  const r = todaysMemories(ms, kst('2026-03-01T12:00:00'));
  assert.ok(kinds(r).includes('첫 여행 1주년'), JSON.stringify(r));
});

test('D+100 counts the first day as day 1', () => {
  // 2023-05-20 is day 1 -> day 100 is 2023-08-27
  assert.ok(kinds(todaysMemories(ms, kst('2023-08-27T10:00:00'))).includes('첫 추억 D+100'));
  assert.ok(!kinds(todaysMemories(ms, kst('2023-08-28T10:00:00'))).includes('첫 추억 D+100'));
  assert.ok(!kinds(todaysMemories(ms, kst('2026-02-13T10:00:00'))).some(l => l.startsWith('첫 추억 D+')), 'no milestone the day after');
  assert.ok(kinds(todaysMemories(ms, kst('2026-02-12T10:00:00'))).includes('첫 추억 D+1000'));
});

test('Feb 29 memories show on Feb 28 in non-leap years', () => {
  const leap = [mem('base', '2023-01-01T12:00:00'), mem('leap', '2024-02-29T15:00:00')];
  assert.deepEqual(kinds(todaysMemories(leap, kst('2025-02-28T10:00:00'))), ['1년 전 오늘']);
  assert.deepEqual(kinds(todaysMemories(leap, kst('2028-02-29T10:00:00'))), ['4년 전 오늘']);
  assert.ok(!kinds(todaysMemories(leap, kst('2028-02-28T10:00:00'))).includes('4년 전 오늘'));
});

test('nothing special today: shows memories from around this date', () => {
  const r = todaysMemories(ms, kst('2026-10-14T10:00:00'));
  assert.deepEqual(kinds(r), ['이맘때의 우리']);
  assert.ok(r[0].memoryIds.includes('hangang'));
});

test('no memories, or only today\'s, shows nothing', () => {
  assert.deepEqual(todaysMemories([], Date.now()), []);
  assert.deepEqual(todaysMemories([mem('now', '2026-10-12T10:00:00')], kst('2026-10-12T12:00:00')), []);
});

test('future-dated memories (wrong camera clock) are ignored', () => {
  assert.deepEqual(todaysMemories([mem('future', '2030-10-12T10:00:00')], kst('2026-10-12T12:00:00')), []);
});
