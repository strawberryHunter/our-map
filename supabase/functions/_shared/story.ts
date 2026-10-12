// Prompt + reply parsing for the memory story. Pure (no Deno/Node APIs) so it is tested in Node.

export type PlaceSource = 'gps' | 'manual' | null;

export type StoryInput = {
  startedAt: string;
  endedAt: string;
  placeSource: PlaceSource;
  /** manual: the name we typed. gps: the map lookup result. null: unknown. */
  placeHint: string | null;
  people: string[];
  memo: string | null;
  photoCount: number;
};

export type Story = { title: string | null; place: string | null; summary: string | null };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function buildStoryPrompt(i: StoryInput): string {
  const placeLine =
    i.placeSource === 'manual' ? `장소(우리가 직접 정함, 그대로 사용): ${i.placeHint}` :
    i.placeSource === 'gps' ? `장소(사진 GPS로 지도에서 찾은 결과): ${i.placeHint ?? '이름 없음'}` :
    '장소: 모름. 사진에 GPS가 없어요. 장소 이름을 추측하거나 지어내지 마세요. place는 빈 문자열로 두세요.';
  return [
    `커플이 함께한 하루의 사진 ${i.photoCount}장입니다. 둘만 보는 추억 앱(OURS)에 남길 기록을 써주세요.`,
    `시간: ${fmt(i.startedAt)} ~ ${fmt(i.endedAt)}`,
    placeLine,
    i.people.length ? `사진에 나온 사람: ${i.people.join(', ')}` : '',
    i.memo ? `우리가 쓴 메모 (가장 중요한 정보, 사실로 취급): """${i.memo.slice(0, 1000)}"""` : '',
    '',
    'JSON으로만 답하세요: {"title": string, "place": string, "summary": string}',
    '- title: 12자 안팎의 짧은 제목. 이모지 없이.',
    i.placeSource === 'manual' ? '- place: 위에 적힌 장소 이름을 그대로.' :
      i.placeSource === 'gps' ? "- place: 사람이 부르는 장소 이름 (예: '성수동 카페거리', '제주 협재해변'). 지도 결과를 우선 참고." :
      '- place: 빈 문자열.',
    '- summary: 그날의 이야기 2~4문장, 반말 일기체. 메모에 있는 사실을 먼저 살리고, 나머지는 사진에서 보이는 것만 써요.',
    '  메모나 사진에 없는 사건·감정·장소를 지어내지 마세요. 과장 없이 담백하게.',
  ].filter(Boolean).join('\n');
}

const clean = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

export function parseStory(text: string, input: Pick<StoryInput, 'placeSource' | 'placeHint'>): Story {
  let json: Record<string, unknown> = {};
  // The model sometimes wraps JSON in prose or a ```json fence; take the outermost object.
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { json = JSON.parse(text.slice(start, end + 1)); } catch { json = {}; }
  }
  // Place rules: a hand-set place is never changed, and without GPS the AI never decides one.
  const place =
    input.placeSource === 'manual' ? clean(input.placeHint, 80) :
    input.placeSource === 'gps' ? clean(json.place, 80) ?? clean(input.placeHint, 80) :
    null;
  return { title: clean(json.title, 60), place, summary: clean(json.summary, 600) };
}
