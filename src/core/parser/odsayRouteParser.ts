import type { RouteCandidate, RouteSegment, SegmentMode, StopRef } from '../types';

/**
 * ODsay searchPubTransPathT 응답 → RouteCandidate[]
 *
 * 가정(README에도 명시): 응답 구조를 다음과 같이 가정합니다.
 *  - result.path[].info.totalTime(분), info.payment
 *  - result.path[].subPath[].trafficType: 1=지하철, 2=버스, 3=도보
 *  - subPath.sectionTime(분), distance(m), stationCount, startName/endName, way, door
 *  - subPath.lane[0].name / subwayCode (지하철), lane[0].busNo (버스)
 *  - subPath.passStopList.stations[].stationID / stationName / x / y
 *  - 오류 시 { error: { code, message | msg } } 또는 { error: [...] }
 * 필드가 없거나 형식이 다르면 가능한 범위에서 건너뛰고, 탈것이 하나도 없는 경로는 버립니다.
 */

export class OdsayParseError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'OdsayParseError';
  }
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function optNum(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '' && v !== 'null') return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

function extractError(raw: Json): { message: string; code?: string } | null {
  const err = raw.error;
  if (!err) return null;
  const first = Array.isArray(err) ? err[0] : err;
  if (isObj(first)) {
    return {
      message: str(first.message) ?? str(first.msg) ?? 'ODsay 오류',
      code: str(first.code),
    };
  }
  return { message: String(err) };
}

function parseStops(sp: Json): StopRef[] | undefined {
  const list = isObj(sp.passStopList) ? sp.passStopList.stations : undefined;
  if (!Array.isArray(list)) return undefined;
  const stops = list
    .filter(isObj)
    .map((s, i) => ({
      id: str(s.stationID) ?? `idx-${i}`,
      name: str(s.stationName) ?? '',
      x: optNum(s.x),
      y: optNum(s.y),
    }))
    .filter((s) => s.name !== '');
  return stops.length > 0 ? stops : undefined;
}

function parseSegment(sp: Json): RouteSegment | null {
  const t = num(sp.trafficType, -1);
  const mode: SegmentMode | null = t === 1 ? 'SUBWAY' : t === 2 ? 'BUS' : t === 3 ? 'WALK' : null;
  if (!mode) return null;
  const lane = Array.isArray(sp.lane) && isObj(sp.lane[0]) ? (sp.lane[0] as Json) : undefined;
  const seg: RouteSegment = {
    mode,
    durationMin: num(sp.sectionTime),
    distanceM: num(sp.distance),
  };
  if (mode !== 'WALK') {
    seg.startName = str(sp.startName);
    seg.endName = str(sp.endName);
    seg.way = str(sp.way);
    seg.quickDoor = str(sp.door);
    seg.stationCount = optNum(sp.stationCount);
    seg.stops = parseStops(sp);
    if (mode === 'SUBWAY') {
      seg.lineName = lane ? str(lane.name) : undefined;
      seg.subwayCode = lane ? optNum(lane.subwayCode) : undefined;
    } else {
      seg.busNo = lane ? str(lane.busNo) : undefined;
    }
  }
  return seg;
}

export function parseOdsayResponse(raw: unknown): RouteCandidate[] {
  if (!isObj(raw)) throw new OdsayParseError('응답이 객체가 아닙니다.');
  const err = extractError(raw);
  if (err) throw new OdsayParseError(err.message, err.code);
  const result = raw.result;
  if (!isObj(result) || !Array.isArray(result.path)) {
    throw new OdsayParseError('result.path 가 없습니다.');
  }

  const candidates: RouteCandidate[] = [];
  result.path.forEach((p, pathIdx) => {
    if (!isObj(p) || !Array.isArray(p.subPath)) return;
    const info = isObj(p.info) ? p.info : {};
    const segments = p.subPath
      .filter(isObj)
      .map(parseSegment)
      .filter((s): s is RouteSegment => s !== null);
    const rides = segments.filter((s) => s.mode !== 'WALK');
    if (rides.length === 0) return;

    const walks = segments.filter((s) => s.mode === 'WALK');
    const sumDuration = segments.reduce((acc, s) => acc + s.durationMin, 0);
    const transferPoints = rides.slice(0, -1).map((r) => r.endName ?? '').filter(Boolean);

    candidates.push({
      id: `path-${pathIdx}`,
      totalTimeMin: num(info.totalTime, sumDuration),
      walkTimeMin: walks.reduce((a, s) => a + s.durationMin, 0),
      walkDistanceM: walks.reduce((a, s) => a + s.distanceM, 0),
      transferCount: rides.length - 1,
      payment: optNum(info.payment),
      segments,
      transferPoints,
    });
  });
  return candidates;
}
