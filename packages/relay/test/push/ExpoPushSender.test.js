import { describe, it, expect, vi } from 'vitest';
import { ExpoPushSender } from '../../src/push/ExpoPushSender.js';
import { PushSender }     from '../../src/push/PushSender.js';

function mockFetch(impl) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return impl({ url, init });
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('ExpoPushSender', () => {
  it('PushSender base throws on send()', async () => {
    await expect(new PushSender().send('t', {})).rejects.toThrow(/not implemented/);
  });

  it('happy path: posts the right body, reads {data: {status:"ok"}}', async () => {
    const fetchFn = mockFetch(() => jsonResponse({ data: { status: 'ok', id: 'tk-1' } }));
    const sender = new ExpoPushSender({ fetch: fetchFn });
    const res = await sender.send('ExponentPushToken[abc]', { foo: 1 }, { platform: 'ios' });
    expect(res).toEqual({ ok: true });

    expect(fetchFn.calls).toHaveLength(1);
    const { url, init } = fetchFn.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      to:                'ExponentPushToken[abc]',
      data:              { foo: 1 },
      priority:          'high',
      _contentAvailable: true,
    });
    // No UI fields when caller didn't set them.
    expect(body.title).toBeUndefined();
    expect(body.body).toBeUndefined();
  });

  it('attaches Authorization when accessToken is provided', async () => {
    const fetchFn = mockFetch(() => jsonResponse({ data: { status: 'ok' } }));
    const sender = new ExpoPushSender({ fetch: fetchFn, accessToken: 'sek-1' });
    await sender.send('t', {});
    expect(fetchFn.calls[0].init.headers.authorization).toBe('Bearer sek-1');
  });

  it('forwards title/body when caller asks', async () => {
    const fetchFn = mockFetch(() => jsonResponse({ data: { status: 'ok' } }));
    const sender = new ExpoPushSender({ fetch: fetchFn });
    await sender.send('t', { title: 'Hi', body: 'Wake up' });
    const body = JSON.parse(fetchFn.calls[0].init.body);
    expect(body.title).toBe('Hi');
    expect(body.body).toBe('Wake up');
  });

  it('returns {ok:false, error} on Expo ticket error', async () => {
    const fetchFn = mockFetch(() => jsonResponse({
      data: { status: 'error', message: 'DeviceNotRegistered' },
    }));
    const sender = new ExpoPushSender({ fetch: fetchFn });
    const res = await sender.send('bad-tok', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/DeviceNotRegistered/);
  });

  it('returns {ok:false, error} on non-2xx HTTP response', async () => {
    const fetchFn = mockFetch(() => ({
      ok:   false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'boom',
      json: async () => ({}),
    }));
    const sender = new ExpoPushSender({ fetch: fetchFn });
    const res = await sender.send('t', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/500/);
  });

  it('returns {ok:false, error} on network throw', async () => {
    const fetchFn = mockFetch(() => { throw new Error('ECONNREFUSED'); });
    const sender = new ExpoPushSender({ fetch: fetchFn });
    const res = await sender.send('t', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ECONNREFUSED/);
  });

  it('handles batch-shape response (array)', async () => {
    const fetchFn = mockFetch(() => jsonResponse({
      data: [{ status: 'ok', id: 'tk-1' }],
    }));
    const sender = new ExpoPushSender({ fetch: fetchFn });
    const res = await sender.send('t', {});
    expect(res.ok).toBe(true);
  });

  it('rejects empty / non-string token', async () => {
    const sender = new ExpoPushSender({ fetch: vi.fn() });
    expect(await sender.send('', {})).toEqual({ ok: false, error: 'invalid-token' });
    expect(await sender.send(null, {})).toEqual({ ok: false, error: 'invalid-token' });
  });

  it('honours a custom endpoint', async () => {
    const fetchFn = mockFetch(() => jsonResponse({ data: { status: 'ok' } }));
    const sender = new ExpoPushSender({ fetch: fetchFn, endpoint: 'https://my-proxy.example/push' });
    await sender.send('t', {});
    expect(fetchFn.calls[0].url).toBe('https://my-proxy.example/push');
  });
});
