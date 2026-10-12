import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useData } from '../lib/data';
import { runSync, type Progress } from './sync';

type SyncState = {
  running: boolean;
  progress: Progress | null;
  lastResult: string | null;
  error: string | null;
  sync: () => Promise<void>;
};

const Ctx = createContext<SyncState | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session, couple, people, reload } = useData();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const sync = useCallback(async () => {
    if (busy.current || !session || !couple || !people.length) return;
    busy.current = true;
    setRunning(true); setError(null);
    try {
      const r = await runSync({ userId: session.user.id, coupleId: couple.id, people, onProgress: setProgress });
      setLastResult(r.memories ? `추억 ${r.memories}개, 사진 ${r.photos}장을 정리했어요` : '새로 정리할 사진이 없어요');
      if (r.memories) await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setRunning(false); setProgress(null);
    }
  }, [session, couple, people, reload]);

  // Runs automatically whenever the app comes to the foreground.
  useEffect(() => {
    sync();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') sync(); });
    return () => sub.remove();
  }, [sync]);

  return <Ctx.Provider value={{ running, progress, lastResult, error, sync }}>{children}</Ctx.Provider>;
}

export function useSync() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync outside SyncProvider');
  return v;
}
