import express, { type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createRateLimiter } from './middleware/rateLimiter';

/**
 * ODsay 프록시.
 *  GET /api/routes/senior?sx=&sy=&ex=&ey=   (x=경도, y=위도)
 *  - ODSAY_API_KEY 는 서버에만 존재 (브라우저로 노출하지 않음)
 *  - 좌표 소수점 4자리 정규화 키로 5분 TTL 캐시
 *  - 같은 키의 동시 요청은 하나의 ODsay 호출로 병합(inFlightRequests)
 *  - 외부 호출 타임아웃 7초
 *  - USE_MOCK_ODSAY=true 또는 키가 없으면 샘플 응답을 돌려줌
 */

export const ODSAY_URL = 'https://api.odsay.com/v1/api/searchPubTransPathT';
export const CACHE_TTL_MS = 5 * 60_000;
export const UPSTREAM_TIMEOUT_MS = 7_000;

export type OdsayFetcher = (params: { sx: string; sy: string; ex: string; ey: string }) => Promise<unknown>;

export interface AppOptions {
  apiKey?: string;
  useMock?: boolean;
  mockResponsePath?: string;
  /** 테스트에서 외부 호출을 바꿔 끼우기 위한 훅 */
  fetcher?: OdsayFetcher;
  rateLimit?: { windowMs?: number; max?: number };
  cacheTtlMs?: number;
  now?: () => number;
}

export class UpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function findMockFile(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.MOCK_RESPONSE_PATH,
    path.resolve(process.cwd(), 'src/data/sampleOdsayResponse.json'),
    path.resolve(process.cwd(), '../src/data/sampleOdsayResponse.json'),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Mock 응답 파일을 찾지 못했습니다: ${candidates.join(', ')}`);
  return found;
}

export function createOdsayFetcher(apiKey: string, timeoutMs = UPSTREAM_TIMEOUT_MS): OdsayFetcher {
  return async ({ sx, sy, ex, ey }) => {
    // 가정: 파라미터 이름은 SX/SY/EX/EY/apiKey (ODsay LAB 문서 기준, README 참고)
    const qs = new URLSearchParams({ SX: sx, SY: sy, EX: ex, EY: ey, apiKey });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${ODSAY_URL}?${qs}`, { signal: ctrl.signal });
      if (!res.ok) throw new UpstreamError(`ODsay HTTP ${res.status}`, 502);
      const body = (await res.json()) as Record<string, unknown>;
      if (body && typeof body === 'object' && 'error' in body) {
        throw new UpstreamError(`ODsay 오류: ${JSON.stringify(body.error).slice(0, 200)}`, 502);
      }
      return body;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new UpstreamError('ODsay 응답 시간 초과', 504);
      if (e instanceof UpstreamError) throw e;
      throw new UpstreamError('ODsay 호출 실패', 502);
    } finally {
      clearTimeout(timer);
    }
  };
}

const coord = (v: unknown): number | null => {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function createApp(opts: AppOptions = {}) {
  const now = opts.now ?? Date.now;
  const ttl = opts.cacheTtlMs ?? CACHE_TTL_MS;
  const useMock = opts.useMock ?? !opts.apiKey;
  let fetcher: OdsayFetcher;
  if (opts.fetcher) fetcher = opts.fetcher;
  else if (useMock) {
    const file = findMockFile(opts.mockResponsePath);
    const mock = JSON.parse(readFileSync(file, 'utf8'));
    fetcher = async () => mock;
  } else fetcher = createOdsayFetcher(opts.apiKey as string);

  const cache = new Map<string, { body: unknown; expiresAt: number }>();
  const inFlightRequests = new Map<string, Promise<unknown>>();
  const stats = { upstreamCalls: 0, cacheHits: 0, merged: 0 };

  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: opts.fetcher ? 'custom' : useMock ? 'mock' : 'odsay' });
  });

  app.get('/api/routes/senior', createRateLimiter({ ...opts.rateLimit, now }), async (req: Request, res: Response) => {
    const sx = coord(req.query.sx), sy = coord(req.query.sy), ex = coord(req.query.ex), ey = coord(req.query.ey);
    if (sx === null || sy === null || ex === null || ey === null) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'sx, sy, ex, ey 좌표가 필요합니다.' } });
      return;
    }
    const p = { sx: sx.toFixed(4), sy: sy.toFixed(4), ex: ex.toFixed(4), ey: ey.toFixed(4) };
    const key = `${p.sx},${p.sy}->${p.ex},${p.ey}`;

    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) {
      stats.cacheHits++;
      res.setHeader('X-Cache', 'HIT');
      res.json(hit.body);
      return;
    }

    let pending = inFlightRequests.get(key);
    if (pending) {
      stats.merged++;
      res.setHeader('X-Cache', 'MERGED');
    } else {
      stats.upstreamCalls++;
      res.setHeader('X-Cache', 'MISS');
      pending = fetcher(p)
        .then((body) => {
          cache.set(key, { body, expiresAt: now() + ttl });
          return body;
        })
        .finally(() => inFlightRequests.delete(key));
      inFlightRequests.set(key, pending);
    }

    try {
      res.json(await pending);
    } catch (e) {
      const status = e instanceof UpstreamError ? e.status : 502;
      res.status(status).json({ error: { code: 'UPSTREAM', message: (e as Error).message } });
    }
  });

  return { app, stats, cache, useMock };
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  loadEnv();
  const apiKey = process.env.ODSAY_API_KEY?.trim() || undefined;
  const mockFlag = process.env.USE_MOCK_ODSAY;
  const useMock = mockFlag ? mockFlag.toLowerCase() === 'true' : !apiKey;
  if (!useMock && !apiKey) {
    console.error('USE_MOCK_ODSAY=false 인데 ODSAY_API_KEY 가 없습니다. backend-proxy/.env 를 확인하세요.');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8787);
  const { app } = createApp({ apiKey, useMock });
  app.listen(port, () => {
    console.log(`[backend-proxy] http://localhost:${port}  (모드: ${useMock ? 'MOCK 샘플 응답' : 'ODsay 실호출'})`);
  });
}
