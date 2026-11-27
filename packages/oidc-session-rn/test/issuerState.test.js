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

  it('ready only when the discovery AND the client are the current issuer\'s, and the request is built', () => {
    const disc = (issuer) => ({ issuer, value: { tokenEndpoint: 'x' } });
    const client = (issuer) => ({ issuer, value: 'client-' + issuer });
    expect(issuerReady({ issuer: INRUPT, discovered: disc(INRUPT), client: client(INRUPT), request: {} })).toBe(true);
    // the person picked another provider: Inrupt's discovery and client stand until the new ones are in
    expect(issuerReady({ issuer: LOCAL, discovered: disc(INRUPT), client: client(INRUPT), request: {} })).toBe(false);
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(INRUPT), request: {} }), 'never the old provider\'s client').toBe(false);
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(LOCAL), request: null })).toBe(false);
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: client(LOCAL), request: {} })).toBe(true);
    // a client id the app fixed itself holds for any issuer
    expect(issuerReady({ issuer: LOCAL, discovered: disc(LOCAL), client: null, fixedClientId: 'mine', request: {} })).toBe(true);
  });
});
