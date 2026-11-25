import { isRideLeg, type RouteLeg } from './routeLegBuilder';
import {
  createTransitState,
  transitReducer,
  type TransitEffect,
  type TransitState,
} from './transitStateMachine';
import { arrivedVM, boardingVM, type GuidanceViewModel } from '../tts/guidanceSpeechBuilder';

/**
 * SUBWAY_LEG ↔ TRANSFER_WALK_LEG ↔ BUS_LEG 전환을 관리합니다.
 *
 * 발화 규칙:
 *  - 탈것 구간 진입 시 탑승 안내를 1회 발화(spokenKeys로 중복 차단)
 *  - TRANSFER_WALK_LEG 진입 시에는 여기서 발화하지 않습니다.
 *    전용 카드(TransferGuidanceCard / ExitGuidanceCard)가 useCardAutoSpeech로 직접 읽기 때문입니다.
 */
export interface MultiLegState {
  routeId: string;
  destName: string;
  legs: RouteLeg[];
  currentIndex: number;
  transit: TransitState | null;
  finished: boolean;
  /** 모든 구간 공통 중복 발화 차단 키 */
  spokenKeys: Set<string>;
  startedAt: number;
}

export type MultiLegEvent =
  | { type: 'TICK'; now: number }
  | { type: 'BOARDED'; now: number }
  | { type: 'STATION_OBSERVED'; name: string; now: number }
  | { type: 'USER_ALIGHTED'; now: number }
  /** 도보 카드에서 [도착했어요] */
  | { type: 'WALK_DONE'; now: number };

export type ManagerEffect = TransitEffect;

export interface MultiLegResult {
  state: MultiLegState;
  effects: ManagerEffect[];
}

function speakOnce(spoken: Set<string>, key: string, vm: GuidanceViewModel, effects: ManagerEffect[]) {
  if (spoken.has(key)) return;
  spoken.add(key);
  effects.push({ kind: 'SPEAK', key, vm });
}

function enterLeg(s: MultiLegState, index: number, effects: ManagerEffect[]) {
  s.currentIndex = index;
  const leg = s.legs[index];
  if (!leg) {
    s.finished = true;
    s.transit = null;
    speakOnce(s.spokenKeys, `${s.routeId}:ARRIVED`, arrivedVM(s.destName), effects);
    return;
  }
  if (isRideLeg(leg)) {
    s.transit = createTransitState(leg, s.spokenKeys);
    speakOnce(s.spokenKeys, `${leg.id}:BOARDING`, boardingVM(leg), effects);
  } else {
    // TRANSFER_WALK_LEG: 카드가 직접 발화하므로 디스패처는 건너뜀
    s.transit = null;
  }
}

export function createMultiLegState(params: {
  routeId: string;
  destName: string;
  legs: RouteLeg[];
  now: number;
}): MultiLegResult {
  const s: MultiLegState = {
    routeId: params.routeId,
    destName: params.destName,
    legs: params.legs,
    currentIndex: 0,
    transit: null,
    finished: false,
    spokenKeys: new Set(),
    startedAt: params.now,
  };
  const effects: ManagerEffect[] = [];
  enterLeg(s, 0, effects);
  return { state: s, effects };
}

export function currentLeg(s: MultiLegState): RouteLeg | undefined {
  return s.legs[s.currentIndex];
}

export function multiLegReducer(prev: MultiLegState, ev: MultiLegEvent): MultiLegResult {
  const s: MultiLegState = { ...prev, spokenKeys: new Set(prev.spokenKeys) };
  const effects: ManagerEffect[] = [];
  if (s.finished) return { state: s, effects };
  const leg = currentLeg(s);

  if (leg && isRideLeg(leg) && s.transit) {
    if (ev.type === 'WALK_DONE') return { state: s, effects };
    const r = transitReducer(leg, { ...s.transit, spokenKeys: s.spokenKeys }, ev);
    s.spokenKeys = r.state.spokenKeys;
    s.transit = r.state;
    effects.push(...r.effects);
    if (r.state.phase === 'ALIGHTED_OR_TRANSFER') enterLeg(s, s.currentIndex + 1, effects);
    return { state: s, effects };
  }

  if (leg && leg.type === 'TRANSFER_WALK_LEG' && ev.type === 'WALK_DONE') {
    enterLeg(s, s.currentIndex + 1, effects);
  }
  return { state: s, effects };
}
