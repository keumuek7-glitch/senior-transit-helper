import type { RouteCandidate } from '../types';
import { normalizeStationName } from '../metadata/stationTransferMetadata';
import { transferGuideRepository, type TransferGuideRepository } from '../metadata/transferGuideRepository';

/** 어르신 보행 속도 보정 계수: 일반 보행 시간 × 1.45 */
export const SENIOR_WALK_FACTOR = 1.45;
/** 환승 도보가 이 시간(분, 보정 전) 이하이면 '촉박' 경고 */
export const TIGHT_TRANSFER_MIN = 2;
/** 장거리(막장) 환승역 */
export const HEAVY_TRANSFER_STATIONS = ['노원', '고속터미널', '종로3가', '왕십리', '신도림'];

/** 편하게 걷기 점수 가중치 (작을수록 좋음). 초기값이며 실사용 데이터로 조정이 필요합니다. */
export const COMFORT_WEIGHTS = {
  perAdjustedWalkMin: 1.5,
  perTransfer: 8,
  perHeavyTransfer: 10,
  liftBonus: -3,
  perTotalMin: 0.3,
} as const;

export interface ScoredRoute {
  candidate: RouteCandidate;
  adjustedWalkMin: number;
  /** 보행 보정 반영 총 소요 시간 */
  adjustedTotalMin: number;
  comfortScore: number;
  heavyTransfers: string[];
  /** 보정 전 환승 도보가 2분 이하인 구간이 있음 */
  tightTransfer: boolean;
}

export type ClassifiedRoutes =
  | { kind: 'SINGLE'; best: ScoredRoute }
  | { kind: 'DUAL'; comfort: ScoredRoute; fast: ScoredRoute };

export function scoreRoute(
  c: RouteCandidate,
  repo: Pick<TransferGuideRepository, 'hasLiftAt'> = transferGuideRepository,
): ScoredRoute {
  const adjustedWalkMin = c.walkTimeMin * SENIOR_WALK_FACTOR;
  const adjustedTotalMin = c.totalTimeMin + c.walkTimeMin * (SENIOR_WALK_FACTOR - 1);
  const heavyTransfers = c.transferPoints.filter((p) =>
    HEAVY_TRANSFER_STATIONS.includes(normalizeStationName(p)),
  );
  const liftCount = c.transferPoints.filter((p) => repo.hasLiftAt(p)).length;

  // 탈것 사이에 끼어 있는 도보(=환승 도보)만 촉박 여부 판단
  let tightTransfer = false;
  c.segments.forEach((s, i) => {
    if (s.mode !== 'WALK') return;
    const prev = c.segments[i - 1];
    const next = c.segments[i + 1];
    if (prev && next && prev.mode !== 'WALK' && next.mode !== 'WALK' && s.durationMin <= TIGHT_TRANSFER_MIN) {
      tightTransfer = true;
    }
  });
  // 도보 없이 탈것끼리 바로 붙어 있는 경우도 촉박으로 본다
  c.segments.forEach((s, i) => {
    const next = c.segments[i + 1];
    if (next && s.mode !== 'WALK' && next.mode !== 'WALK') tightTransfer = true;
  });

  const w = COMFORT_WEIGHTS;
  const comfortScore =
    adjustedWalkMin * w.perAdjustedWalkMin +
    c.transferCount * w.perTransfer +
    heavyTransfers.length * w.perHeavyTransfer +
    liftCount * w.liftBonus +
    c.totalTimeMin * w.perTotalMin;

  return { candidate: c, adjustedWalkMin, adjustedTotalMin, comfortScore, heavyTransfers, tightTransfer };
}

/** 후보 경로를 '편하게 걷기' / '빨리 가기' 딱 두 개로 줄입니다. 같으면 하나로 합칩니다. */
export function classifyRoutes(
  candidates: RouteCandidate[],
  repo?: Pick<TransferGuideRepository, 'hasLiftAt'>,
): ClassifiedRoutes | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((c) => scoreRoute(c, repo));
  const comfort = [...scored].sort(
    (a, b) => a.comfortScore - b.comfortScore || a.adjustedTotalMin - b.adjustedTotalMin,
  )[0];
  const fast = [...scored].sort(
    (a, b) => a.adjustedTotalMin - b.adjustedTotalMin || a.comfortScore - b.comfortScore,
  )[0];
  if (comfort.candidate.id === fast.candidate.id) return { kind: 'SINGLE', best: comfort };
  return { kind: 'DUAL', comfort, fast };
}
