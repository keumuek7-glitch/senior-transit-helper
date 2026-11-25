import { parseOdsayResponse, OdsayParseError } from '../core/parser/odsayRouteParser';
import type { RouteCandidate } from '../core/types';

/** 프록시(/api/routes/senior) 호출. 8초 타임아웃, 오류를 사람이 읽을 수 있는 종류로 나눕니다. */
export const ROUTE_TIMEOUT_MS = 8000;

export type RouteApiErrorKind = 'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED' | 'SERVER' | 'BAD_RESPONSE' | 'NO_ROUTE';

export class RouteApiError extends Error {
  constructor(readonly kind: RouteApiErrorKind, message: string, readonly retryAfterSec?: number) {
    super(message);
    this.name = 'RouteApiError';
  }
}

export interface Coords { sx: number; sy: number; ex: number; ey: number }

export async function fetchSeniorRoutes(
  c: Coords,
  opts: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<RouteCandidate[]> {
  const f = opts.fetchImpl ?? fetch;
  const qs = new URLSearchParams({ sx: String(c.sx), sy: String(c.sy), ex: String(c.ex), ey: String(c.ey) });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? ROUTE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await f(`${opts.baseUrl ?? ''}/api/routes/senior?${qs}`, { signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new RouteApiError('TIMEOUT', '길 찾기가 오래 걸리고 있어요. 잠시 후 다시 눌러 주세요.');
    throw new RouteApiError('NETWORK', '인터넷 연결을 확인해 주세요.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    const ra = Number(res.headers.get('Retry-After') ?? '');
    throw new RouteApiError('RATE_LIMITED', '요청이 많아요. 잠시 후 다시 눌러 주세요.', Number.isFinite(ra) ? ra : undefined);
  }
  if (!res.ok) throw new RouteApiError('SERVER', `길 찾기 서버 오류(${res.status})`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new RouteApiError('BAD_RESPONSE', '응답을 읽지 못했어요.');
  }
  try {
    const routes = parseOdsayResponse(body);
    if (routes.length === 0) throw new RouteApiError('NO_ROUTE', '갈 수 있는 대중교통 길을 찾지 못했어요.');
    return routes;
  } catch (e) {
    if (e instanceof RouteApiError) throw e;
    if (e instanceof OdsayParseError) throw new RouteApiError('NO_ROUTE', e.message);
    throw e;
  }
}
