import { describe, expect, it } from 'vitest';
import sample from '../src/data/sampleOdsayResponse.json';
import { parseOdsayResponse, OdsayParseError } from '../src/core/parser/odsayRouteParser';
import { classifyRoutes, scoreRoute, SENIOR_WALK_FACTOR } from '../src/core/classifier/seniorRouteClassifier';
import { buildRouteLegs, isRideLeg, type RideLeg, type WalkLeg } from '../src/core/stateMachine/routeLegBuilder';
import { mapSubwayStations, scaleHops } from '../src/core/stateMachine/subwayStationMapper';
import { createTransitState, transitReducer, type TransitState } from '../src/core/stateMachine/transitStateMachine';
import { createMultiLegState, multiLegReducer, type MultiLegState } from '../src/core/stateMachine/multiLegManager';
import { reconcileSession, SESSION_TTL_MS } from '../src/core/stateMachine/sessionTimeReconciler';
import { preprocessForSpeech } from '../src/core/tts/guidanceSpeechBuilder';
import { decodeGuardianLink, encodeGuardianLink } from '../src/core/guardian/guardianLinkCodec';
import { buildSmsUri, buildSosMessage } from '../src/core/guardian/sosMessageBuilder';
import { getLineVisual } from '../src/core/metadata/subwayLineVisuals';
import { serializeSession, deserializeSession } from '../src/hooks/usePersistedMultiLegSession';
import { parseCsv, toRailGuides } from '../scripts/convertStationFacilities';
import type { RouteCandidate } from '../src/core/types';

const T0 = 1_700_000_000_000;
const routes = parseOdsayResponse(sample);
const fastRoute = routes[0]; // 1호선 → 4호선
const comfortRoute = routes[1]; // 1호선 → 버스

describe('odsayRouteParser', () => {
  it('샘플 응답을 경로 2개로 파싱', () => {
    expect(routes).toHaveLength(2);
    expect(fastRoute.totalTimeMin).toBe(28);
    expect(fastRoute.walkTimeMin).toBe(15);
    expect(fastRoute.transferCount).toBe(1);
    expect(fastRoute.transferPoints).toEqual(['동대문']);
    const subway = fastRoute.segments[1];
    expect(subway.mode).toBe('SUBWAY');
    expect(subway.lineName).toBe('수도권 1호선');
    expect(subway.quickDoor).toBe('4-2');
    expect(subway.stops?.map((s) => s.name)).toEqual(['청량리', '제기동', '신설동', '동묘앞', '동대문']);
    expect(comfortRoute.segments.find((s) => s.mode === 'BUS')?.busNo).toBe('예시 100');
  });

  it('error 응답은 OdsayParseError', () => {
    expect(() => parseOdsayResponse({ error: { code: '-98', message: '검색 결과 없음' } })).toThrow(OdsayParseError);
    expect(() => parseOdsayResponse({ error: [{ code: '500', message: 'x' }] })).toThrow('x');
    expect(() => parseOdsayResponse(null)).toThrow(OdsayParseError);
  });

  it('탈것이 없는 경로와 알 수 없는 trafficType은 버림', () => {
    const r = parseOdsayResponse({
      result: { path: [{ info: { totalTime: 5 }, subPath: [{ trafficType: 3, sectionTime: 5, distance: 300 }, { trafficType: 9 }] }] },
    });
    expect(r).toEqual([]);
  });
});

describe('seniorRouteClassifier', () => {
  it('보행 보정 계수 1.45 반영', () => {
    const s = scoreRoute(fastRoute);
    expect(s.adjustedWalkMin).toBeCloseTo(15 * SENIOR_WALK_FACTOR);
    expect(s.adjustedTotalMin).toBeCloseTo(28 + 15 * 0.45);
  });

  it('샘플: 편하게 걷기=전철+버스, 빨리 가기=전철+전철', () => {
    const c = classifyRoutes(routes);
    expect(c?.kind).toBe('DUAL');
    if (c?.kind !== 'DUAL') return;
    expect(c.comfort.candidate.id).toBe(comfortRoute.id);
    expect(c.fast.candidate.id).toBe(fastRoute.id);
  });

  it('두 경로가 같으면 단일 카드로 통합', () => {
    const c = classifyRoutes([comfortRoute]);
    expect(c?.kind).toBe('SINGLE');
    expect(classifyRoutes([])).toBeNull();
  });

  it('막장 환승역 페널티와 촉박 환승 플래그', () => {
    const heavy: RouteCandidate = { ...fastRoute, id: 'h', transferPoints: ['신도림'] };
    const noLift = { hasLiftAt: () => false };
    expect(scoreRoute(heavy, noLift).heavyTransfers).toEqual(['신도림']);
    expect(scoreRoute(heavy, noLift).comfortScore).toBeGreaterThan(scoreRoute({ ...fastRoute, transferPoints: ['동대문'] }, noLift).comfortScore);

    const tight: RouteCandidate = {
      ...fastRoute,
      id: 't',
      segments: fastRoute.segments.map((s, i) => (i === 2 ? { ...s, durationMin: 2 } : s)),
    };
    expect(scoreRoute(tight).tightTransfer).toBe(true);
    expect(scoreRoute(fastRoute).tightTransfer).toBe(false);
  });
});

describe('subwayStationMapper', () => {
  it('정방향 슬라이싱, 반대편 이웃 역, 시간 보정 합계 일치', () => {
    const m = mapSubwayStations({ lineName: '수도권 1호선', boardName: '청량리역', alightName: '동대문', sectionTimeMin: 9 })!;
    expect(m.stations).toEqual(['청량리', '제기동', '신설동', '동묘앞', '동대문']);
    expect(m.oppositeNeighbor).toBe('회기');
    expect(m.nextStation).toBe('제기동');
    expect(m.hopSeconds.reduce((a, b) => a + b, 0)).toBe(540);
  });

  it('역방향(마스터 순서 반대) 슬라이싱', () => {
    const m = mapSubwayStations({ lineName: '4호선', boardName: '동대문', alightName: '혜화', sectionTimeMin: 2 })!;
    expect(m.stations).toEqual(['동대문', '혜화']);
    expect(m.oppositeNeighbor).toBe('동대문역사문화공원');
  });

  it('마스터에 없으면 API 정차역 사용, 아예 없으면 null', () => {
    const m = mapSubwayStations({
      lineName: '9호선', boardName: 'A', alightName: 'C', sectionTimeMin: 3,
      apiStops: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }],
    })!;
    expect(m.source).toBe('API_STOPS');
    expect(m.hopSeconds).toEqual([90, 90]);
    expect(mapSubwayStations({ lineName: '9호선', boardName: 'A', alightName: 'C', sectionTimeMin: 3 })).toBeNull();
  });

  it('scaleHops 반올림 오차 보정', () => {
    expect(scaleHops([1, 1, 1], 100).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('routeLegBuilder', () => {
  it('전철+환승+버스 경로를 구간으로 변환', () => {
    const legs = buildRouteLegs(comfortRoute, { destName: '서울대병원' });
    expect(legs.map((l) => (l.type === 'TRANSFER_WALK_LEG' ? `WALK:${l.walkKind}` : l.type))).toEqual([
      'WALK:ACCESS', 'SUBWAY_LEG', 'WALK:TRANSFER', 'BUS_LEG', 'WALK:EXIT',
    ]);
    const subway = legs[1] as RideLeg;
    expect(subway.stations.at(-1)).toBe('종로5가');
    expect(subway.visual.bgHex).toBe('#0052A4');
    const transfer = legs[2] as WalkLeg;
    expect(transfer.railGuide?.elevator).toBe(true);
    expect(transfer.adjustedMin).toBeCloseTo(2 * 1.45);
  });

  it('출구 안내 데이터 연결 (혜화 3번 출구)', () => {
    const legs = buildRouteLegs(fastRoute, { destName: '서울대병원' });
    const exit = legs.at(-1) as WalkLeg;
    expect(exit.walkKind).toBe('EXIT');
    expect(exit.exitGuide?.exitNo).toBe('3');
  });
});

function subwayLeg(): RideLeg {
  return buildRouteLegs(fastRoute).find(isRideLeg)! as RideLeg; // 청량리→동대문, 4정거장, 135초 간격
}

function run(leg: RideLeg, s: TransitState, ev: Parameters<typeof transitReducer>[2]) {
  return transitReducer(leg, s, ev);
}

describe('transitStateMachine', () => {
  it('탑승 → 시간 추정 → 1정거장 전 알림(진동+TTS 1회만)', () => {
    const leg = subwayLeg();
    let r = run(leg, createTransitState(leg), { type: 'BOARDED', now: T0 });
    expect(r.state.phase).toBe('IN_TRANSIT_ESTIMATED');
    r = run(leg, r.state, { type: 'TICK', now: T0 + 136_000 });
    expect(r.state.estimatedIndex).toBe(1);
    r = run(leg, r.state, { type: 'TICK', now: T0 + 3 * 135_000 + 1000 });
    expect(r.state.phase).toBe('PRE_ALIGHT_ALERT');
    expect(r.effects.map((e) => e.kind)).toEqual(['VIBRATE', 'SPEAK']);
    const again = run(leg, r.state, { type: 'TICK', now: T0 + 3 * 135_000 + 2000 });
    expect(again.effects).toHaveLength(0); // spokenKeys로 중복 차단
  });

  it('역 관측 → STATION_CONFIRMED, 하차역 관측 → ALIGHTED_OR_TRANSFER', () => {
    const leg = subwayLeg();
    let r = run(leg, createTransitState(leg), { type: 'BOARDED', now: T0 });
    r = run(leg, r.state, { type: 'STATION_OBSERVED', name: '제기동', now: T0 + 60_000 });
    expect(r.state.phase).toBe('STATION_CONFIRMED');
    expect(r.state.anchorIndex).toBe(1);
    r = run(leg, r.state, { type: 'STATION_OBSERVED', name: '동묘앞', now: T0 + 200_000 });
    expect(r.state.phase).toBe('PRE_ALIGHT_ALERT');
    r = run(leg, r.state, { type: 'STATION_OBSERVED', name: '동대문', now: T0 + 300_000 });
    expect(r.state.phase).toBe('ALIGHTED_OR_TRANSFER');
  });

  it('서행: 관측 모드에서 다음 역이 1.35배 넘게 늦으면 TIMER_DRIFT_HOLD, 하차 알림 보류', () => {
    const leg = subwayLeg();
    let r = run(leg, createTransitState(leg), { type: 'BOARDED', now: T0 });
    r = run(leg, r.state, { type: 'STATION_OBSERVED', name: '신설동', now: T0 + 270_000 }); // index 2
    r = run(leg, r.state, { type: 'TICK', now: T0 + 270_000 + 135_000 * 1.3 });
    expect(r.state.phase).not.toBe('TIMER_DRIFT_HOLD');
    r = run(leg, r.state, { type: 'TICK', now: T0 + 270_000 + 135_000 * 1.4 });
    expect(r.state.phase).toBe('TIMER_DRIFT_HOLD');
    // 시간이 한참 흘러도 관측 전까지는 하차 알림을 내지 않음
    r = run(leg, r.state, { type: 'TICK', now: T0 + 270_000 + 135_000 * 3 });
    expect(r.state.phase).toBe('TIMER_DRIFT_HOLD');
    expect(r.state.spokenKeys.has(`${leg.id}:PRE_ALIGHT`)).toBe(false);
    // 다음 역이 확인되면 정상 복귀
    r = run(leg, r.state, { type: 'STATION_OBSERVED', name: '동묘앞', now: T0 + 700_000 });
    expect(r.state.phase).toBe('PRE_ALIGHT_ALERT');
  });

  it('시간 전용 모드(관측 없음)에서는 드리프트 보류를 하지 않음', () => {
    const leg = subwayLeg();
    let r = run(leg, createTransitState(leg), { type: 'BOARDED', now: T0 });
    r = run(leg, r.state, { type: 'TICK', now: T0 + 200_000 });
    expect(r.state.phase).toBe('IN_TRANSIT_ESTIMATED');
  });

  it('예정 외 역 관측 → WRONG_DIRECTION_SUSPECTED, 이후 예정 역 관측 시 복귀', () => {
    const leg = subwayLeg();
    let r = run(leg, createTransitState(leg), { type: 'BOARDED', now: T0 });
    r = run(leg, r.state, { type: 'STATION_OBSERVED', name: '회기', now: T0 + 120_000 });
    expect(r.state.phase).toBe('WRONG_DIRECTION_SUSPECTED');
    expect(r.state.wrongStation).toBe('회기');
    expect(r.effects.some((e) => e.kind === 'VIBRATE')).toBe(true);
    // 이미 지난 역(뒤로 감)도 역방향 의심
    r = run(leg, r.state, { type: 'STATION_OBSERVED', name: '신설동', now: T0 + 300_000 });
    expect(r.state.phase).toBe('STATION_CONFIRMED');
    r = run(leg, r.state, { type: 'STATION_OBSERVED', name: '제기동', now: T0 + 400_000 });
    expect(r.state.phase).toBe('WRONG_DIRECTION_SUSPECTED');
  });
});

describe('multiLegManager', () => {
  const legs = buildRouteLegs(comfortRoute, { destName: '서울대병원' });

  it('TRANSFER_WALK_LEG 진입 시 디스패처는 발화하지 않음(카드가 직접 읽음)', () => {
    const start = createMultiLegState({ routeId: 'r', destName: '서울대병원', legs, now: T0 });
    expect(start.state.currentIndex).toBe(0);
    expect(start.effects).toHaveLength(0); // 첫 구간이 도보
    const r = multiLegReducer(start.state, { type: 'WALK_DONE', now: T0 + 1000 });
    expect(r.state.currentIndex).toBe(1);
    expect(r.effects.map((e) => (e.kind === 'SPEAK' ? e.key : e.kind))).toEqual(['leg-1:BOARDING']);
  });

  it('전철 → 환승 도보 → 버스 → 출구 → 도착', () => {
    let s: MultiLegState = createMultiLegState({ routeId: 'r', destName: '서울대병원', legs, now: T0 }).state;
    const step = (ev: Parameters<typeof multiLegReducer>[1]) => {
      const r = multiLegReducer(s, ev);
      s = r.state;
      return r.effects;
    };
    step({ type: 'WALK_DONE', now: T0 });
    step({ type: 'BOARDED', now: T0 + 1000 });
    step({ type: 'USER_ALIGHTED', now: T0 + 600_000 });
    expect(s.legs[s.currentIndex].type).toBe('TRANSFER_WALK_LEG');
    const walkEffects = step({ type: 'TICK', now: T0 + 601_000 });
    expect(walkEffects).toHaveLength(0);
    const busEffects = step({ type: 'WALK_DONE', now: T0 + 700_000 });
    expect(s.legs[s.currentIndex].type).toBe('BUS_LEG');
    expect(busEffects).toHaveLength(1);
    step({ type: 'BOARDED', now: T0 + 710_000 });
    step({ type: 'STATION_OBSERVED', name: '서울대병원 앞 정류장(예시)', now: T0 + 1_100_000 });
    expect((s.legs[s.currentIndex] as WalkLeg).walkKind).toBe('EXIT');
    const arrive = step({ type: 'WALK_DONE', now: T0 + 1_200_000 });
    expect(s.finished).toBe(true);
    expect(arrive[0]).toMatchObject({ kind: 'SPEAK', key: 'r:ARRIVED' });
  });
});

describe('sessionTimeReconciler & 세션 직렬화', () => {
  function onSubway(): MultiLegState {
    const legs = buildRouteLegs(fastRoute, { destName: '서울대병원' });
    let s = createMultiLegState({ routeId: 'r', destName: '서울대병원', legs, now: T0 }).state;
    s = multiLegReducer(s, { type: 'WALK_DONE', now: T0 }).state;
    s = multiLegReducer(s, { type: 'BOARDED', now: T0 }).state;
    return s;
  }

  it('앱이 꺼진 동안 하차역을 지났으면 경고', () => {
    const s = onSubway();
    const r = reconcileSession(s, T0 + 10_000, T0 + 15 * 60_000);
    expect(r.warning).toMatchObject({ kind: 'MISSED_STOP_LIKELY', alightName: '동대문' });
    expect(r.offlineSec).toBeCloseTo(890);
  });

  it('곧 내릴 차례면 ALIGHT_SOON, 복원 시 하차 알림 효과 포함', () => {
    const s = onSubway();
    const r = reconcileSession(s, T0, T0 + 3 * 135_000 + 5_000);
    expect(r.warning.kind).toBe('ALIGHT_SOON');
    expect(r.effects.some((e) => e.kind === 'SPEAK')).toBe(true);
  });

  it('TTL 지난 세션은 폐기', () => {
    const s = onSubway();
    const r = reconcileSession(s, T0, T0 + SESSION_TTL_MS + 1);
    expect(r.expired).toBe(true);
    expect(r.state).toBeNull();
  });

  it('Set ↔ Array 직렬화 왕복', () => {
    const s = onSubway();
    const restored = deserializeSession(serializeSession(s, T0))!;
    expect(restored.savedAt).toBe(T0);
    expect(restored.state.spokenKeys).toBeInstanceOf(Set);
    expect([...restored.state.spokenKeys]).toEqual([...s.spokenKeys]);
    expect(restored.state.transit?.spokenKeys).toBe(restored.state.spokenKeys);
    expect(deserializeSession('not json')).toBeNull();
  });
});

describe('TTS 전처리·노선색·보호자 기능', () => {
  it('발음 전처리', () => {
    expect(preprocessForSpeech('4-2번 문 앞에서 타세요')).toBe('4 다시 2번 문 앞에서 타세요');
    expect(preprocessForSpeech('약 30m 걸어요')).toBe('약 30미터 걸어요');
    expect(preprocessForSpeech('1.2km')).toBe('1.2킬로미터');
  });

  it('노선색 조회', () => {
    expect(getLineVisual('수도권 2호선')).toMatchObject({ bgHex: '#00A84D', colorName: '초록색' });
    expect(getLineVisual(undefined, 4).key).toBe('4호선');
    expect(getLineVisual('알수없는선').key).toBe('알수없는선');
  });

  it('보호자 목적지 링크 인코딩/디코딩 및 잘못된 링크 거절', () => {
    const url = encodeGuardianLink('https://example.com/', { name: '서울대병원', x: 126.999, y: 37.5797 });
    const decoded = decodeGuardianLink(new URL(url).search);
    expect(decoded).toEqual({ name: '서울대병원', x: 126.999, y: 37.5797 });
    expect(decodeGuardianLink('?dest=부산&ex=129.07&ey=35.17')).toBeNull();
    expect(decodeGuardianLink('?dest=x&ex=abc&ey=37.5')).toBeNull();
    expect(decodeGuardianLink('?ex=127&ey=37.5')).toBeNull();
  });

  it('SOS 메시지와 sms 링크', () => {
    const msg = buildSosMessage({ lat: 37.58, lng: 127.04, destName: '서울대병원', at: new Date(2026, 0, 1, 9, 5) });
    expect(msg).toContain('(09:05)');
    expect(msg).toContain('https://maps.google.com/?q=37.58000,127.04000');
    expect(buildSmsUri('010-1234-5678', 'hi', 'Android')).toBe('sms:01012345678?body=hi');
    expect(buildSmsUri('010-1234-5678', 'hi', 'iPhone')).toBe('sms:01012345678&body=hi');
  });
});

describe('convertStationFacilities', () => {
  it('따옴표 포함 CSV 파싱과 환승 안내 변환', () => {
    const rows = parseCsv('역명,출발노선,도착노선,엘리베이터,에스컬레이터,안내\n"신도림역","수도권 1호선",2호선,Y,N,"a|b, c"\n');
    const g = toRailGuides(rows);
    expect(g).toEqual([
      { stationName: '신도림', fromLine: '1호선', toLine: '2호선', quickDoor: undefined, walkMeters: undefined, elevator: true, escalator: false, steps: ['a', 'b, c'] },
    ]);
  });
});
