// Parsing the AI summary reply (supabase/functions/summarize/parse.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSummary } from '../../supabase/functions/summarize/parse';

test('plain JSON', () => {
  assert.deepEqual(parseSummary('{"title":"성수 빵지순례","place":"성수동","summary":"빵집 세 곳을 돌았다."}', null),
    { title: '성수 빵지순례', place: '성수동', summary: '빵집 세 곳을 돌았다.' });
});

test('JSON inside a code fence with prose around it', () => {
  const r = parseSummary('여기 있어요:\n```json\n{"title":"한강 피크닉","place":"반포","summary":"돗자리 폈다."}\n```\n즐거운 하루!', null);
  assert.equal(r.title, '한강 피크닉');
});

test('summary containing braces does not break parsing', () => {
  const r = parseSummary('{"title":"코딩 데이트","place":"카페","summary":"노트북에 {중괄호} 가득."}', null);
  assert.equal(r.summary, '노트북에 {중괄호} 가득.');
});

test('missing place falls back to the map lookup', () => {
  assert.equal(parseSummary('{"title":"t","summary":"s"}', '서울 성동구').place, '서울 성동구');
});

test('garbage reply gives empty fields instead of an error', () => {
  assert.deepEqual(parseSummary('죄송하지만 사진을 볼 수 없어요.', '제주'), { title: null, place: '제주', summary: null });
  assert.deepEqual(parseSummary('{"title": "broken', null), { title: null, place: null, summary: null });
});

test('non-string fields and overly long text are cleaned', () => {
  const r = parseSummary(JSON.stringify({ title: 42, place: '  성수  동 ', summary: 'ㅋ'.repeat(1000) }), null);
  assert.equal(r.title, null);
  assert.equal(r.place, '성수 동');
  assert.equal(r.summary!.length, 400);
});
