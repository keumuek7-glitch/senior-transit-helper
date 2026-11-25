import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, UpstreamError, type AppOptions } from '../src/server';

let server: Server | null = null;

async function start(opts: AppOptions) {
  const made = createApp(opts);
  server = await new Promise<Server>((resolve) => {
    const s = made.app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { ...made, base: `http://127.0.0.1:${port}` };
}

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

const q = '/api/routes/senior?sx=127.04691&sy=37.58031&ex=126.99901&ey=37.57971';

describe('backend-proxy', () => {
  it('Mock 모드: 샘플 응답 반환', async () => {
    const { base } = await start({ useMock: true });
    const res = await fetch(base + q);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.path).toHaveLength(2);
    const health = await (await fetch(base + '/api/health')).json();
    expect(health.mode).toBe('mock');
  });

  it('좌표 누락 시 400', async () => {
    const { base } = await start({ useMock: true });
    expect((await fetch(base + '/api/routes/senior?sx=1')).status).toBe(400);
  });

  it('소수점 4자리 정규화 캐시 + 동시 요청 병합', async () => {
    let calls = 0;
    const seen: string[] = [];
    const { base, stats } = await start({
      fetcher: async (p) => {
        calls++;
        seen.push(`${p.sx},${p.sy}`);
        await new Promise((r) => setTimeout(r, 50));
        return { result: { path: [] } };
      },
    });
    const [a, b] = await Promise.all([fetch(base + q), fetch(base + q.replace('127.04691', '127.04694'))]);
    expect([a.headers.get('x-cache'), b.headers.get('x-cache')].sort()).toEqual(['MERGED', 'MISS']);
    const c = await fetch(base + q);
    expect(c.headers.get('x-cache')).toBe('HIT');
    expect(calls).toBe(1);
    expect(seen).toEqual(['127.0469,37.5803']);
    expect(stats).toMatchObject({ upstreamCalls: 1, merged: 1, cacheHits: 1 });
  });

  it('캐시 TTL 5분 경과 후 재호출', async () => {
    let t = 0;
    let calls = 0;
    const { base } = await start({ now: () => t, fetcher: async () => { calls++; return { ok: calls }; } });
    await fetch(base + q);
    t = 5 * 60_000 - 1;
    await fetch(base + q);
    expect(calls).toBe(1);
    t = 5 * 60_000 + 1;
    await fetch(base + q);
    expect(calls).toBe(2);
  });

  it('상류 오류는 캐시하지 않고 상태코드 전달', async () => {
    let calls = 0;
    const { base } = await start({
      fetcher: async () => {
        calls++;
        throw new UpstreamError('ODsay 응답 시간 초과', 504);
      },
    });
    expect((await fetch(base + q)).status).toBe(504);
    expect((await fetch(base + q)).status).toBe(504);
    expect(calls).toBe(2);
  });

  it('IP당 분당 30회 초과 시 429 + Retry-After', async () => {
    const { base } = await start({ useMock: true });
    for (let i = 0; i < 30; i++) expect((await fetch(base + q)).status).toBe(200);
    const res = await fetch(base + q);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
