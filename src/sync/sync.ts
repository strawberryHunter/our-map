// Pulls new photos from the phone's gallery, finds the ones with us in them,
// groups them into outings and uploads them as memories.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { Asset, AssetField, MediaType, Query, getPermissionsAsync, requestPermissionsAsync } from 'expo-media-library';
import { peopleInPhoto } from '../face/native';
import { downscale } from '../lib/image';
import { supabase } from '../lib/supabase';
import type { Memory, PersonRow } from '../lib/types';
import { GAP_MS, clusterPhotos, sameOuting, type PhotoMeta } from './cluster';

const MAX_PER_SYNC = 400; // photos scanned per run; the next run continues from there
const MAX_PHOTOS_PER_MEMORY = 12;
const EXTRA_SCENERY = 3; // photos without faces kept per outing (food, views)

export type Progress = { stage: string; done: number; total: number };

type Candidate = PhotoMeta & { asset: Asset; uri: string; width: number; height: number; people: string[] };

const lastSyncKey = (userId: string) => `lastSync:${userId}`;
export const SYNC_START_KEY = 'syncStart';

export async function getSyncStart(): Promise<number> {
  const v = await AsyncStorage.getItem(SYNC_START_KEY);
  return v ? Number(v) : Date.now() - 30 * 24 * 3600 * 1000;
}

export async function ensureLibraryPermission() {
  const cur = await getPermissionsAsync(false, ['photo']);
  if (cur.granted) return true;
  const res = await requestPermissionsAsync(false, ['photo']);
  return res.granted;
}

async function since(userId: string) {
  const last = await AsyncStorage.getItem(lastSyncKey(userId));
  return last ? Number(last) : await getSyncStart();
}

/** Spread picks evenly across the outing so the memory tells the whole day. */
function pickEvenly<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  return out;
}

export async function runSync(opts: {
  userId: string;
  coupleId: string;
  people: PersonRow[];
  onProgress?: (p: Progress) => void;
}): Promise<{ memories: number; photos: number }> {
  const { userId, coupleId, people, onProgress } = opts;
  if (!people.length) throw new Error('얼굴을 먼저 등록해주세요.');
  if (!(await ensureLibraryPermission())) throw new Error('사진 접근 권한이 필요해요.');

  const from = await since(userId);
  onProgress?.({ stage: '새 사진 찾는 중', done: 0, total: 0 });
  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .gt(AssetField.CREATION_TIME, from)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: true })
    .limit(MAX_PER_SYNC)
    .exe();
  if (!assets.length) {
    await retryMissingSummaries(userId, people);
    return { memories: 0, photos: 0 };
  }

  // Skip anything this phone already uploaded.
  const uploaded = new Set<string>();
  for (let i = 0; i < assets.length; i += 100) {
    const ids = assets.slice(i, i + 100).map(a => a.id);
    const { data } = await supabase.from('photos').select('source_asset').eq('uploaded_by', userId).in('source_asset', ids);
    data?.forEach(r => uploaded.add(r.source_asset));
  }

  // Read metadata and look for faces, one photo at a time to keep memory low.
  const faces = people.map(p => ({ id: p.id, name: p.name, embeddings: p.embeddings }));
  const candidates: Candidate[] = [];
  let newest = from;
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    onProgress?.({ stage: '사진 속 얼굴 찾는 중', done: i, total: assets.length });
    try {
      const info = await a.getInfo();
      const time = info.creationTime ?? 0;
      newest = Math.max(newest, time);
      if (uploaded.has(a.id)) continue;
      const loc = await a.getLocation();
      const found = await peopleInPhoto(info.uri, info.width, info.height, faces);
      candidates.push({
        id: a.id, asset: a, uri: info.uri, width: info.width, height: info.height, time,
        lat: loc?.latitude ?? null, lng: loc?.longitude ?? null, people: found,
      });
    } catch (e) {
      console.warn('skip photo', a.id, e);
    }
  }

  // An outing that may still be going on (last photo less than 3h ago) waits for the next run.
  const outings = clusterPhotos(candidates);
  const finished = outings.filter(o => Date.now() - o.end > GAP_MS || assets.length === MAX_PER_SYNC);
  const held = outings.find(o => !finished.includes(o));
  const nextSince = held ? Math.min(newest, held.start - 1) : newest;

  let memCount = 0, photoCount = 0;
  for (let oi = 0; oi < finished.length; oi++) {
    const o = finished[oi];
    const withUs = o.photos.filter(p => p.people.length > 0);
    if (!withUs.length) continue; // no registered face in this outing: not ours

    const scenery = pickEvenly(o.photos.filter(p => p.people.length === 0), EXTRA_SCENERY);
    const chosen = pickEvenly(
      [...withUs, ...scenery].sort((a, b) => a.time - b.time),
      MAX_PHOTOS_PER_MEMORY,
    );
    onProgress?.({ stage: '추억 저장 중', done: oi, total: finished.length });

    const memory = await findOrCreateMemory(coupleId, userId, o);
    const peopleIds = new Set(memory.people);
    let cover = memory.cover_photo;
    let coverHasBoth = false;

    for (const p of chosen) {
      const small = await downscale(p.uri, p.width, p.height, 1600, { compress: 0.82 });
      const path = `${coupleId}/${memory.id}/${p.time}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const bytes = await new File(small.uri).arrayBuffer();
      const up = await supabase.storage.from('photos').upload(path, bytes, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const { data: row, error } = await supabase.from('photos').insert({
        couple_id: coupleId, memory_id: memory.id, storage_path: path,
        taken_at: new Date(p.time).toISOString(), lat: p.lat, lng: p.lng,
        width: small.width, height: small.height, people: p.people,
        source_asset: p.id, uploaded_by: userId,
      }).select('id').single();
      if (error) throw error;
      p.people.forEach(id => peopleIds.add(id));
      // Prefer a photo with both of us as the cover.
      if (!cover || (p.people.length >= 2 && !coverHasBoth)) {
        cover = row.id;
        coverHasBoth = p.people.length >= 2;
      }
      photoCount++;
    }

    await supabase.from('memories').update({
      started_at: new Date(Math.min(Date.parse(memory.started_at), o.start)).toISOString(),
      ended_at: new Date(Math.max(Date.parse(memory.ended_at), o.end)).toISOString(),
      lat: memory.lat ?? o.lat, lng: memory.lng ?? o.lng,
      people: [...peopleIds], cover_photo: cover,
    }).eq('id', memory.id);

    if (!memory.summary) {
      onProgress?.({ stage: 'AI가 하루를 정리하는 중', done: oi, total: finished.length });
      await summarize(memory.id, chosen, o, people.filter(p => peopleIds.has(p.id)).map(p => p.name)).catch(e => console.warn('summary failed', e));
    }
    memCount++;
  }

  await AsyncStorage.setItem(lastSyncKey(userId), String(nextSince));
  await retryMissingSummaries(userId, people);
  return { memories: memCount, photos: photoCount };
}

/** Memories this phone made whose AI summary failed earlier (e.g. API down): try again, a few per run. */
async function retryMissingSummaries(userId: string, people: PersonRow[]) {
  const { data } = await supabase.from('memories').select('*').eq('created_by', userId).is('summary', null).limit(3);
  for (const m of (data ?? []) as Memory[]) {
    const { data: rows } = await supabase.from('photos').select('source_asset').eq('memory_id', m.id).eq('uploaded_by', userId);
    const photos: Candidate[] = [];
    for (const r of rows ?? []) {
      try {
        const asset = new Asset(r.source_asset);
        const info = await asset.getInfo();
        photos.push({ id: asset.id, asset, uri: info.uri, width: info.width, height: info.height, time: info.creationTime ?? 0, lat: m.lat, lng: m.lng, people: [] });
      } catch (e) {
        console.warn('photo gone from gallery', r.source_asset, e);
      }
    }
    if (!photos.length) continue;
    const names = people.filter(p => m.people.includes(p.id)).map(p => p.name);
    const o = { start: Date.parse(m.started_at), end: Date.parse(m.ended_at), lat: m.lat, lng: m.lng };
    await summarize(m.id, photos, o, names).catch(e => console.warn('summary retry failed', e));
  }
}

async function findOrCreateMemory(coupleId: string, userId: string, o: { start: number; end: number; lat: number | null; lng: number | null }) {
  // The partner's phone may already have made this memory from their own photos.
  const lo = new Date(o.start - 12 * 3600 * 1000).toISOString();
  const hi = new Date(o.end + 12 * 3600 * 1000).toISOString();
  const { data: near } = await supabase.from('memories').select('*').gte('started_at', lo).lte('started_at', hi);
  const match = (near as Memory[] | null)?.find(m =>
    sameOuting({ start: Date.parse(m.started_at), end: Date.parse(m.ended_at), lat: m.lat, lng: m.lng }, o));
  if (match) return match;
  const { data, error } = await supabase.from('memories').insert({
    couple_id: coupleId, created_by: userId,
    started_at: new Date(o.start).toISOString(), ended_at: new Date(o.end).toISOString(),
    lat: o.lat, lng: o.lng,
  }).select('*').single();
  if (error) throw error;
  return data as Memory;
}

async function summarize(memoryId: string, photos: Candidate[], o: { start: number; end: number; lat: number | null; lng: number | null }, names: string[]) {
  const picks = pickEvenly(photos, 4);
  const images: string[] = [];
  for (const p of picks) {
    const r = await downscale(p.uri, p.width, p.height, 768, { base64: true, compress: 0.7 });
    if (r.base64) images.push(r.base64);
  }
  const { error } = await supabase.functions.invoke('summarize', {
    body: {
      memoryId, images, lat: o.lat, lng: o.lng, people: names,
      startedAt: new Date(o.start).toISOString(), endedAt: new Date(o.end).toISOString(),
    },
  });
  if (error) throw error;
}
