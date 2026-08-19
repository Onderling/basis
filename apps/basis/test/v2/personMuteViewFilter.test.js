import { describe, it, expect } from 'vitest';
import { chatRows, projectEntries, mutedActorSet } from '../../src/v2/circleStream.js';

// The person-mute enforcement (the chat-lane sitting's rule): a muted member's messages LAND on the log
// — refusing at ingest would silently discard history — and are hidden at the ONE projection every chat
// surface reads. Unmute restores everything, because nothing was discarded.

const ev = (id, actor, text) => ({ id, ts: id.length, app: 'circle', type: 'chat-message', actor, circleId: 'c1', payload: { circleId: 'c1', text } });
const CIRCLES = [{ id: 'c1', name: 'Selwerd' }];

describe('the person-mute view filter', () => {
  const events = [ev('m1', 'webid:ada', 'hoi'), ev('m2', 'webid:bo', 'ook hoi'), ev('m3', 'webid:ada', 'nog eens')];

  it('hides a muted actor at the projection; the log keeps everything; unmute restores', () => {
    const muted = projectEntries({ events, circles: CIRCLES, circleId: 'c1', excludeActors: new Set(['webid:ada']) });
    expect(muted.map((r) => r.id)).toEqual(['m2']);            // hidden, both of ada's
    const restored = projectEntries({ events, circles: CIRCLES, circleId: 'c1', excludeActors: new Set() });
    expect(restored).toHaveLength(3);                          // nothing was discarded — unmute restores
  });

  it('flows through chatRows (the surface both shells actually call)', () => {
    const rows = chatRows({ events, circles: CIRCLES, circleId: 'c1', excludeActors: new Set(['webid:bo']) });
    expect(rows.map((r) => r.actor)).toEqual(['webid:ada', 'webid:ada']);
  });

  it('an entry with NO actor is never hidden (never hide people by accident)', () => {
    const rows = projectEntries({
      events: [{ id: 'x', ts: 1, app: 'circle', type: 'chat-message', circleId: 'c1', payload: { circleId: 'c1', text: '?' } }],
      circles: CIRCLES, circleId: 'c1', excludeActors: new Set(['webid:ada']),
    });
    expect(rows).toHaveLength(1);
  });
});

describe('mutedActorSet — the stoop mute-keys → actor-refs resolution', () => {
  const roster = [
    { webid: 'webid:ada', stableId: 'STABLE-ADA' },
    { webid: 'webid:bo',  stableId: 'STABLE-BO' },
  ];

  it('the key contract: stableId resolves via the roster, "webid:<w>" (legacy wrapper) unwraps, an unknown stableId stays inert', () => {
    const set = mutedActorSet(['STABLE-BO', 'webid:https://id.example/carla', 'UNKNOWN-STABLE'], roster);
    expect(set.has('webid:bo')).toBe(true);
    expect(set.has('https://id.example/carla')).toBe(true);   // the legacy prefix unwrapped
    expect(set.has('UNKNOWN-STABLE')).toBe(true);             // passes through; matches nothing → hides nobody
  });
});
