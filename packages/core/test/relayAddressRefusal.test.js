// A client dials a relay over TLS (wss) unless the relay sits on the person's own machine or network. A plain ws
// address to a public host would let anyone on the path read and rewrite the relay protocol (which addresses a
// device registers, the control frames), not only the relay itself. The one rule, used by the transport and the app.
import { describe, it, expect } from 'vitest';
import { relayAddressRefusal } from '../src/index.js';

describe('relayAddressRefusal: wss outside local development', () => {
  it('lets every wss address through', () => {
    for (const u of ['wss://relay.test', 'wss://relay.test:443/x', 'wss://203.0.113.7:8787', 'wss://localhost:8787']) {
      expect(relayAddressRefusal(u), u).toBe(null);
    }
  });

  it('lets plain ws through on loopback, a private range, a link-local or shared range, or a single-label name', () => {
    for (const u of [
      'ws://localhost:8787', 'ws://127.0.0.1:8787', 'ws://[::1]:8787', 'ws://10.0.0.5:8787', 'ws://172.16.3.4:8787',
      'ws://192.168.2.20:8787', 'ws://169.254.1.1:8787', 'ws://100.73.134.19:8787', 'ws://[fd12::1]:8787', 'ws://relay:8787',
    ]) {
      expect(relayAddressRefusal(u), u).toBe(null);
    }
  });

  it('refuses plain ws to a public host, by name or by address', () => {
    for (const u of ['ws://relay.test', 'ws://relay.test:8787', 'ws://203.0.113.7:8787', 'ws://8.8.8.8', 'ws://[2001:db8::1]:8787', 'ws://172.32.0.1:8787']) {
      expect(relayAddressRefusal(u), u).toBe('plain-on-public-host');
    }
  });

  it('says what is wrong with an address that is no websocket address at all', () => {
    for (const u of ['', 'relay.test', 'https://relay.test', 'http://localhost:8787', null, undefined, 42]) {
      expect(relayAddressRefusal(u), String(u)).toBe('not-websocket');
    }
  });

  it('reads the scheme and host case-insensitively and ignores surrounding space', () => {
    expect(relayAddressRefusal('  WS://Relay.Test  ')).toBe('plain-on-public-host');
    expect(relayAddressRefusal('  WSS://Relay.Test  ')).toBe(null);
    expect(relayAddressRefusal(' ws://LOCALHOST:8787 ')).toBe(null);
  });
});
