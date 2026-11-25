// 환승·출구·승강기 데이터 타입
// scripts/convertStationFacilities.ts 가 이 형식의 JSON을 생성합니다.

/** 전철 → 전철 환승 안내 (rail_to_rail_guides.json) */
export interface RailToRailGuide {
  stationName: string;
  /** 노선 키 (예: "1호선") */
  fromLine: string;
  toLine: string;
  /** 빠른 환승 칸-문 번호 (예: "4-2") */
  quickDoor?: string;
  walkMeters?: number;
  elevator: boolean;
  escalator: boolean;
  /** 사람이 읽는 순서대로의 이동 안내 */
  steps: string[];
}

/** 역 출구 안내 (station_exit_guides.json) */
export interface StationExitGuide {
  stationName: string;
  line: string;
  exitNo: string;
  /** 이 출구로 가기 좋은 목적지/방향 설명 */
  destinationHint: string;
  /** 엘리베이터로 지상까지 연결되는 출구인지 */
  elevatorExit: boolean;
  walkMeters?: number;
  steps: string[];
}

export interface StationFacilityDataset {
  generatedAt: string;
  source: string;
  railToRail: RailToRailGuide[];
  exits: StationExitGuide[];
}

/** "수도권 1호선", "1호선", "서울 지하철 1호선" → "1호선" 처럼 비교용 키로 정규화 */
export function normalizeLineKey(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.replace(/\s+/g, '');
  const m = trimmed.match(/(\d+)호선/);
  if (m) return `${Number(m[1])}호선`;
  return trimmed.replace(/^(수도권|서울|서울지하철|서울도시철도)/, '');
}

/** "청량리역" → "청량리", 괄호 부기 제거 */
export function normalizeStationName(name: string | undefined): string {
  if (!name) return '';
  return name.replace(/\(.*?\)/g, '').replace(/\s+/g, '').replace(/역$/, '');
}
