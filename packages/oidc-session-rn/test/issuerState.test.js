/**
 * The sign-in hook's state is PER ISSUER: a discovery document and a registered client belong to the provider they
 * were made for. When the person picks another provider the hook's issuer changes, and until that provider's own
 * discovery and client are in, nothing from the previous one counts (the phone walk: every choice ended at Inrupt).
 */
import { describe, it, expect } from 'vitest';
import { forIssuer, issuerReady } from '../src/issuerState.js';

const INRUPT = 'https://login.inrupt.com';
const LOCAL = 'http://127.0.0.1:3000';

describe('the sign-in state belongs to one issuer', () => {
  it('a discovery or a client made for another issuer does not count', () => {
    const discovered = { issuer: INRUPT, value: { tokenEndpoint: 'x' } };
    expect(forIssuer(discovered, INRUPT)).toEqual({ tokenEndpoint: 'x' });
    expect(forIssuer(discovered, LOCAL)).toBe(null);
    expect(forIssuer(null, LOCAL)).toBe(null);
  });

  const disc = (issuer) => ({ issuer, value: { tokenEndpoint: 'x', authorizationEndpoint: `${issuer}/authorize` } });
  const client = (issuer) => ({ issuer, value: 'client-' + issuer });
  // an AuthRequest as expo-auth-session builds it: its client id, and the URL made from a discovery's authorize endpoint
  const req = (issuer, clientId = 'client-' + issuer) => ({ clientId, url: `${issuer}/authorize?client_id=${clientId}` });

  it('ready only when the discovery AND the client are the current issuer\'s, and the request is built for them', () => {
    expect(issuerReady({ issuer: INRUPT, discovered: disc(INRUPT), client: client(INRUPT), request: req(INRUPT) })).toBe(true);
    // the person picked another provider: Inrupt's discovery and client stand until the new ones are in
    expect(issuerReady({ issuer: LOCAL, discovered: disc(INRUPT), client: client(INRUPT), request: req(INRUPT) })).toBe(false);
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(INRUPT), request: req(INRUPT) }), 'never the old provider\'s client').toBe(false);
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(LOCAL), request: null })).toBe(false);
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(LOCAL), request: req(LOCAL) })).toBe(true);
    // a client id the app fixed itself holds for any issuer
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: null, fixedClientId: 'mine', request: req(LOCAL, 'mine') })).toBe(true);
  });

  // expo-auth-session never clears its request: until the new one's URL is made, the OLD request stands — one render
  // where the discovery and the client are the new provider's and the request still the previous provider's
  it('the request counts only when it was built for THIS client and THIS discovery', () => {
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(LOCAL), request: req(INRUPT) }), 'the old provider\'s request').toBe(false);
    // the placeholder request made before the client was in (its client id is the redirect URI)
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(LOCAL), request: req(LOCAL, 'basis://auth/callback') }), 'the placeholder-client request').toBe(false);
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(LOCAL), request: { clientId: 'client-' + LOCAL } }), 'a request with no URL yet').toBe(false);
  });
});
