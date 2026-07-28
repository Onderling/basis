/**
 * basis — podStorage helper tests. v0.7..
 */
import { describe, it, expect, vi } from 'vitest';

import {
  podRootFromWebid, podUrl, createPodWriter,
} from '../src/web/podStorage.js';

describe('podRootFromWebid', () => {
  it('root-level pod (anne.example/profile/card#me)', () => {
    expect(podRootFromWebid('https://anne.example/profile/card#me'))
      .toBe('https://anne.example/');
  });

  it('subpath pod (solidcommunity.net/anne/profile/card#me)', () => {
    expect(podRootFromWebid('https://solidcommunity.net/anne/profile/card#me'))
      .toBe('https://solidcommunity.net/anne/');
  });

  it('rejects empty', () => {
    expect(() => podRootFromWebid('')).toThrow();
    expect(() => podRootFromWebid(null)).toThrow();
  });
});

describe('podUrl', () => {
  it('namespaces under onderling/<app>/<resource>', () => {
    expect(podUrl('https://anne.example/', 'calendar', 'feed.ics'))
      .toBe('https://anne.example/onderling/calendar/feed.ics');
  });

  it('strips leading slashes from resource', () => {
    expect(podUrl('https://anne.example/', 'calendar', '/feed.ics'))
      .toBe('https://anne.example/onderling/calendar/feed.ics');
  });

  it('handles podRoot without trailing slash', () => {
    expect(podUrl('https://anne.example', 'household', 'profile.json'))
      .toBe('https://anne.example/onderling/household/profile.json');
  });
});

describe('createPodWriter', () => {
  function makeMockSession() {
    return {
      webid: 'https://anne.example/profile/card#me',
      fetch: vi.fn(async (url, opts = {}) => {
        // Default 200 OK echo.
        return {
          ok:     true,
          status: 200,
          text:   async () => `mock-body-of:${url}`,
        };
      }),
    };
  }

  it('write PUTs to the namespaced URL with content-type', async () => {
    const session = makeMockSession();
    const w = createPodWriter(session);
    const r = await w.write('calendar', 'feed.ics', 'BEGIN:VCALENDAR\n', 'text/calendar');
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://anne.example/onderling/calendar/feed.ics');
    expect(session.fetch).toHaveBeenCalledWith(
      'https://anne.example/onderling/calendar/feed.ics',
      expect.objectContaining({
        method:  'PUT',
        headers: { 'Content-Type': 'text/calendar' },
        body:    'BEGIN:VCALENDAR\n',
      }),
    );
  });

  it('read returns body text on 200', async () => {
    const session = makeMockSession();
    const w = createPodWriter(session);
    const r = await w.read('calendar', 'feed.ics');
    expect(r.ok).toBe(true);
    expect(r.body).toBe('mock-body-of:https://anne.example/onderling/calendar/feed.ics');
  });

  it('read returns ok=false on 404', async () => {
    const session = {
      webid: 'https://anne.example/profile/card#me',
      fetch: vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })),
    };
    const w = createPodWriter(session);
    const r = await w.read('calendar', 'missing.ics');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.body).toBeNull();
  });

  it('write returns ok=false on 403', async () => {
    const session = {
      webid: 'https://anne.example/profile/card#me',
      fetch: vi.fn(async () => ({ ok: false, status: 403, text: async () => '' })),
    };
    const w = createPodWriter(session);
    const r = await w.write('calendar', 'feed.ics', 'x', 'text/calendar');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it('urlFor returns the same namespaced URL the writer would PUT to', () => {
    const w = createPodWriter(makeMockSession());
    expect(w.urlFor('calendar', 'feed.ics'))
      .toBe('https://anne.example/onderling/calendar/feed.ics');
  });

  it('rejects sessions missing fetch or webid', () => {
    expect(() => createPodWriter()).toThrow();
    expect(() => createPodWriter({ webid: 'x' })).toThrow();
    expect(() => createPodWriter({ fetch: () => {} })).toThrow();
  });
});

describe('CalendarStore × podWriter integration', () => {
  it('refreshIcsFeed write-throughs to the pod after setPodWriter', async () => {
    const { CalendarStore } = await import('@onderling-app/calendar');
    const session = {
      webid: 'https://anne.example/profile/card#me',
      fetch: vi.fn(async (url, _opts) => ({ ok: true, status: 200, text: async () => '' })),
    };
    const store = new CalendarStore({ actor: 'webid:anne' });
    store.setPodWriter(createPodWriter(session));
    await store.addEvent({ title: 'X', startsAt: '2026-06-01T10:00:00Z' });
    // Find the PUT to the feed URL.
    const calls = session.fetch.mock.calls;
    const feedPut = calls.find(
      ([url, opts]) =>
        url === 'https://anne.example/onderling/calendar/feed.ics'
        && opts?.method === 'PUT',
    );
    expect(feedPut).toBeTruthy();
    expect(feedPut[1].body).toMatch(/BEGIN:VCALENDAR/);
  });

  it('clearing the writer via setPodWriter(null) stops the write-through', async () => {
    const { CalendarStore } = await import('@onderling-app/calendar');
    const session = {
      webid: 'https://anne.example/profile/card#me',
      fetch: vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })),
    };
    const store = new CalendarStore({ actor: 'webid:anne' });
    store.setPodWriter(createPodWriter(session));
    await store.addEvent({ title: 'pre-signout', startsAt: '2026-06-01T10:00:00Z' });
    store.setPodWriter(null);
    session.fetch.mockClear();
    await store.addEvent({ title: 'post-signout', startsAt: '2026-06-02T10:00:00Z' });
    expect(session.fetch).not.toHaveBeenCalled();
  });

  it('getPodFeedUrl returns the URL when writer set, null otherwise', async () => {
    const { CalendarStore } = await import('@onderling-app/calendar');
    const store = new CalendarStore({ actor: 'webid:anne' });
    expect(store.getPodFeedUrl()).toBeNull();
    store.setPodWriter(createPodWriter({
      webid: 'https://anne.example/profile/card#me',
      fetch: vi.fn(),
    }));
    expect(store.getPodFeedUrl())
      .toBe('https://anne.example/onderling/calendar/feed.ics');
  });
});
