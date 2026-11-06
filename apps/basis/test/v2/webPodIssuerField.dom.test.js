/**
 * WEB NAMES THE POD PROVIDER, AS MOBILE DOES. A walk (2026-11-05, row 101) found web's "Sign in to a pod" going straight
 * to Inrupt PodSpaces: a person with any other pod, and the repo's own test pod, could not connect from the web. My data
 * now shows a provider field, pre-filled with the default, and sign-in uses what is typed.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleMyData } from '../../web/v2/circleMyData.js';

const t = (k) => k;

describe('the pod provider field on web', () => {
  it('is pre-filled with the default and sign-in passes what is typed', () => {
    const onSignIn = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), {
      t, only: ['storage'], podStatus: { signedIn: false }, onSignIn,
      podIssuerDefault: 'https://login.inrupt.com', podIssuers: [{ url: 'https://solidcommunity.net', name: 'SolidCommunity.net' }],
    });
    const field = el.querySelector('[data-role="pod-issuer"]');
    expect(field, 'no provider field: sign-in goes to one provider only').not.toBeNull();
    expect(field.value).toBe('https://login.inrupt.com');
    field.value = 'http://localhost:3000/';
    el.querySelector('.cc-mydata__signin').click();
    expect(onSignIn).toHaveBeenCalledWith('http://localhost:3000/');
  });
});
