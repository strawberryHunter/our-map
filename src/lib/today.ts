// "오늘의 추억": what to show today from our saved memories. Pure, tested in Node.
// All dates are Korea time (the couple lives in Korea); days count like Korean couples do,
// with the first day as day 1 (so D+100 is 99 days after the first memory).

import { distanceKm } from '../sync/cluster';

export type TodayMemory = { id: string; started_at: string; lat: number | null; lng: number | null; title: string | null; place: string | null };

export type TodayItem =
  | { kind: 'years-ago'; years: number; label: string; memoryIds: string[] }
  | { kind: 'first-anniversary'; years: number; label: string; memoryIds: string[] }
  | { kind: 'first-trip'; years: number; label: string; memoryIds: string[] }
  | { kind: 'day-count'; days: number; label: string; memoryIds: string[] }
  | { kind: 'around-now'; label: string; memoryIds: string[] };

const KST = 9 * 3600e3;
const DAY = 864e5;
/** Days since 1970-01-01 in Korea time. */
const kstDay = (ms: number) => Math.floor((ms + KST) / DAY);
const ymd = (ms: number) => { const d = new Date(ms + KST); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Same calendar day in Korea time. Feb 29 memories show on Feb 28 in non-leap years. */
function sameMonthDay(memMs: number, now: number) {
  const a = ymd(memMs), b = ymd(now);
  if (a.m === 2 && a.d === 29 && !isLeap(b.y)) return b.m === 2 && b.d === 28;
  return a.m === b.m && a.d === b.d;
}

export const TRIP_KM = 40;
const MILESTONES = [100, 200, 300, 365, 500, 1000];

/** Median of our places = home base; a trip is a memory farther than TRIP_KM from it. */
export function homeBase(ms: TodayMemory[]) {
  const geo = ms.filter(m => m.lat != null && m.lng != null);
  if (!geo.length) return null;
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { lat: med(geo.map(m => m.lat!)), lng: med(geo.map(m => m.lng!)) };
}

export function todaysMemories(all: TodayMemory[], now: number): TodayItem[] {
  const ms = [...all].filter(m => Date.parse(m.started_at) <= now).sort((a, b) => a.started_at.localeCompare(b.started_at));
  if (!ms.length) return [];
  const items: TodayItem[] = [];
  const today = kstDay(now);
  const thisYear = ymd(now).y;

  // N년 전 오늘 (one card per year, newest year first)
  const byYear = new Map<number, string[]>();
  for (const m of ms) {
    const t = Date.parse(m.started_at);
    const y = ymd(t).y;
    if (y < thisYear && sameMonthDay(t, now)) byYear.set(y, [...(byYear.get(y) ?? []), m.id]);
  }
  for (const [y, ids] of [...byYear].sort((a, b) => b[0] - a[0])) {
    items.push({ kind: 'years-ago', years: thisYear - y, label: `${thisYear - y}년 전 오늘`, memoryIds: ids });
  }

  // 첫 추억 N주년
  const first = ms[0];
  const firstT = Date.parse(first.started_at);
  const firstYears = thisYear - ymd(firstT).y;
  if (firstYears >= 1 && sameMonthDay(firstT, now)) {
    items.push({ kind: 'first-anniversary', years: firstYears, label: `첫 추억 ${firstYears}주년`, memoryIds: [first.id] });
  }

  // 첫 여행 N주년: first memory far from home
  const home = homeBase(ms);
  if (home) {
    const trip = ms.find(m => m.lat != null && distanceKm(home.lat, home.lng, m.lat, m.lng!) > TRIP_KM);
    if (trip) {
      const t = Date.parse(trip.started_at), years = thisYear - ymd(t).y;
      if (years >= 1 && sameMonthDay(t, now) && trip.id !== first.id) {
        items.push({ kind: 'first-trip', years, label: `첫 여행 ${years}주년`, memoryIds: [trip.id] });
      }
    }
  }

  // An anniversary card already shows its memory: don't repeat it as "N년 전 오늘".
  const special = new Set(items.filter(x => x.kind === 'first-anniversary' || x.kind === 'first-trip').flatMap(x => x.memoryIds));
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== 'years-ago') continue;
    it.memoryIds = it.memoryIds.filter(id => !special.has(id));
    if (!it.memoryIds.length) items.splice(i, 1);
  }

  // D+100, D+200 ... counted from the first memory (day 1)
  const dayNo = today - kstDay(firstT) + 1;
  if (MILESTONES.includes(dayNo) || (dayNo > 1000 && dayNo % 1000 === 0)) {
    items.push({ kind: 'day-count', days: dayNo, label: `첫 추억 D+${dayNo}`, memoryIds: [first.id] });
  }

  // Nothing special today: memories from around this date (±3 days) in earlier years, or a month ago.
  if (!items.length) {
    const near = ms.filter(m => {
      const t = Date.parse(m.started_at);
      const a = ymd(t);
      if (a.y >= thisYear) return false;
      const sameDayThisYear = kstDay(Date.UTC(thisYear, a.m - 1, a.d) - KST);
      return Math.abs(sameDayThisYear - today) <= 3;
    });
    if (near.length) items.push({ kind: 'around-now', label: '이맘때의 우리', memoryIds: near.map(m => m.id).reverse() });
  }
  return items;
}
