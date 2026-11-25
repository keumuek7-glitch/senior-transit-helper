import type { RideLeg } from './routeLegBuilder';
import { normalizeStationName } from '../metadata/stationTransferMetadata';
import {
  alightedVM,
  boardingVM,
  driftHoldVM,
  inTransitVM,
  preAlightVM,
  stationConfirmedVM,
  wrongDirectionVM,
  type GuidanceViewModel,
} from '../tts/guidanceSpeechBuilder';

/**
 * 전철(버스도 동일 규칙) 한 구간의 상태 머신. 순수 함수(reducer)이며 부수효과는 effects로 돌려줍니다.
 *
 * 상태:
 *  WAITING_BOARDING → IN_TRANSIT_ESTIMATED → STATION_CONFIRMED → PRE_ALIGHT_ALERT → ALIGHTED_OR_TRANSFER
 *  TIMER_DRIFT_HOLD: 역 관측이 들어오는 상황(관측 모드)에서, 마지막 확인 역 이후 다음 역 예상 시간의
 *                    1.35배가 지나도 다음 역이 확인되지 않으면 "열차가 느리다"고 보고
 *                    시간 추정으로 위치를 앞당기지 않으며 시간 기반 하차 알림도 내지 않습니다.
 *                    관측 모드에서는 위치를 관측으로만 앞당기고 타이머는 서행 감지에만 씁니다.
 *                    (관측이 전혀 없는 '시간 전용 모드'에서는 시간 추정만으로 진행합니다.)
 *  WRONG_DIRECTION_SUSPECTED: 예정 정차 목록에 없는 역, 또는 이미 지난 역이 관측됨.
 */
export type TransitPhase =
  | 'WAITING_BOARDING'
  | 'IN_TRANSIT_ESTIMATED'
  | 'STATION_CONFIRMED'
  | 'PRE_ALIGHT_ALERT'
  | 'TIMER_DRIFT_HOLD'
  | 'WRONG_DIRECTION_SUSPECTED'
  | 'ALIGHTED_OR_TRANSFER';

export const DRIFT_RATIO = 1.35;

export interface TransitState {
  legId: string;
  phase: TransitPhase;
  /** 마지막으로 '확인'된 정차 index (탑승 시 0) */
  anchorIndex: number;
  /** anchorIndex가 확인된 시각(ms) */
  anchorAt: number | null;
  boardedAt: number | null;
  /** 시간 추정 위치 */
  estimatedIndex: number;
  /** 탑승 이후 역 관측을 한 번이라도 받았는지 (관측 모드) */
  hasObservations: boolean;
  wrongStation?: string;
  spokenKeys: Set<string>;
}

export type TransitEvent =
  | { type: 'BOARDED'; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'STATION_OBSERVED'; name: string; now: number }
  | { type: 'USER_ALIGHTED'; now: number };

export type TransitEffect =
  | { kind: 'SPEAK'; key: string; vm: GuidanceViewModel }
  | { kind: 'VIBRATE'; pattern: number[] };

export interface TransitResult {
  state: TransitState;
  effects: TransitEffect[];
}

export function createTransitState(leg: RideLeg, spokenKeys: Set<string> = new Set()): TransitState {
  return {
    legId: leg.id,
    phase: 'WAITING_BOARDING',
    anchorIndex: 0,
    anchorAt: null,
    boardedAt: null,
    estimatedIndex: 0,
    hasObservations: false,
    spokenKeys,
  };
}

export const alightIndexOf = (leg: RideLeg) => leg.stations.length - 1;

export function remainingStops(leg: RideLeg, s: TransitState): number {
  const pos = Math.max(s.anchorIndex, s.estimatedIndex);
  return Math.max(0, alightIndexOf(leg) - pos);
}

/** anchor 이후 elapsedSec 만큼 지났을 때 시간상 도달했어야 할 index */
export function estimateIndex(leg: RideLeg, anchorIndex: number, elapsedSec: number): number {
  let idx = anchorIndex;
  let left = elapsedSec;
  while (idx < alightIndexOf(leg) && left >= (leg.hopSeconds[idx] ?? Infinity)) {
    left -= leg.hopSeconds[idx];
    idx++;
  }
  return idx;
}

/** 현재 상태에 맞는 카드 뷰모델 */
export function currentTransitVM(leg: RideLeg, s: TransitState): GuidanceViewModel {
  switch (s.phase) {
    case 'WAITING_BOARDING':
      return boardingVM(leg);
    case 'PRE_ALIGHT_ALERT':
      return preAlightVM(leg);
    case 'TIMER_DRIFT_HOLD':
      return driftHoldVM(leg);
    case 'WRONG_DIRECTION_SUSPECTED':
      return wrongDirectionVM(leg, s.wrongStation ?? '');
    case 'ALIGHTED_OR_TRANSFER':
      return alightedVM(leg);
    case 'STATION_CONFIRMED':
      return stationConfirmedVM(leg, leg.stations[s.anchorIndex], remainingStops(leg, s));
    default:
      return inTransitVM(leg, remainingStops(leg, s), leg.stations[s.estimatedIndex]);
  }
}

function withSpeech(state: TransitState, key: string, vm: GuidanceViewModel, effects: TransitEffect[], vibrate?: number[]) {
  if (state.spokenKeys.has(key)) return;
  state.spokenKeys.add(key);
  if (vibrate) effects.push({ kind: 'VIBRATE', pattern: vibrate });
  effects.push({ kind: 'SPEAK', key, vm });
}

/** 위치(index)와 시간을 보고 단계를 결정하고 필요한 발화를 붙입니다. */
function settle(leg: RideLeg, s: TransitState, now: number, effects: TransitEffect[], justConfirmed: boolean) {
  const last = alightIndexOf(leg);
  const elapsed = s.anchorAt === null ? 0 : (now - s.anchorAt) / 1000;
  const nextHop = leg.hopSeconds[s.anchorIndex] ?? Infinity;
  const drifting = s.hasObservations && s.anchorIndex < last && elapsed > nextHop * DRIFT_RATIO;

  if (drifting) {
    s.estimatedIndex = s.anchorIndex;
    s.phase = 'TIMER_DRIFT_HOLD';
    withSpeech(s, `${leg.id}:DRIFT:${s.anchorIndex}`, driftHoldVM(leg), effects);
    return;
  }

  // 관측 모드: 위치는 관측으로만 앞당기고, 타이머는 서행(드리프트) 감지에만 씁니다.
  // 시간 전용 모드: 관측이 없으므로 시간 추정으로 위치를 앞당깁니다.
  s.estimatedIndex = s.hasObservations ? s.anchorIndex : estimateIndex(leg, s.anchorIndex, elapsed);
  const pos = Math.max(s.anchorIndex, s.estimatedIndex);

  if (pos >= last - 1) {
    s.phase = 'PRE_ALIGHT_ALERT';
    withSpeech(s, `${leg.id}:PRE_ALIGHT`, preAlightVM(leg), effects, [400, 200, 400, 200, 400]);
    return;
  }
  if (justConfirmed) {
    s.phase = 'STATION_CONFIRMED';
    const name = leg.stations[s.anchorIndex];
    withSpeech(s, `${leg.id}:CONFIRMED:${s.anchorIndex}`, stationConfirmedVM(leg, name, last - s.anchorIndex), effects);
    return;
  }
  if (s.phase === 'STATION_CONFIRMED' && s.estimatedIndex === s.anchorIndex) return;
  s.phase = 'IN_TRANSIT_ESTIMATED';
}

export function transitReducer(leg: RideLeg, prev: TransitState, ev: TransitEvent): TransitResult {
  const s: TransitState = { ...prev, spokenKeys: new Set(prev.spokenKeys) };
  const effects: TransitEffect[] = [];
  if (s.phase === 'ALIGHTED_OR_TRANSFER') return { state: s, effects };
  const last = alightIndexOf(leg);

  switch (ev.type) {
    case 'BOARDED': {
      if (s.phase !== 'WAITING_BOARDING') break;
      s.boardedAt = ev.now;
      s.anchorAt = ev.now;
      s.anchorIndex = 0;
      s.phase = 'IN_TRANSIT_ESTIMATED';
      withSpeech(s, `${leg.id}:BOARDED`, inTransitVM(leg, last), effects);
      settle(leg, s, ev.now, effects, false);
      break;
    }
    case 'TICK': {
      if (s.phase === 'WAITING_BOARDING' || s.phase === 'WRONG_DIRECTION_SUSPECTED') break;
      settle(leg, s, ev.now, effects, false);
      break;
    }
    case 'STATION_OBSERVED': {
      const target = normalizeStationName(ev.name);
      const idx = leg.stations.findIndex((n) => normalizeStationName(n) === target);
      if (s.phase === 'WAITING_BOARDING') {
        // 탑승 전 탑승역 관측은 무시, 다른 역이면 아직 판단하지 않음
        break;
      }
      if (idx < 0 || idx < s.anchorIndex) {
        s.phase = 'WRONG_DIRECTION_SUSPECTED';
        s.wrongStation = ev.name;
        withSpeech(s, `${leg.id}:WRONG:${target}`, wrongDirectionVM(leg, ev.name), effects, [800, 300, 800]);
        break;
      }
      s.wrongStation = undefined;
      s.hasObservations = true;
      s.anchorIndex = idx;
      s.anchorAt = ev.now;
      if (idx >= last) {
        s.phase = 'ALIGHTED_OR_TRANSFER';
        withSpeech(s, `${leg.id}:ALIGHTED`, alightedVM(leg), effects);
        break;
      }
      settle(leg, s, ev.now, effects, true);
      break;
    }
    case 'USER_ALIGHTED': {
      s.phase = 'ALIGHTED_OR_TRANSFER';
      break;
    }
  }
  return { state: s, effects };
}
