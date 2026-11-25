import { normalizeLineKey, normalizeStationName } from '../metadata/stationTransferMetadata';
import type { StopRef } from '../types';

/**
 * 노선 마스터에서 출발~하차역 구간을 잘라내고, 역간 시간을 구간 소요 시간에 맞게 보정합니다.
 *
 * 노선 마스터(LINE_MASTER)는 시연용 일부 구간만 들어 있습니다.
 * 역 순서는 실제 노선 순서를 따랐지만, 역간 소요 시간(초)은 균등 가정값입니다.
 * 실제 서비스에서는 공공데이터의 역간 소요시간 데이터로 교체해야 합니다.
 */
export interface LineMasterEntry {
  name: string;
  /** 다음 역까지 예상 소요 시간(초). 마지막 역은 0 */
  secondsToNext: number;
}

export const LINE_MASTER: Record<string, LineMasterEntry[]> = {
  '1호선': ['회기', '청량리', '제기동', '신설동', '동묘앞', '동대문', '종로5가', '종로3가', '종각', '시청', '서울역'].map(
    (name, i, arr) => ({ name, secondsToNext: i === arr.length - 1 ? 0 : 120 }),
  ),
  '4호선': ['성신여대입구', '한성대입구', '혜화', '동대문', '동대문역사문화공원', '충무로'].map(
    (name, i, arr) => ({ name, secondsToNext: i === arr.length - 1 ? 0 : 120 }),
  ),
};

export interface MappedLeg {
  /** 탑승역 ~ 하차역 (탑승역이 index 0) */
  stations: string[];
  /** stations[i] → stations[i+1] 예상 초 (길이 = stations.length - 1) */
  hopSeconds: number[];
  /** 탑승역 기준 반대 방향 첫 역 (역방향 감지·안내용). 모르면 undefined */
  oppositeNeighbor?: string;
  /** 진행 방향 다음 역 */
  nextStation?: string;
  source: 'MASTER' | 'API_STOPS';
}

/** 총 시간을 비율에 맞춰 분배 (반올림 오차는 마지막 구간에 몰아줌) */
export function scaleHops(base: number[], totalSeconds: number): number[] {
  if (base.length === 0) return [];
  const sum = base.reduce((a, b) => a + b, 0);
  if (totalSeconds <= 0) return base.slice();
  const weights = sum > 0 ? base.map((b) => b / sum) : base.map(() => 1 / base.length);
  const scaled = weights.map((w) => Math.round(w * totalSeconds));
  const diff = totalSeconds - scaled.reduce((a, b) => a + b, 0);
  scaled[scaled.length - 1] += diff;
  return scaled;
}

export function mapSubwayStations(params: {
  lineName?: string;
  boardName?: string;
  alightName?: string;
  sectionTimeMin: number;
  apiStops?: StopRef[];
  master?: Record<string, LineMasterEntry[]>;
}): MappedLeg | null {
  const master = params.master ?? LINE_MASTER;
  const totalSec = Math.max(0, Math.round(params.sectionTimeMin * 60));
  const line = master[normalizeLineKey(params.lineName)];
  const board = normalizeStationName(params.boardName);
  const alight = normalizeStationName(params.alightName);

  if (line) {
    const bi = line.findIndex((e) => normalizeStationName(e.name) === board);
    const ai = line.findIndex((e) => normalizeStationName(e.name) === alight);
    if (bi >= 0 && ai >= 0 && bi !== ai) {
      const forward = ai > bi;
      const slice = forward ? line.slice(bi, ai + 1) : line.slice(ai, bi + 1).reverse();
      // 역방향이면 i번째 역 → i+1번째 역 시간은 원래 마스터의 (i+1)번째의 secondsToNext
      const baseHops = forward
        ? slice.slice(0, -1).map((e) => e.secondsToNext)
        : slice.slice(0, -1).map((_, i) => slice[i + 1].secondsToNext);
      const opposite = forward ? line[bi - 1] : line[bi + 1];
      return {
        stations: slice.map((e) => e.name),
        hopSeconds: scaleHops(baseHops, totalSec),
        oppositeNeighbor: opposite?.name,
        nextStation: slice[1]?.name,
        source: 'MASTER',
      };
    }
  }

  // 마스터에 없으면 API가 준 정차역 목록을 균등 분배로 사용
  const stops = params.apiStops;
  if (stops && stops.length >= 2) {
    return {
      stations: stops.map((s) => s.name),
      hopSeconds: scaleHops(new Array(stops.length - 1).fill(1), totalSec),
      nextStation: stops[1].name,
      source: 'API_STOPS',
    };
  }
  return null;
}
