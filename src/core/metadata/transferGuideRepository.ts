import railJson from '../../data/rail_to_rail_guides.json';
import exitJson from '../../data/station_exit_guides.json';
import {
  normalizeLineKey,
  normalizeStationName,
  type RailToRailGuide,
  type StationExitGuide,
} from './stationTransferMetadata';

/** scripts/convertStationFacilities.ts 가 만든 JSON을 조회합니다. 테스트용으로 데이터 주입도 가능합니다. */
export class TransferGuideRepository {
  constructor(
    private readonly rail: RailToRailGuide[] = railJson as RailToRailGuide[],
    private readonly exits: StationExitGuide[] = exitJson as StationExitGuide[],
  ) {}

  findRailTransfer(station: string | undefined, fromLine?: string, toLine?: string): RailToRailGuide | undefined {
    const st = normalizeStationName(station);
    const from = normalizeLineKey(fromLine);
    const to = normalizeLineKey(toLine);
    return this.rail.find(
      (g) => g.stationName === st && (!from || g.fromLine === from) && (!to || g.toLine === to),
    );
  }

  findExitGuide(station: string | undefined, line?: string): StationExitGuide | undefined {
    const st = normalizeStationName(station);
    const ln = normalizeLineKey(line);
    const matches = this.exits.filter((g) => g.stationName === st && (!ln || g.line === ln));
    // 엘리베이터 출구를 우선
    return matches.find((g) => g.elevatorExit) ?? matches[0];
  }

  /** 해당 역에서 승강기(엘리베이터 또는 에스컬레이터) 동선이 확인되는지 */
  hasLiftAt(station: string | undefined): boolean {
    const st = normalizeStationName(station);
    return (
      this.rail.some((g) => g.stationName === st && (g.elevator || g.escalator)) ||
      this.exits.some((g) => g.stationName === st && g.elevatorExit)
    );
  }
}

export const transferGuideRepository = new TransferGuideRepository();
