import { createApiClient } from '@coxia/ui/lib/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const EVENT = 'test:unauthorized';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => Promise.resolve(handler(url, init)));
  vi.stubGlobal('fetch', fetchMock);
  const client = createApiClient({ baseUrl: 'http://api', tokenKey: 'tk', storage: 'local', unauthorizedEvent: EVENT, refreshPath: '/auth/refresh' });
  client.tokenStore.setSession({ accessToken: 'old-access', refreshToken: 'sess.old-refresh' });
  const ended = vi.fn();
  window.addEventListener(EVENT, ended);
  return { client, fetchMock, ended };
}

const bearer = (init: RequestInit) => (init.headers as Record<string, string> | undefined)?.authorization;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renovação da sessão', () => {
  it('401 → renova com o refresh token e repete a chamada com o token novo', async () => {
    const { client, fetchMock, ended } = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'new-access', refreshToken: 'sess.new-refresh' });
      return bearer(init) === 'Bearer new-access' ? json(200, { ok: true }) : json(401, { message: 'x' });
    });
    await expect(client.api('/me')).resolves.toEqual({ ok: true });
    expect(client.tokenStore.get()).toBe('new-access');
    expect(client.tokenStore.getRefresh()).toBe('sess.new-refresh');
    const refreshCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/auth/refresh'))!;
    expect(JSON.parse(refreshCall[1].body as string)).toEqual({ refreshToken: 'sess.old-refresh' });
    expect(ended).not.toHaveBeenCalled();
  });

  it('várias chamadas vencidas ao mesmo tempo renovam uma vez só', async () => {
    const { client, fetchMock } = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'new-access', refreshToken: 'sess.new-refresh' });
      return bearer(init) === 'Bearer new-access' ? json(200, { ok: true }) : json(401, {});
    });
    await Promise.all([client.api('/a'), client.api('/b'), client.api('/c')]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('refresh recusado (sessão vencida ou revogada) apaga os tokens e avisa', async () => {
    const { client, ended } = setup(() => json(401, { message: 'x' }));
    await expect(client.api('/me')).rejects.toMatchObject({ status: 401 });
    expect(client.tokenStore.get()).toBeNull();
    expect(client.tokenStore.getRefresh()).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('sem rede na renovação: mantém a sessão para tentar depois', async () => {
    const { client, ended } = setup((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
      return json(401, {});
    });
    await expect(client.api('/me')).rejects.toMatchObject({ status: 401 });
    expect(client.tokenStore.getRefresh()).toBe('sess.old-refresh');
    expect(ended).not.toHaveBeenCalled();
  });

  it('logout apaga os tokens e revoga a sessão na api', async () => {
    const { client, fetchMock } = setup(() => new Response(null, { status: 204 }));
    client.logout();
    expect(client.tokenStore.get()).toBeNull();
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/auth/logout'))!;
    expect(JSON.parse(call[1].body as string)).toEqual({ refreshToken: 'sess.old-refresh' });
  });
});
