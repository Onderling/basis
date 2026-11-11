import { describe, it, expect } from 'vitest';
import { pointKey, samePoint } from '../src/pointKey.js';

// One relay, many spellings. A circle's recorded point and the socket's url must compare equal whenever they name the
// same relay, or circle traffic silently skips its own relay (the scope matched by raw string: ws://10.0.2.2 vs
// ws://127.0.0.1 on the emulator is the harness case; the cases below are the ones real devices meet).
describe('pointKey — the one comparison form of a connection point', () => {
  it.each([
    ['wss://relay.example.org', 'wss://relay.example.org/'],
    ['wss://relay.example.org', 'WSS://Relay.Example.org'],
    ['wss://relay.example.org', 'wss://relay.example.org:443'],
    ['ws://relay.example.org', 'ws://relay.example.org:80/'],
    ['wss://relay.example.org', 'https://relay.example.org'],
    ['ws://relay.example.org:8787', 'http://relay.example.org:8787/'],
    ['wss://relay.example.org/ws', 'wss://relay.example.org/ws/'],
    ['  wss://relay.example.org  ', 'wss://relay.example.org'],
  ])('%s ≡ %s', (a, b) => {
    expect(samePoint(a, b)).toBe(true);
    expect(pointKey(a)).toBe(pointKey(b));
  });

  it.each([
    ['wss://relay.example.org', 'ws://relay.example.org'],          // a different scheme is a different socket
    ['wss://relay.example.org', 'wss://relay.example.org:8443'],
    ['wss://relay.example.org/a', 'wss://relay.example.org/b'],
    ['wss://relay.example.org', 'wss://other.example.org'],
  ])('%s ≢ %s', (a, b) => {
    expect(samePoint(a, b)).toBe(false);
  });

  it('a domain and its IP are NOT the same point (no lookup here; a harness must use one name)', () => {
    expect(samePoint('ws://localhost:8787', 'ws://127.0.0.1:8787')).toBe(false);
  });

  it('an unparseable or empty value keys to itself trimmed, never throws, and never equals a real point', () => {
    expect(pointKey('')).toBe('');
    expect(pointKey(null)).toBe('');
    expect(pointKey('not a url')).toBe('not a url');
    expect(samePoint('', '')).toBe(false);
    expect(samePoint('wss://relay.example.org', null)).toBe(false);
  });
});
