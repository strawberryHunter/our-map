// AI date course (supabase/functions/_shared/course.ts): taste from our memories, prompt, parsing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaOf, buildCoursePrompt, buildTaste, dropVisited, parseCourse, type MemoryLite } from '../../supabase/functions/_shared/course';

const m = (kst: string, place: string | null, title: string, memo: string | null = null): MemoryLite =>
  ({ started_at: new Date(`${kst}+09:00`).toISOString(), place, title, summary: null, memo });
const ours = [
  m('2026-08-15T13:00:00', '서울 성동구 성수동 · 대림창고', '성수 빵지순례', '소금빵 맛집 3군데'),
  m('2026-08-30T19:00:00', '서울 성동구 성수동', '성수 와인바'),
  m('2026-09-06T18:30:00', '서울 송파구 잠실동 · 롯데월드', '롯데월드 야간개장'),
  m('2026-09-20T14:00:00', '서울 종로구 삼청동', '삼청동 전시', '국립현대미술관 전시 보고 카페'),
  m('2026-10-03T11:00:00', null, '비 오는 날 영화'),
];

test('areaOf keeps the neighbourhood', () => {
  assert.equal(areaOf('서울 성동구 성수동 · 대림창고'), '성동구 성수동');
  assert.equal(areaOf('성수동 카페거리'), '성수동 카페거리');
});

test('taste: top area, interests from titles/memos, evening share, visited list', () => {
  const t = buildTaste(ours);
  assert.equal(t.areas[0].name, '성동구 성수동');
  assert.equal(t.areas[0].count, 2);
  for (const w of ['빵집', '전시', '카페', '술', '영화']) assert.ok(t.words.includes(w), `${w} in ${t.words}`);
  assert.equal(t.evening, 2 / 5);
  assert.ok(t.visited.includes('서울 송파구 잠실동 · 롯데월드'));
  assert.equal(t.recent[0], '비 오는 날 영화');
});

test('prompt: defaults to our most visited area, lists places to avoid, demands web-verified places', () => {
  const p = buildCoursePrompt(buildTaste(ours), { mood: '조용한', budget: '5~10만원' });
  assert.match(p, /지역: 성동구 성수동/);
  assert.match(p, /이미 가본 곳.*대림창고/);
  assert.match(p, /웹 검색으로 지금 실제로 영업 중인 장소만/);
  assert.match(p, /분위기: 조용한/);
  assert.doesNotMatch(p, /하고 싶은 말/);
});

test('prompt: works for a brand-new couple with no memories', () => {
  const p = buildCoursePrompt(buildTaste([]), {});
  assert.match(p, /지역: 서울/);
  assert.match(p, /저장된 추억 0개/);
});

const reply = `검색해보니 좋은 곳이 많네요.
{"title":"성수 조용한 오후","summary":"빵, 전시, 와인으로 이어지는 코스","stops":[
 {"name":"어니언 성수","address":"서울 성동구 아차산로9길 8","time":"13:00","category":"카페","why":"빵집을 자주 갔으니","url":"https://example.com/a"},
 {"name":"갤러리 X","address":"서울 성동구 연무장길 1","time":"14:30","category":"전시","why":"삼청동 전시를 좋아했으니","url":"javascript:alert(1)"},
 {"name":"와인바 Y","address":null,"time":"7:00","category":"술집","why":"저녁 데이트가 잦으니","url":"https://example.com/c"}
]}
즐거운 데이트 되세요!`;

test('parse: course from a reply with prose around the JSON', () => {
  const c = parseCourse(reply)!;
  assert.equal(c.title, '성수 조용한 오후');
  assert.equal(c.stops.length, 3);
  assert.equal(c.stops[2].time, '07:00');
  assert.equal(c.stops[1].url, null, 'only http(s) links');
  assert.equal(c.stops[2].address, null);
});

test('parse: braces inside text and a draft JSON before the final one', () => {
  const draft = '{"title":"초안","stops":[]}\n수정했어요:\n';
  const c = parseCourse(draft + reply.replace('빵, 전시', '빵 {가득}, 전시'))!;
  assert.equal(c.title, '성수 조용한 오후');
  assert.match(c.summary, /\{가득\}/);
});

test('parse: unusable replies return null', () => {
  assert.equal(parseCourse('죄송해요, 찾지 못했어요.'), null);
  assert.equal(parseCourse('{"title":"t","stops":[{"name":"하나뿐"}]}'), null, 'a course needs 2+ stops');
});

test('places we already went to are dropped even if the model suggests them', () => {
  const c = parseCourse(reply.replace('갤러리 X', '대림창고'))!;
  const d = dropVisited(c, buildTaste(ours).visited);
  assert.deepEqual(d.stops.map(s => s.name), ['어니언 성수', '와인바 Y']);
});
