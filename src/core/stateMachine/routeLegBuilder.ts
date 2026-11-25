import type { RouteCandidate, RouteSegment } from '../types';
import { getLineVisual, BUS_VISUAL, type LineVisual } from '../metadata/subwayLineVisuals';
import { normalizeLineKey, type RailToRailGuide, type StationExitGuide } from '../metadata/stationTransferMetadata';
import { transferGuideRepository, type TransferGuideRepository } from '../metadata/transferGuideRepository';
import { SENIOR_WALK_FACTOR } from '../classifier/seniorRouteClassifier';
import { mapSubwayStations, scaleHops } from './subwayStationMapper';

export interface RideLeg {
  id: string;
  type: 'SUBWAY_LEG' | 'BUS_LEG';
  lineKey: string;
  busNo?: string;
  visual: LineVisual;
  boardName: string;
  alightName: string;
  /** 탑승~하차 정차 목록 (index 0 = 탑승역) */
  stations: string[];
  hopSeconds: number[];
  expectedSec: number;
  quickDoor?: string;
  nextStation?: string;
  oppositeNeighbor?: string;
}

export interface WalkLeg {
  id: string;
  type: 'TRANSFER_WALK_LEG';
  /** ACCESS=출발지→첫 탑승, TRANSFER=환승, EXIT=마지막 하차→목적지 */
  walkKind: 'ACCESS' | 'TRANSFER' | 'EXIT';
  fromName?: string;
  toName?: string;
  distanceM: number;
  /** 어르신 보행 보정 시간(분) */
  adjustedMin: number;
  railGuide?: RailToRailGuide;
  exitGuide?: StationExitGuide;
  nextRide?: RideLeg;
}

export type RouteLeg = RideLeg | WalkLeg;

export const isRideLeg = (l: RouteLeg | undefined): l is RideLeg =>
  !!l && (l.type === 'SUBWAY_LEG' || l.type === 'BUS_LEG');

function buildRide(seg: RouteSegment, id: string): RideLeg | null {
  const board = seg.startName ?? seg.stops?.[0]?.name ?? '';
  const alight = seg.endName ?? seg.stops?.[seg.stops.length - 1]?.name ?? '';
  if (seg.mode === 'SUBWAY') {
    const mapped = mapSubwayStations({
      lineName: seg.lineName,
      boardName: board,
      alightName: alight,
      sectionTimeMin: seg.durationMin,
      apiStops: seg.stops,
    });
    const stations = mapped?.stations ?? [board, alight];
    const hopSeconds = mapped?.hopSeconds ?? scaleHops([1], seg.durationMin * 60);
    return {
      id,
      type: 'SUBWAY_LEG',
      lineKey: normalizeLineKey(seg.lineName) || '전철',
      visual: getLineVisual(seg.lineName, seg.subwayCode),
      boardName: board,
      alightName: alight,
      stations,
      hopSeconds,
      expectedSec: hopSeconds.reduce((a, b) => a + b, 0),
      quickDoor: seg.quickDoor,
      nextStation: mapped?.nextStation ?? stations[1],
      oppositeNeighbor: mapped?.oppositeNeighbor,
    };
  }
  if (seg.mode === 'BUS') {
    const stations = seg.stops?.map((s) => s.name) ?? [board, alight];
    const hopSeconds = scaleHops(new Array(Math.max(1, stations.length - 1)).fill(1), seg.durationMin * 60);
    return {
      id,
      type: 'BUS_LEG',
      lineKey: '버스',
      busNo: seg.busNo,
      visual: BUS_VISUAL,
      boardName: board,
      alightName: alight,
      stations,
      hopSeconds,
      expectedSec: hopSeconds.reduce((a, b) => a + b, 0),
      nextStation: stations[1],
    };
  }
  return null;
}

/** 선택된 RouteCandidate → RouteLeg[] */
export function buildRouteLegs(
  route: RouteCandidate,
  opts: { destName?: string; repo?: TransferGuideRepository } = {},
): RouteLeg[] {
  const repo = opts.repo ?? transferGuideRepository;
  const segs = route.segments;
  const rides = new Map<number, RideLeg>();
  segs.forEach((s, i) => {
    const r = buildRide(s, `leg-${i}`);
    if (r) rides.set(i, r);
  });

  const legs: RouteLeg[] = [];
  segs.forEach((s, i) => {
    const ride = rides.get(i);
    if (ride) {
      legs.push(ride);
      return;
    }
    if (s.mode !== 'WALK') return;
    // 앞/뒤 탈것 찾기
    const prevIdx = [...rides.keys()].filter((k) => k < i).pop();
    const nextIdx = [...rides.keys()].find((k) => k > i);
    const prev = prevIdx !== undefined ? rides.get(prevIdx) : undefined;
    const next = nextIdx !== undefined ? rides.get(nextIdx) : undefined;
    // 거리 0인 도보(같은 승강장 환승 등)는 따로 카드로 만들지 않되, 환승이면 안내가 필요하므로 유지
    if (s.distanceM <= 0 && !(prev && next)) return;

    const walkKind: WalkLeg['walkKind'] = prev && next ? 'TRANSFER' : prev ? 'EXIT' : 'ACCESS';
    const leg: WalkLeg = {
      id: `leg-${i}`,
      type: 'TRANSFER_WALK_LEG',
      walkKind,
      fromName: prev?.alightName,
      toName: walkKind === 'EXIT' ? opts.destName : next?.boardName,
      distanceM: s.distanceM,
      adjustedMin: s.durationMin * SENIOR_WALK_FACTOR,
      nextRide: next,
    };
    if (walkKind === 'TRANSFER' && prev) {
      leg.railGuide = repo.findRailTransfer(prev.alightName, prev.lineKey, next?.lineKey);
    }
    if (walkKind === 'EXIT' && prev) {
      leg.exitGuide = repo.findExitGuide(prev.alightName, prev.type === 'SUBWAY_LEG' ? prev.lineKey : undefined);
    }
    legs.push(leg);
  });

  // 문 번호가 API에 없으면 환승 데이터의 빠른환승 문 번호로 보충
  legs.forEach((l, i) => {
    const after = legs[i + 1];
    if (isRideLeg(l) && !l.quickDoor && after?.type === 'TRANSFER_WALK_LEG' && after.railGuide?.quickDoor) {
      l.quickDoor = after.railGuide.quickDoor;
    }
  });
  return legs;
}
