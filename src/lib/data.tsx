import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Couple, Member, Memory, PersonRow } from './types';

type Data = {
  ready: boolean;
  session: Session | null;
  couple: Couple | null;
  members: Member[];
  people: PersonRow[];
  memories: Memory[];
  reload: () => Promise<void>;
};

const Ctx = createContext<Data | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!session) {
      setCouple(null); setMembers([]); setPeople([]); setMemories([]); setReady(true);
      return;
    }
    const { data: cs } = await supabase.from('couples').select('id, invite_code').limit(1);
    const c = (cs?.[0] as Couple | undefined) ?? null;
    setCouple(c);
    if (c) {
      const [m, p, mem] = await Promise.all([
        supabase.from('members').select('*'),
        supabase.from('people').select('*').order('created_at'),
        supabase.from('memories').select('*').order('started_at', { ascending: false }),
      ]);
      setMembers((m.data ?? []) as Member[]);
      setPeople((p.data ?? []) as PersonRow[]);
      setMemories((mem.data ?? []) as Memory[]);
    }
    setReady(true);
  }, [session]);

  useEffect(() => { reload(); }, [reload]);

  // Live updates from the partner's phone.
  useEffect(() => {
    if (!couple) return;
    const filter = `couple_id=eq.${couple.id}`;
    const ch = supabase
      .channel(`couple-${couple.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memories', filter }, (e) => {
        setMemories(prev => {
          if (e.eventType === 'DELETE') return prev.filter(m => m.id !== (e.old as Memory).id);
          const row = e.new as Memory;
          const rest = prev.filter(m => m.id !== row.id);
          return [row, ...rest].sort((a, b) => b.started_at.localeCompare(a.started_at));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'people', filter }, () => {
        supabase.from('people').select('*').order('created_at').then(({ data }) => setPeople((data ?? []) as PersonRow[]));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [couple]);

  const value = useMemo(
    () => ({ ready, session, couple, members, people, memories, reload }),
    [ready, session, couple, members, people, memories, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}

/** Signed URLs for private photos, cached for the session. */
const urlCache = new Map<string, { url: string; exp: number }>();
export async function photoUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage.from('photos').createSignedUrl(path, 60 * 60);
  if (!data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

export function usePhotoUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (path) photoUrl(path).then(u => live && setUrl(u));
    return () => { live = false; };
  }, [path]);
  return url;
}
