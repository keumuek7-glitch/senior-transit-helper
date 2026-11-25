import { currentLeg, multiLegReducer, type ManagerEffect, type MultiLegState } from './multiLegManager';
import { isRideLeg } from './routeLegBuilder';
import { alightIndexOf, estimateIndex } from './transitStateMachine';

/** 저장된 세션을 이 시간보다 오래되면 버립니다 */
export const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

export type ReconcileWarning =
  | { kind: 'NONE' }
  /** 앱이 꺼져 있던 사이 하차 시점이 지난 것으로 추정 */
  | { kind: 'MISSED_STOP_LIKELY'; alightName: string; overdueMin: number }
  /** 곧 내릴 차례 */
  | { kind: 'ALIGHT_SOON'; alightName: string };

export interface ReconcileResult {
  state: MultiLegState | null;
  warning: ReconcileWarning;
  offlineSec: number;
  expired: boolean;
  /** 복원 직후 실행할 발화/진동 (예: 하차 알림) */
  effects: ManagerEffect[];
}

/**
 * 앱 종료/오프라인 동안 흐른 시간을 반영합니다.
 *  - TTL 지난 세션은 폐기
 *  - 탑승 중이었다면 시간 추정 위치를 다시 계산하고(TICK), 하차역을 지났을 가능성이 크면 경고
 */
export function reconcileSession(saved: MultiLegState, savedAt: number, now: number): ReconcileResult {
  const offlineSec = Math.max(0, (now - savedAt) / 1000);
  if (now - saved.startedAt > SESSION_TTL_MS || saved.finished) {
    return { state: null, warning: { kind: 'NONE' }, offlineSec, expired: true, effects: [] };
  }

  const leg = currentLeg(saved);
  const t = saved.transit;
  let warning: ReconcileWarning = { kind: 'NONE' };

  if (leg && isRideLeg(leg) && t && t.anchorAt !== null && t.phase !== 'WAITING_BOARDING') {
    const elapsed = (now - t.anchorAt) / 1000;
    const last = alightIndexOf(leg);
    const remainingSec = leg.hopSeconds.slice(t.anchorIndex).reduce((a, b) => a + b, 0);
    if (elapsed > remainingSec + 60) {
      warning = { kind: 'MISSED_STOP_LIKELY', alightName: leg.alightName, overdueMin: Math.round((elapsed - remainingSec) / 60) };
    } else if (estimateIndex(leg, t.anchorIndex, elapsed) >= last - 1) {
      warning = { kind: 'ALIGHT_SOON', alightName: leg.alightName };
    }
  }

  const ticked = multiLegReducer(saved, { type: 'TICK', now });
  return { state: ticked.state, warning, offlineSec, expired: false, effects: ticked.effects };
}
