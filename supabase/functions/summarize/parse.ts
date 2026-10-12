// Turns Claude's reply into the fields we store. Pure, so it can be tested outside Deno.
export type Summary = { title: string | null; place: string | null; summary: string | null };

const clean = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

export function parseSummary(text: string, fallbackPlace: string | null): Summary {
  let json: Record<string, unknown> = {};
  // The model sometimes wraps JSON in prose or a ```json fence; take the outermost object.
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { json = JSON.parse(text.slice(start, end + 1)); } catch { json = {}; }
  }
  return {
    title: clean(json.title, 60),
    place: clean(json.place, 80) ?? clean(fallbackPlace, 80),
    summary: clean(json.summary, 400),
  };
}
