import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HomeScreen, type Favorite } from './screens/HomeScreen';
import { RouteChoiceScreen } from './screens/RouteChoiceScreen';
import { ActiveGuideScreen } from './screens/ActiveGuideScreen';
import { MissedStopRecoveryBanner } from './components/MissedStopRecoveryBanner';
import { SafetyBar } from './components/SafetyBar';
import { DevTestPanel, type DevActions } from './components/DevTestPanel';
import { classifyRoutes, type ClassifiedRoutes, type ScoredRoute } from './core/classifier/seniorRouteClassifier';
import { buildRouteLegs, isRideLeg } from './core/stateMachine/routeLegBuilder';
import {
  createMultiLegState,
  currentLeg,
  multiLegReducer,
  type ManagerEffect,
  type MultiLegEvent,
  type MultiLegState,
} from './core/stateMachine/multiLegManager';
import { currentTransitVM } from './core/stateMachine/transitStateMachine';
import { reconcileSession, type ReconcileResult, type ReconcileWarning } from './core/stateMachine/sessionTimeReconciler';
import { decodeGuardianLink } from './core/guardian/guardianLinkCodec';
import { buildSmsUri, buildSosMessage } from './core/guardian/sosMessageBuilder';
import { fetchSeniorRoutes, RouteApiError } from './services/routeApiClient';
import { createWebSpeechAdapter, vibrate } from './services/speechAdapter';
import { getCurrentLocation, FALLBACK_LOCATION } from './utils/currentLocationHelper';
import { loadPersistedSession, usePersistedMultiLegSession } from './hooks/usePersistedMultiLegSession';

type Screen = 'HOME' | 'CHOICE' | 'GUIDE';
interface Dest { name: string; x: number; y: number }

/** 시연용 즐겨찾기. 좌표는 대략값입니다(정확한 좌표 확인 필요). */
const FAVORITES: Favorite[] = [
  { id: 'snuh', label: '🏥 서울대병원', name: '서울대학교병원', x: 126.999, y: 37.5797 },
];

const PHONE_KEY = 'sth.guardianPhone';
const readPhone = () => {
  try { return localStorage.getItem(PHONE_KEY) ?? ''; } catch { return ''; }
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('HOME');
  const [session, setSession] = useState<MultiLegState | null>(null);
  const sessionRef = useRef<MultiLegState | null>(null);
  const [routes, setRoutes] = useState<ClassifiedRoutes | null>(null);
  const [dest, setDest] = useState<Dest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originLabel, setOriginLabel] = useState('현재 위치 (길 찾기 때 확인)');
  const [warning, setWarning] = useState<ReconcileWarning>({ kind: 'NONE' });
  const [pendingRestore, setPendingRestore] = useState<ReconcileResult | null>(null);
  const [guardianPhone, setGuardianPhone] = useState(readPhone);
  const [sosBusy, setSosBusy] = useState(false);
  const [simOffset, setSimOffset] = useState(0);
  const simOffsetRef = useRef(0);

  const guardianDest = useMemo(() => decodeGuardianLink(window.location.search), []);
  const speech = useMemo(() => createWebSpeechAdapter(), []);
  const now = useCallback(() => Date.now() + simOffsetRef.current, []);

  const clearPersisted = usePersistedMultiLegSession(session, now);

  // ── 효과(발화·진동) 실행 ─────────────────────────────
  const runEffects = useCallback(
    (effects: ManagerEffect[]) => {
      for (const e of effects) {
        if (e.kind === 'SPEAK') speech.speak(e.vm.speech);
        else vibrate(e.pattern);
      }
    },
    [speech],
  );

  const apply = useCallback(
    (r: { state: MultiLegState | null; effects: ManagerEffect[] }) => {
      sessionRef.current = r.state;
      setSession(r.state);
      runEffects(r.effects);
    },
    [runEffects],
  );

  const dispatch = useCallback(
    (ev: MultiLegEvent) => {
      const cur = sessionRef.current;
      if (!cur) return;
      apply(multiLegReducer(cur, ev));
    },
    [apply],
  );

  // 카드 자동 발화와 디스패처가 같은 spokenKeys를 공유 (세션과 함께 저장됨)
  const binding = useMemo(
    () => ({
      speak: (text: string) => speech.speak(text),
      spoken: {
        has: (k: string) => sessionRef.current?.spokenKeys.has(k) ?? false,
        add: (k: string) => {
          sessionRef.current?.spokenKeys.add(k);
        },
      },
    }),
    [speech],
  );

  // ── 앱 시작: 진행 중 세션 복원 확인 ─────────────────────
  useEffect(() => {
    const restored = loadPersistedSession(Date.now());
    if (restored?.state) setPendingRestore(restored);
  }, []);

  // ── 1초 TICK ─────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'GUIDE') return;
    const id = setInterval(() => dispatch({ type: 'TICK', now: now() }), 1000);
    return () => clearInterval(id);
  }, [screen, dispatch, now]);

  // ── 길 찾기 ──────────────────────────────────────────
  const searchRoutes = useCallback(
    async (target: Dest) => {
      setLoading(true);
      setError(null);
      setDest(target);
      try {
        const loc = await getCurrentLocation();
        setOriginLabel(loc.source === 'GPS' ? '현재 위치' : `${FALLBACK_LOCATION.name} · ${loc.reason}`);
        const candidates = await fetchSeniorRoutes({ sx: loc.x, sy: loc.y, ex: target.x, ey: target.y });
        const classified = classifyRoutes(candidates);
        if (!classified) throw new RouteApiError('NO_ROUTE', '갈 수 있는 길을 찾지 못했어요.');
        setRoutes(classified);
        setScreen('CHOICE');
      } catch (e) {
        setError(e instanceof RouteApiError ? e.message : '길 찾기 중 문제가 생겼어요.');
        setScreen('HOME');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const pickRoute = useCallback(
    (r: ScoredRoute) => {
      const destName = dest?.name ?? '목적지';
      const legs = buildRouteLegs(r.candidate, { destName });
      setWarning({ kind: 'NONE' });
      simOffsetRef.current = 0;
      setSimOffset(0);
      apply(createMultiLegState({ routeId: r.candidate.id, destName, legs, now: now() }));
      setScreen('GUIDE');
    },
    [apply, dest, now],
  );

  const reroute = useCallback(() => {
    const target = dest ?? FAVORITES[0];
    setWarning({ kind: 'NONE' });
    void searchRoutes(target);
  }, [dest, searchRoutes]);

  const goHome = useCallback(() => {
    clearPersisted();
    apply({ state: null, effects: [] });
    setScreen('HOME');
  }, [apply, clearPersisted]);

  // ── 보호자 위치 전송(SOS) ─────────────────────────────
  const sendSos = useCallback(async () => {
    setSosBusy(true);
    try {
      const loc = await getCurrentLocation(5000);
      const s = sessionRef.current;
      const leg = s ? currentLeg(s) : undefined;
      const step = s && leg && isRideLeg(leg) && s.transit ? currentTransitVM(leg, s.transit).title : undefined;
      const body = buildSosMessage({
        lat: loc.y,
        lng: loc.x,
        approximate: loc.source !== 'GPS',
        destName: s?.destName ?? dest?.name,
        currentStep: step,
      });
      window.location.href = buildSmsUri(guardianPhone, body, navigator.userAgent);
    } finally {
      setSosBusy(false);
    }
  }, [dest, guardianPhone]);

  // ── 개발자 테스트 패널 동작 ─────────────────────────────
  const advanceClock = useCallback((ms: number) => {
    simOffsetRef.current += ms;
    setSimOffset(simOffsetRef.current);
  }, []);

  const ensureBoarded = useCallback(() => {
    const s = sessionRef.current;
    if (s?.transit?.phase === 'WAITING_BOARDING') dispatch({ type: 'BOARDED', now: now() });
  }, [dispatch, now]);

  const devActions: DevActions = useMemo(
    () => ({
      board: () => ensureBoarded(),
      nextStation: () => {
        const s = sessionRef.current;
        const leg = s && currentLeg(s);
        if (!s || !leg) return;
        if (!isRideLeg(leg)) {
          dispatch({ type: 'WALK_DONE', now: now() });
          return;
        }
        ensureBoarded();
        const t = sessionRef.current!.transit!;
        const idx = Math.min(leg.stations.length - 1, Math.max(t.anchorIndex, t.estimatedIndex) + 1);
        dispatch({ type: 'STATION_OBSERVED', name: leg.stations[idx], now: now() });
      },
      wrongDirection: () => {
        const s = sessionRef.current;
        const leg = s && currentLeg(s);
        if (!leg || !isRideLeg(leg)) return;
        ensureBoarded();
        dispatch({ type: 'STATION_OBSERVED', name: leg.oppositeNeighbor ?? '반대 방향 역(가상)', now: now() });
      },
      slowDown: () => {
        const s = sessionRef.current;
        const leg = s && currentLeg(s);
        if (!leg || !isRideLeg(leg)) return;
        ensureBoarded();
        // 현재 역을 '관측'해 관측 모드로 만든 뒤, 다음 역 예상 시간의 1.4배를 흘려보냄
        const t = sessionRef.current!.transit!;
        dispatch({ type: 'STATION_OBSERVED', name: leg.stations[t.anchorIndex], now: now() });
        const hop = leg.hopSeconds[sessionRef.current!.transit!.anchorIndex] ?? 60;
        advanceClock(Math.ceil(hop * 1.4) * 1000);
        dispatch({ type: 'TICK', now: now() });
      },
      plusMinute: () => {
        advanceClock(60_000);
        dispatch({ type: 'TICK', now: now() });
      },
      simulateRestore: () => {
        const s = sessionRef.current;
        if (!s) return;
        const savedAt = now();
        advanceClock(10 * 60_000);
        const r = reconcileSession(s, savedAt, now());
        if (r.state) {
          apply({ state: r.state, effects: r.effects });
          setWarning(r.warning);
        }
      },
      reset: () => {
        simOffsetRef.current = 0;
        setSimOffset(0);
        setWarning({ kind: 'NONE' });
        setPendingRestore(null);
        goHome();
      },
    }),
    [advanceClock, apply, dispatch, ensureBoarded, goHome, now],
  );

  const devInfo = (() => {
    const s = session;
    const leg = s && currentLeg(s);
    const phase = s?.finished ? '도착' : leg && isRideLeg(leg) ? s?.transit?.phase : leg?.type ?? '-';
    return `시뮬레이션 시계 +${Math.round(simOffset / 1000)}초 · 상태: ${phase ?? '-'}`;
  })();

  return (
    <div className={`app ${screen === 'GUIDE' ? 'app--with-safety' : ''}`}>
      {screen === 'HOME' && (
        <HomeScreen
          favorites={FAVORITES}
          guardianDest={guardianDest}
          resumeAvailable={pendingRestore?.state ? { destName: pendingRestore.state.destName } : null}
          originLabel={originLabel}
          guardianPhone={guardianPhone}
          loading={loading}
          error={error}
          onGo={(d) => void searchRoutes(d)}
          onResume={() => {
            if (!pendingRestore?.state) return;
            apply({ state: pendingRestore.state, effects: pendingRestore.effects });
            setWarning(pendingRestore.warning);
            setPendingRestore(null);
            setScreen('GUIDE');
          }}
          onDiscardResume={() => {
            clearPersisted();
            setPendingRestore(null);
          }}
          onSavePhone={(p) => {
            setGuardianPhone(p);
            try { localStorage.setItem(PHONE_KEY, p); } catch { /* noop */ }
          }}
        />
      )}

      {screen === 'CHOICE' && routes && (
        <RouteChoiceScreen
          destName={dest?.name ?? '목적지'}
          routes={routes}
          onPick={pickRoute}
          onBack={() => setScreen(session ? 'GUIDE' : 'HOME')}
        />
      )}

      {screen === 'GUIDE' && session && (
        <>
          <MissedStopRecoveryBanner
            warning={warning}
            onReroute={reroute}
            onDismiss={() => setWarning({ kind: 'NONE' })}
          />
          <ActiveGuideScreen
            session={session}
            binding={binding}
            onBoarded={() => dispatch({ type: 'BOARDED', now: now() })}
            onAlighted={() => dispatch({ type: 'USER_ALIGHTED', now: now() })}
            onWalkDone={() => dispatch({ type: 'WALK_DONE', now: now() })}
            onReroute={reroute}
            onFinish={goHome}
          />
          {loading && <p className="status" role="status">길을 다시 찾고 있어요…</p>}
          {error && <p className="status status--error" role="alert">{error}</p>}
        </>
      )}

      <DevTestPanel actions={devActions} info={devInfo} enabled={screen === 'GUIDE' && !!session} />

      {screen === 'GUIDE' && (
        <SafetyBar
          onOtherRoute={() => (routes ? setScreen('CHOICE') : reroute())}
          onSos={() => void sendSos()}
          sosBusy={sosBusy}
        />
      )}
    </div>
  );
}
