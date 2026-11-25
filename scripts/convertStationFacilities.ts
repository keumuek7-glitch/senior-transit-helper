/**
 * 공공데이터 CSV/JSON → src/data/station_exit_guides.json & rail_to_rail_guides.json 변환 CLI
 *
 * 사용법:
 *   npm run convert:facilities -- --transfers scripts/sample-input/rail_transfers.csv \
 *                                 --exits scripts/sample-input/station_exits.csv \
 *                                 --out src/data
 *
 * 가정: 공공데이터포털의 실제 파일들은 기관·연도마다 컬럼명이 다릅니다.
 * 이 스크립트는 아래 "표준 컬럼명"(한글)을 기대하며, 실제 파일은 COLUMN_ALIASES에 별칭을 추가해 맞춥니다.
 *   환승: 역명, 출발노선, 도착노선, 빠른환승문, 이동거리m, 엘리베이터(Y/N), 에스컬레이터(Y/N), 안내('|' 구분)
 *   출구: 역명, 노선, 출구번호, 목적지안내, 엘리베이터출구(Y/N), 이동거리m, 안내('|' 구분)
 * JSON 입력은 위 컬럼명을 키로 가진 객체 배열이어야 합니다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  RailToRailGuide,
  StationExitGuide,
} from '../src/core/metadata/stationTransferMetadata';
import { normalizeLineKey, normalizeStationName } from '../src/core/metadata/stationTransferMetadata';

type Row = Record<string, string>;

const COLUMN_ALIASES: Record<string, string[]> = {
  역명: ['역명', '역이름', 'stationName', 'STATION_NM'],
  출발노선: ['출발노선', '환승전노선', 'fromLine'],
  도착노선: ['도착노선', '환승후노선', 'toLine'],
  노선: ['노선', '호선', 'line', 'LINE_NUM'],
  빠른환승문: ['빠른환승문', '빠른하차', 'quickDoor'],
  이동거리m: ['이동거리m', '이동거리', 'walkMeters'],
  엘리베이터: ['엘리베이터', 'elevator'],
  에스컬레이터: ['에스컬레이터', 'escalator'],
  엘리베이터출구: ['엘리베이터출구', 'elevatorExit'],
  출구번호: ['출구번호', 'exitNo'],
  목적지안내: ['목적지안내', 'destinationHint'],
  안내: ['안내', 'steps'],
};

/** 따옴표("...")와 이스케이프("")를 지원하는 최소 CSV 파서 */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((cols) => Object.fromEntries(header.map((h, i) => [h.trim(), (cols[i] ?? '').trim()])));
}

function pick(row: Row, key: string): string {
  for (const alias of COLUMN_ALIASES[key] ?? [key]) {
    const v = row[alias];
    if (v !== undefined && v !== '') return String(v);
  }
  return '';
}

const yes = (v: string) => /^(y|yes|true|1|o|있음|유)$/i.test(v.trim());
const steps = (v: string) => v.split('|').map((s) => s.trim()).filter(Boolean);
const optNum = (v: string) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function toRailGuides(rows: Row[]): RailToRailGuide[] {
  return rows
    .map((r) => ({
      stationName: normalizeStationName(pick(r, '역명')),
      fromLine: normalizeLineKey(pick(r, '출발노선')),
      toLine: normalizeLineKey(pick(r, '도착노선')),
      quickDoor: pick(r, '빠른환승문') || undefined,
      walkMeters: optNum(pick(r, '이동거리m')),
      elevator: yes(pick(r, '엘리베이터')),
      escalator: yes(pick(r, '에스컬레이터')),
      steps: steps(pick(r, '안내')),
    }))
    .filter((g) => g.stationName && g.fromLine && g.toLine);
}

export function toExitGuides(rows: Row[]): StationExitGuide[] {
  return rows
    .map((r) => ({
      stationName: normalizeStationName(pick(r, '역명')),
      line: normalizeLineKey(pick(r, '노선')),
      exitNo: pick(r, '출구번호'),
      destinationHint: pick(r, '목적지안내'),
      elevatorExit: yes(pick(r, '엘리베이터출구')),
      walkMeters: optNum(pick(r, '이동거리m')),
      steps: steps(pick(r, '안내')),
    }))
    .filter((g) => g.stationName && g.exitNo);
}

function loadRows(file: string): Row[] {
  const text = readFileSync(file, 'utf8');
  if (file.toLowerCase().endsWith('.json')) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return arr.map((o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.join('|') : String(v ?? '')])),
    );
  }
  return parseCsv(text);
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const transfersFile = arg('transfers', 'scripts/sample-input/rail_transfers.csv');
  const exitsFile = arg('exits', 'scripts/sample-input/station_exits.csv');
  const outDir = arg('out', 'src/data');
  const rail = toRailGuides(loadRows(transfersFile));
  const exits = toExitGuides(loadRows(exitsFile));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'rail_to_rail_guides.json'), JSON.stringify(rail, null, 2) + '\n');
  writeFileSync(path.join(outDir, 'station_exit_guides.json'), JSON.stringify(exits, null, 2) + '\n');
  console.log(`환승 안내 ${rail.length}건, 출구 안내 ${exits.length}건 → ${outDir}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).endsWith('convertStationFacilities.ts');
if (invokedDirectly) main();
