// 앱 전역에서 쓰는 핵심 도메인 타입

export type SegmentMode = 'SUBWAY' | 'BUS' | 'WALK';

export interface StopRef {
  id: string;
  name: string;
  /** 경도 (ODsay x) */
  x?: number;
  /** 위도 (ODsay y) */
  y?: number;
}

export interface RouteSegment {
  mode: SegmentMode;
  durationMin: number;
  distanceM: number;
  /** 전철 노선명 (예: "수도권 1호선") */
  lineName?: string;
  /** ODsay subwayCode (1~9호선 등) */
  subwayCode?: number;
  /** 버스 번호 */
  busNo?: string;
  startName?: string;
  endName?: string;
  /** 방면 (ODsay way, 있을 때만) */
  way?: string;
  /** 빠른 하차/환승 문 번호 (예: "4-2") — ODsay door 필드가 있을 때만 */
  quickDoor?: string;
  stationCount?: number;
  stops?: StopRef[];
}

export interface RouteCandidate {
  id: string;
  /** API가 준 총 소요 시간(분) */
  totalTimeMin: number;
  /** 도보 구간 소요 시간 합(분, 보정 전) */
  walkTimeMin: number;
  walkDistanceM: number;
  /** 갈아타기 횟수 = 탈것 구간 수 - 1 */
  transferCount: number;
  payment?: number;
  segments: RouteSegment[];
  /** 환승이 일어나는 역/정류장 이름 */
  transferPoints: string[];
}
