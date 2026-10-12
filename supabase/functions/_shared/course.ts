// AI date course: our taste from saved memories -> prompt -> parsed course.
// Pure (no Deno/Node APIs) so it is tested in Node.

export type MemoryLite = {
  started_at: string;
  place: string | null;
  title: string | null;
  summary: string | null;
  memo: string | null;
};

export type CourseRequest = { area?: string; mood?: string; budget?: string; when?: string; note?: string };

export type Taste = {
  total: number;
  areas: { name: string; count: number }[]; // most visited neighbourhoods
  recent: string[]; // "성수동 빵지순례 (성수동 카페거리)"
  visited: string[]; // place names to avoid repeating
  evening: number; // share of outings that started at 17:00 or later (Korea time), 0..1
  words: string[]; // things we keep doing (from titles/memos/stories)
};

const KST = 9 * 3600e3;
/** "서울 성동구 성수동 · 대림창고" -> "성동구 성수동"; "성수동 카페거리" -> "성수동 카페거리" */
export function areaOf(place: string): string {
  const head = place.split('·')[0].trim();
  const parts = head.split(/\s+/);
  return parts.length >= 3 ? parts.slice(-2).join(' ') : head;
}

// Words that say what we like doing. Matched in titles, memos and stories.
const INTERESTS: [string, RegExp][] = [
  ['카페', /카페|커피|라떼|디저트/], ['빵집', /빵|베이커리|크루아상|소금빵/], ['맛집', /맛집|식당|저녁|점심|파스타|고기|초밥|라멘/],
  ['전시', /전시|미술관|갤러리|박물관/], ['공연', /공연|콘서트|뮤지컬|연극/], ['영화', /영화|시네마/],
  ['산책', /산책|걷|공원|숲/], ['한강', /한강/], ['바다', /바다|해변|해수욕/], ['야경', /야경|노을|밤/],
  ['쇼핑', /쇼핑|팝업|소품/], ['술', /술|와인|바|칵테일|맥주|이자카야/], ['액티비티', /클라이밍|볼링|보드|자전거|방탈출|놀이공원|롯데월드|에버랜드/],
  ['클래스', /클래스|공방|만들기|체험/],
];

export function buildTaste(ms: MemoryLite[]): Taste {
  const areas = new Map<string, number>();
  const visited = new Set<string>();
  const words = new Map<string, number>();
  let evening = 0;
  for (const m of ms) {
    if (m.place) {
      areas.set(areaOf(m.place), (areas.get(areaOf(m.place)) ?? 0) + 1);
      visited.add(m.place.trim());
    }
    const hour = new Date(Date.parse(m.started_at) + KST).getUTCHours();
    if (hour >= 17) evening++;
    const text = [m.title, m.memo, m.summary].filter(Boolean).join(' ');
    for (const [w, re] of INTERESTS) if (re.test(text)) words.set(w, (words.get(w) ?? 0) + 1);
  }
  const recent = [...ms].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 6)
    .map(m => [m.title, m.place && `(${m.place})`].filter(Boolean).join(' ')).filter(Boolean);
  return {
    total: ms.length,
    areas: [...areas].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    recent,
    visited: [...visited].slice(0, 40),
    evening: ms.length ? evening / ms.length : 0,
    words: [...words].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w),
  };
}

export function buildCoursePrompt(t: Taste, r: CourseRequest): string {
  const area = r.area?.trim() || t.areas[0]?.name || '서울';
  return [
    '커플의 다음 데이트 코스를 추천해주세요. 두 사람이 함께 쓰는 추억 앱(OURS)에 저장된 기록이 아래에 있어요.',
    '',
    '## 우리 기록',
    `- 저장된 추억 ${t.total}개`,
    t.areas.length ? `- 자주 간 동네: ${t.areas.map(a => `${a.name}(${a.count})`).join(', ')}` : '',
    t.words.length ? `- 자주 한 것: ${t.words.join(', ')}` : '',
    t.recent.length ? `- 최근 추억: ${t.recent.join(' / ')}` : '',
    `- 저녁 데이트 비율: ${Math.round(t.evening * 100)}%`,
    t.visited.length ? `- 이미 가본 곳 (같은 곳은 추천하지 말 것): ${t.visited.join(', ')}` : '',
    '',
    '## 이번 요청',
    `- 지역: ${area}`,
    r.when ? `- 언제: ${r.when}` : '',
    r.mood ? `- 분위기: ${r.mood}` : '',
    r.budget ? `- 예산(둘이 합쳐): ${r.budget}` : '',
    r.note?.trim() ? `- 하고 싶은 말: ${r.note.trim().slice(0, 300)}` : '',
    '',
    '## 규칙',
    '- 웹 검색으로 지금 실제로 영업 중인 장소만 고르세요. 이름과 주소를 검색 결과로 확인하고, 확인 못 한 곳은 넣지 마세요.',
    '- 3~4곳, 동선이 걸어서나 짧은 이동으로 이어지게. 시간 순서대로.',
    '- 우리가 좋아한 것과 비슷하되 새로운 곳. 이미 가본 곳은 제외.',
    '- why에는 우리 기록의 어떤 점 때문에 골랐는지 한 문장으로 (예: "성수동 빵집을 자주 갔으니"). 기록에 없는 취향을 지어내지 마세요.',
    '',
    '마지막에 JSON만 출력하세요 (설명 없이):',
    '{"title": string, "summary": string, "stops": [{"name": string, "address": string, "time": "HH:MM", "category": string, "why": string, "url": string}]}',
    '- title: 15자 안팎 코스 이름. summary: 코스 한 줄 설명. category: 카페/맛집/전시/산책/공연/술집/체험 중 하나. url: 확인한 페이지 주소.',
  ].filter(l => l !== '').join('\n').replace(/\n## /g, '\n\n## ');
}

export type ParsedStop = { name: string; address: string | null; time: string | null; category: string | null; why: string; url: string | null };
export type ParsedCourse = { title: string; summary: string; stops: ParsedStop[] };

const clean = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** Finds the last JSON object with "stops" in the reply (the model may write prose around it). */
function lastCourseJson(text: string): any {
  const ends: number[] = [];
  for (let e = text.lastIndexOf('}'); e >= 0 && ends.length < 20; e = text.lastIndexOf('}', e - 1)) ends.push(e);
  for (const end of ends) {
    for (let start = text.lastIndexOf('{', end); start >= 0; start = text.lastIndexOf('{', start - 1)) {
      try {
        const j = JSON.parse(text.slice(start, end + 1));
        if (j && Array.isArray(j.stops)) return j;
      } catch { /* not a full object yet: widen */ }
    }
  }
  return null;
}

export function parseCourse(text: string): ParsedCourse | null {
  const json = lastCourseJson(text);
  if (!json || !Array.isArray(json.stops)) return null;
  const stops: ParsedStop[] = json.stops.map((s: any) => ({
    name: clean(s?.name, 60),
    address: clean(s?.address, 120),
    time: typeof s?.time === 'string' && /^\d{1,2}:\d{2}$/.test(s.time.trim()) ? s.time.trim().padStart(5, '0') : null,
    category: clean(s?.category, 20),
    why: clean(s?.why, 200) ?? '',
    url: typeof s?.url === 'string' && /^https?:\/\//.test(s.url.trim()) ? s.url.trim().slice(0, 500) : null,
  })).filter((s: ParsedStop) => s.name).slice(0, 5);
  if (stops.length < 2) return null;
  return { title: clean(json.title, 40) ?? '우리의 다음 데이트', summary: clean(json.summary, 200) ?? '', stops };
}

/** Drops stops that repeat a place we have already been to (the model sometimes ignores the rule). */
export function dropVisited(c: ParsedCourse, visited: string[]): ParsedCourse {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const seen = visited.map(norm).filter(v => v.length >= 2);
  return { ...c, stops: c.stops.filter(s => !seen.some(v => norm(s.name).includes(v) || v.includes(norm(s.name)))) };
}
