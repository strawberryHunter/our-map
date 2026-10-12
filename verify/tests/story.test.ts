// AI story prompt + reply parsing (supabase/functions/_shared/story.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStoryPrompt, parseStory, type StoryInput } from '../../supabase/functions/_shared/story';

const base: StoryInput = {
  startedAt: '2026-10-03T05:00:00Z', endedAt: '2026-10-03T09:00:00Z',
  placeSource: 'gps', placeHint: '서울 성동구 성수동', people: ['MJ', 'NY'], memo: null, photoCount: 4,
};

test('prompt: memo is included and marked as the most important facts', () => {
  const p = buildStoryPrompt({ ...base, memo: '처음으로 같이 크루아상 만들기 클래스 들은 날' });
  assert.match(p, /크루아상 만들기 클래스/);
  assert.match(p, /메모/);
});

test('prompt: times are shown in Korea time', () => {
  assert.match(buildStoryPrompt(base), /오후 2:00/);
});

test('prompt: without GPS the AI is told not to guess a place', () => {
  const p = buildStoryPrompt({ ...base, placeSource: null, placeHint: null });
  assert.match(p, /추측하거나 지어내지/);
  assert.doesNotMatch(p, /성수/);
});

test('parse: plain JSON with GPS place', () => {
  assert.deepEqual(parseStory('{"title":"성수 빵지순례","place":"성수동 카페거리","summary":"빵집 세 곳을 돌았다."}', base),
    { title: '성수 빵지순례', place: '성수동 카페거리', summary: '빵집 세 곳을 돌았다.' });
});

test('parse: no GPS -> place stays empty even if the AI names one', () => {
  const r = parseStory('{"title":"t","place":"강남역","summary":"s"}', { placeSource: null, placeHint: null });
  assert.equal(r.place, null);
});

test('parse: a place we set by hand is kept, whatever the AI says', () => {
  const r = parseStory('{"title":"t","place":"다른 곳","summary":"s"}', { placeSource: 'manual', placeHint: '서울숲 피크닉' });
  assert.equal(r.place, '서울숲 피크닉');
});

test('parse: GPS but AI gave no place -> map lookup result', () => {
  assert.equal(parseStory('{"title":"t","summary":"s"}', base).place, '서울 성동구 성수동');
});

test('parse: JSON inside a code fence with prose around it', () => {
  assert.equal(parseStory('여기요:\n```json\n{"title":"한강 피크닉","place":"반포","summary":"돗자리"}\n```\n끝', base).title, '한강 피크닉');
});

test('parse: braces inside the story do not break parsing', () => {
  assert.equal(parseStory('{"title":"t","place":"p","summary":"노트북에 {중괄호} 가득."}', base).summary, '노트북에 {중괄호} 가득.');
});

test('parse: garbage reply gives empty fields instead of an error', () => {
  assert.deepEqual(parseStory('죄송하지만 사진을 볼 수 없어요.', base), { title: null, place: '서울 성동구 성수동', summary: null });
  assert.deepEqual(parseStory('{"title": "broken', { placeSource: null, placeHint: null }), { title: null, place: null, summary: null });
});

test('parse: non-string fields and overly long text are cleaned', () => {
  const r = parseStory(JSON.stringify({ title: 42, place: '  성수  동 ', summary: 'ㅋ'.repeat(1000) }), base);
  assert.equal(r.title, null);
  assert.equal(r.place, '성수 동');
  assert.equal(r.summary!.length, 600);
});
