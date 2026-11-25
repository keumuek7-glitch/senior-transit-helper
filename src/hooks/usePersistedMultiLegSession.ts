import { useCallback, useEffect, useRef } from 'react';
import type { MultiLegState } from '../core/stateMachine/multiLegManager';
import { reconcileSession, SESSION_TTL_MS, type ReconcileResult } from '../core/stateMachine/sessionTimeReconciler';

/** localStorage 저장 형식 (Set → Array 직렬화) */
interface Stored {
  v: 1;
  savedAt: number;
  state: Omit<MultiLegState, 'spokenKeys' | 'transit'> & {
    spokenKeys: string[];
    transit: (Omit<NonNullable<MultiLegState['transit']>, 'spokenKeys'>) | null;
  };
}

export const SESSION_STORAGE_KEY = 'sth.activeSession.v1';

export function serializeSession(state: MultiLegState, savedAt: number): string {
  const { spokenKeys, transit, ...rest } = state;
  const t = transit ? (({ spokenKeys: _ignored, ...tr }) => tr)(transit) : null;
  const stored: Stored = { v: 1, savedAt, state: { ...rest, spokenKeys: [...spokenKeys], transit: t } };
  return JSON.stringify(stored);
}

export function deserializeSession(raw: string): { state: MultiLegState; savedAt: number } | null {
  try {
    const s = JSON.parse(raw) as Stored;
    if (s?.v !== 1 || !s.state || !Array.isArray(s.state.legs)) return null;
    const spoken = new Set(s.state.spokenKeys ?? []);
    return {
      savedAt: s.savedAt,
      state: {
        ...s.state,
        spokenKeys: spoken,
        transit: s.state.transit ? { ...s.state.transit, spokenKeys: spoken } : null,
      },
    };
  } catch {
    return null;
  }
}

function safeGet(): string | null {
  try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
}
function safeSet(v: string) {
  try { localStorage.setItem(SESSION_STORAGE_KEY, v); } catch { /* 저장 불가 환경 */ }
}
function safeRemove() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* noop */ }
}

/** 저장된 진행 중 세션을 읽어 경과 시간 보정까지 해 돌려줍니다. 없거나 TTL이 지났으면 null */
export function loadPersistedSession(now: number): ReconcileResult | null {
  const raw = safeGet();
  if (!raw) return null;
  const parsed = deserializeSession(raw);
  if (!parsed || now - parsed.savedAt > SESSION_TTL_MS) {
    safeRemove();
    return null;
  }
  const r = reconcileSession(parsed.state, parsed.savedAt, now);
  if (r.expired) {
    safeRemove();
    return null;
  }
  return r;
}

/** 상태가 바뀔 때마다(최대 1초 1회) 저장합니다. */
export function usePersistedMultiLegSession(state: MultiLegState | null, now: () => number) {
  const lastWrite = useRef(0);
  useEffect(() => {
    if (!state) return;
    if (state.finished) {
      safeRemove();
      return;
    }
    const t = now();
    if (t - lastWrite.current < 1000) return;
    lastWrite.current = t;
    safeSet(serializeSession(state, t));
  }, [state, now]);

  return useCallback(() => safeRemove(), []);
}
